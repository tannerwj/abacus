import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { assertProjectPath } from "./config.js";
import { digest } from "./evidence.js";
function inside(root, file) {
    const relative = path.relative(path.resolve(root), path.resolve(file));
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function assertCompilerSource(cwd, file) {
    assertProjectPath(cwd, file, "Compiler input");
    if (fs.existsSync(file) && !inside(fs.realpathSync(cwd), fs.realpathSync(file)))
        throw new Error("Compiler symlink input leaves the evaluated project tree");
}
/** Inspect actual extends reads without allowing an implicit parent project or external files. */
export function inspectCompilerInputs(cwd, project = "tsconfig.json") {
    cwd = path.resolve(cwd);
    const configPath = path.resolve(cwd, project);
    if (!fs.existsSync(configPath))
        return { options: {}, configs: [] };
    const configs = new Map();
    let configError = false;
    try {
        assertCompilerSource(cwd, configPath);
        const host = {
            ...ts.sys,
            getCurrentDirectory: () => cwd,
            readFile(file) {
                assertCompilerSource(cwd, file);
                const content = ts.sys.readFile(file);
                if (content !== undefined)
                    configs.set(file, { path: file, digest: digest(content) });
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
        const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
        if (!parsed || configError || parsed.errors.length)
            return { options: {}, configPath, configs: [...configs.values()], incompleteReason: "Compiler configuration could not establish complete project inputs" };
        for (const file of parsed.fileNames)
            assertCompilerSource(cwd, file);
        return { options: parsed.options, configPath, configs: [...configs.values()] };
    }
    catch {
        return { options: {}, configPath, configs: [...configs.values()], incompleteReason: "Compiler source or configuration inputs leave the evaluated project tree" };
    }
}
