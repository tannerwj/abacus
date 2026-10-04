import path from "node:path";
import { createRequire } from "node:module";
import { assertCompilerSource } from "./compiler-inputs.js";
import { validateTscProjects, type AbacusConfig } from "./config.js";
import { digest, finding, type AdapterResult, type CompilerDiagnostic, type CompilerProjectEvidence, type Finding } from "./evidence.js";
import { toolMetadata } from "./tool-runner.js";
import { runTsc, tscBinPath, type TscResult } from "./tsc.js";

function relativeInput(cwd: string, file: string): string {
  assertCompilerSource(cwd, file);
  return path.relative(path.resolve(cwd), path.resolve(cwd, file)).split(path.sep).join("/");
}
function inputEntries(cwd: string, entries: Array<{ path: string; digest: string }>): Array<{ path: string; digest: string }> {
  return entries.map((entry) => ({ ...entry, path: relativeInput(cwd, entry.path) })).sort((a, b) => a.path.localeCompare(b.path));
}
function dependencyEntries(entries: Array<{ path: string; digest: string }>): Array<{ path: string; digest: string }> {
  return entries.map((entry) => {
    const parts = entry.path.split(/[\\/]/u);
    const root = parts.indexOf("node_modules");
    if (root < 0) throw new Error("Compiler dependency is not an installed input");
    return { ...entry, path: `installed:${parts.slice(root).join("/")}` };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function diagnostic(cwd: string, line: string, inputs: Set<string>): CompilerDiagnostic {
  const code = /error (TS\d+)/u.exec(line)?.[1] ?? "compiler";
  const match = /^(.+?)\((\d+),(\d+)\): error TS\d+:/u.exec(line);
  if (match) {
    try {
      const location = { path: relativeInput(cwd, match[1]), line: Number(match[2]), column: Number(match[3]) };
      if (inputs.has(location.path) && location.line > 0 && location.column > 0) return { code, location };
    } catch { /* An external path must never be copied from raw compiler output. */ }
  }
  return { code };
}
function compilerOutcome(measured: TscResult): CompilerProjectEvidence["outcome"] {
  if (!measured.configPath || measured.incompleteReason || measured.files === 0) return "incomplete";
  return measured.clean ? "pass" : "fail";
}
function checkProject(cwd: string, project: string): CompilerProjectEvidence {
  try {
    const measured = runTsc(cwd, project);
    const configs = inputEntries(cwd, measured.configs);
    const sources = inputEntries(cwd, measured.sources);
    const dependencies = dependencyEntries(measured.dependencies);
    const locations = new Set([...configs, ...sources].map((entry) => entry.path));
    const outcome = compilerOutcome(measured);
    const notes = !measured.configPath ? ["Selected compiler project is missing"] : measured.incompleteReason ? [measured.incompleteReason] : measured.files === 0 ? ["Selected compiler project has no source targets"] : [];
    return {
      project, outcome, scope: { kind: "repository", targets: [project], scanned: measured.files, unit: "files" },
      diagnostics: measured.errors.map((line) => diagnostic(cwd, line, locations)), configs, sources, dependencies, notes,
      ...(["pass", "fail"].includes(outcome) ? { inputDigest: digest(JSON.stringify({ project, configs, sources, dependencies })) } : {}),
    };
  } catch {
    return { project, outcome: "error", scope: { kind: "repository", targets: [project], scanned: 0, unit: "files" }, diagnostics: [], configs: [], sources: [], dependencies: [], notes: ["Compiler project failed to execute or establish safe input evidence"] };
  }
}
function projectFindings(project: CompilerProjectEvidence, defaultProject: boolean): Finding[] {
  return project.diagnostics.map((item, index) => {
    const subject = `${item.location?.path ?? `config #${index + 1}`} #${index + 1}`;
    const context = defaultProject ? subject : `${project.project}: ${subject}`;
    const location = item.location ? ` at ${item.location.path}:${item.location.line}:${item.location.column}` : "";
    return { ...finding(`tsc/${item.code}`, context, `TypeScript ${item.code}${location}`), project: project.project };
  });
}
function combinedOutcome(projects: CompilerProjectEvidence[]): AdapterResult["outcome"] {
  for (const outcome of ["error", "incomplete", "fail"] as const) if (projects.some((project) => project.outcome === outcome)) return outcome;
  return "pass";
}
/** Check every selected project independently. Reference builds and source cache writes are never requested. */
export function typescriptEvidence(config: AbacusConfig, cwd: string): AdapterResult {
  const selected = validateTscProjects(config.tsc.projects);
  const projects = selected.map((project) => checkProject(cwd, project));
  const defaultProject = selected.length === 1 && selected[0] === "tsconfig.json";
  const scanned = projects.reduce((count, project) => count + project.scope.scanned, 0);
  const configs = [...new Map(projects.flatMap((project) => project.configs).map((entry) => [JSON.stringify(entry), entry])).values()];
  return {
    outcome: combinedOutcome(projects), scope: { kind: "repository", targets: selected, scanned, unit: "project-files" },
    projects, findings: projects.flatMap((project) => projectFindings(project, defaultProject)), configs,
    metrics: { projects: projects.length, sourceChecks: scanned, uniqueFiles: new Set(projects.flatMap((project) => project.sources.map((entry) => entry.path))).size },
    tool: toolMetadata(tscBinPath(cwd), "typescript"),
    tools: [toolMetadata(createRequire(import.meta.url).resolve("typescript"), "typescript/config-reader")],
    notes: projects.flatMap((project) => (project.notes ?? []).map((note) => `${project.project}: ${note}`)),
  };
}

export function reportTypeScriptProfile(config: AbacusConfig, cwd = process.cwd()): boolean {
  const result = typescriptEvidence(config, cwd);
  for (const project of result.projects ?? []) console.log(`TypeScript ${project.project}: ${project.outcome}; ${project.scope.scanned} files; ${project.diagnostics.length} diagnostics`);
  for (const item of result.findings.slice(0, 25)) console.log(`  ${item.subject}: ${item.message}`);
  for (const note of result.notes ?? []) console.log(`  ${note}`);
  return result.outcome === "pass";
}
