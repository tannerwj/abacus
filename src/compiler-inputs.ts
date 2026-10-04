import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { assertProjectPath } from "./config.js";
import { digest } from "./evidence.js";

export interface CompilerInputs {
  options: Record<string, unknown>;
  configPath?: string;
  configs: Array<{ path: string; digest: string }>;
  incompleteReason?: string;
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function assertCompilerSource(cwd: string, file: string): void {
  assertProjectPath(cwd, file, "Compiler input");
  if (fs.existsSync(file) && !inside(fs.realpathSync(cwd), fs.realpathSync(file))) throw new Error("Compiler symlink input leaves the evaluated project tree");
}
/** Close config, extends, and reference reads without building unselected projects. */
export function inspectCompilerInputs(cwd: string, project = "tsconfig.json"): CompilerInputs {
  cwd = path.resolve(cwd);
  const configPath = path.resolve(cwd, project);
  if (!fs.existsSync(configPath)) return { options: {}, configs: [] };
  const configs = new Map<string, { path: string; digest: string }>();
  const visiting = new Set<string>();
  const parsedConfigs = new Map<string, ts.ParsedCommandLine>();
  let configError = false;
  let incompleteReason = "Compiler configuration could not establish complete project inputs";
  try {
    assertCompilerSource(cwd, configPath);
    const host: ts.ParseConfigFileHost = {
      ...ts.sys,
      getCurrentDirectory: () => cwd,
      readFile(file) {
        assertCompilerSource(cwd, file);
        const content = ts.sys.readFile(file);
        if (content !== undefined) configs.set(file, { path: file, digest: digest(content) });
        return content;
      },
      fileExists(file) { return inside(cwd, file) && ts.sys.fileExists(file); },
      directoryExists(dir) { return inside(cwd, dir) && ts.sys.directoryExists(dir); },
      readDirectory(dir, extensions, excludes, includes, depth) {
        assertCompilerSource(cwd, dir);
        return ts.sys.readDirectory(dir, extensions, excludes, includes, depth);
      },
      onUnRecoverableConfigFileDiagnostic() { configError = true; },
    };
    function inspectConfig(file: string): ts.ParsedCommandLine | undefined {
      assertCompilerSource(cwd, file);
      if (!fs.existsSync(file)) return undefined;
      // Real paths also catch a cycle reached through an in-tree config symlink.
      const key = fs.realpathSync(file);
      if (visiting.has(key)) {
        incompleteReason = "Compiler project reference cycle prevents complete project inputs";
        return undefined;
      }
      if (parsedConfigs.has(file)) return parsedConfigs.get(file);
      visiting.add(key);
      const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, host);
      if (!parsed || configError || parsed.errors.length) return undefined;
      for (const source of parsed.fileNames) assertCompilerSource(cwd, source);
      for (const reference of parsed.projectReferences ?? []) {
        if (!inspectConfig(ts.resolveProjectReferencePath(reference))) return undefined;
      }
      visiting.delete(key);
      parsedConfigs.set(file, parsed);
      return parsed;
    }
    const parsed = inspectConfig(configPath);
    if (!parsed) return { options: {}, configPath, configs: [...configs.values()], incompleteReason };
    return { options: parsed.options, configPath, configs: [...configs.values()] };
  } catch {
    return { options: {}, configPath, configs: [...configs.values()], incompleteReason: "Compiler source or configuration inputs leave the evaluated project tree" };
  }
}
