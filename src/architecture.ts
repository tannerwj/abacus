import fs from "node:fs";
import path from "node:path";
import { GraphInspectionError as InspectionError, parseGraphReport, type GraphReport } from "./dependency-graph.js";
import { type AdapterResult, digest, finding } from "./evidence.js";
import { nodeToolBinPath, runNodeTool, toolMetadata } from "./tool-runner.js";

export interface ArchitectureOptions {
  /** Inspectable native rules; no architecture is inferred. */
  configPath?: string;
  /** Complete source roots, never a changed-file list. Defaults to the repository. */
  targets?: string[];
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function confined(root: string, file: string): boolean {
  return inside(root, file) && (!fs.existsSync(file) || inside(fs.realpathSync(root), fs.realpathSync(file)));
}
function requireInput(cwd: string, targets: string[], config: string): void {
  if (!Array.isArray(targets) || targets.length === 0 || targets.some((target) => typeof target !== "string" || !target.trim())) {
    throw new InspectionError("incomplete", "Architecture requires nonempty complete source roots.");
  }
  if (targets.some((target) => !fs.existsSync(path.resolve(cwd, target)))) {
    throw new InspectionError("incomplete", "A configured architecture source root does not exist.");
  }
  if (targets.some((target) => !confined(cwd, path.resolve(cwd, target)))) {
    throw new InspectionError("incomplete", "Architecture source roots must stay inside the repository input tree.");
  }
  if (!fs.existsSync(config) || !fs.statSync(config).isFile()) {
    throw new InspectionError("incomplete", "Architecture requires an explicit native dependency-cruiser configuration.");
  }
}
function nativeFindings(report: GraphReport): AdapterResult["findings"] {
  const rules = new Set(report.summary.ruleSetUsed.forbidden.map((rule) => rule.name));
  if (!rules.size) throw new InspectionError("incomplete", "The native architecture configuration declares no forbidden rules.");
  return report.summary.violations.map((violation) => {
    if (!rules.has(violation.rule.name)) throw new InspectionError("error", "dependency-cruiser findings refer to an undeclared native rule.");
    const subject = violation.to ? `${violation.from} -> ${violation.to}` : violation.from;
    const severity = violation.rule.severity === "error" ? "error" : violation.rule.severity === "warn" ? "warning" : "info";
    return finding(`architecture/${violation.rule.name}`, subject, `Native rule ${violation.rule.name} forbids this dependency.`, severity);
  });
}
function inspectGraph(cwd: string, config: string, targets: string[], result: AdapterResult): GraphReport {
  const bin = nodeToolBinPath("dependency-cruiser", "depcruise", cwd);
  result.tool = toolMetadata(bin, "dependency-cruiser");
  const output = runNodeTool(bin, ["--config", config, "--output-type", "json", "--no-cache", "--no-ignore-known", ...targets], cwd);
  if (output.error || output.signal || output.status === null) {
    throw new InspectionError("error", "dependency-cruiser could not complete the graph inspection.");
  }
  if (![0, 1].includes(output.status)) throw new InspectionError("error", "dependency-cruiser exited with an unexpected status.");
  return parseGraphReport(output.stdout, output.status);
}

function graphInputs(cwd: string, report: GraphReport, result: AdapterResult): void {
  if (report.summary.environment?.issues?.length) throw new InspectionError("incomplete", "Native dependency-cruiser reports unavailable parser/transpiler coverage.");
  if (["focus", "reaches", "affected", "collapse"].some((key) => report.summary.optionsUsed[key])) {
    throw new InspectionError("incomplete", "Architecture requires a complete graph; native view/revision filtering is unsupported.");
  }
  for (const key of ["tsConfig", "webpackConfig", "babelConfig"]) {
    const option = report.summary.optionsUsed[key];
    if (!object(option) || typeof option.fileName !== "string") continue;
    const file = path.resolve(cwd, option.fileName);
    if (!confined(cwd, file)) throw new InspectionError("incomplete", "Native architecture resolution config references an out-of-tree input.");
    if (fs.existsSync(file)) result.configs?.push({ path: file, digest: digest(fs.readFileSync(file)) });
  }
  for (const module of report.modules) {
    // Normal installed dependencies are attested by the repository lockfile and
    // retain the native doNotFollow behavior; project sources cannot escape it.
    if (module.source.split(/[\\/]/).includes("node_modules")) continue;
    if (!confined(cwd, path.resolve(cwd, module.source))) {
      throw new InspectionError("incomplete", "The native dependency graph includes an out-of-tree project source.");
    }
  }
}

/** Native forbidden-rule validation over a complete configured dependency graph. */
export function runArchitecture(cwd = process.cwd(), options: ArchitectureOptions = {}): AdapterResult {
  const targets = options.targets ?? ["."];
  const result: AdapterResult = {
    outcome: "incomplete", scope: { kind: "graph", targets, scanned: 0, unit: "modules" }, findings: [], configs: [],
  };
  try {
    cwd = path.resolve(cwd);
    // The architecture adapter never silently substitutes the bundled cycle-only template.
    const config = path.resolve(cwd, options.configPath ?? ".dependency-cruiser.cjs");
    requireInput(cwd, targets, config);
    result.configs?.push({ path: config, digest: digest(fs.readFileSync(config)) });
    const report = inspectGraph(cwd, config, targets, result);
    result.configs?.push({ path: `${config}#effective`, digest: digest(JSON.stringify({ rules: report.summary.ruleSetUsed, options: report.summary.optionsUsed, targets })) });
    result.findings = nativeFindings(report);
    graphInputs(cwd, report, result);
    result.scope.scanned = report.modules.length;
    const active = report.summary.violations.filter((violation) => violation.rule.severity !== "ignore").length;
    result.metrics = { modules: report.modules.length, dependencies: report.summary.totalDependenciesCruised, violations: active };
    if (report.modules.length === 0) throw new InspectionError("incomplete", "Architecture inspection found zero modules.");
    if (report.modules.some((module) => module.dependencies.some((dependency) => dependency.couldNotResolve))) {
      throw new InspectionError("incomplete", "The dependency graph contains unresolved imports; complete architecture coverage is unavailable.");
    }
    result.outcome = active > 0 ? "fail" : "pass";
  } catch (error) {
    result.outcome = error instanceof InspectionError ? error.outcome : "error";
    const message = error instanceof InspectionError ? error.message : "Architecture configuration or tool resolution failed.";
    result.findings.push(finding(`architecture/${result.outcome}`, "dependency-graph", message));
  }
  return result;
}
