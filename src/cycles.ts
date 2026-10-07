/**
 * `abacus cycles` — circular-dependency gate via dependency-cruiser.
 *
 * Runs dependency-cruiser with the `no-circular` rule (bundled, zero extra
 * installs) over the project's `src/` tree and exits 1 when any import cycle
 * is found. Uses the repo's `.dependency-cruiser.cjs` when present (written by
 * `abacus init`), otherwise abacus's bundled template.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeToolBinPath, runNodeTool } from "./tool-runner.js";
import { parseGraphReport, type GraphReport } from "./dependency-graph.js";
import { assertProjectPath } from "./config.js";

export interface CycleViolation {
  from: string;
  to: string;
  cycle: string[];
  rule: string;
  severity: "error" | "warn" | "info" | "ignore";
}

export interface CyclesResult {
  clean: boolean;
  violations: CycleViolation[];
  files: number;
  /** Imports dependency-cruiser could not resolve; cycle coverage may be incomplete. */
  unresolved: number;
}

/** Project's depcruise if installed, else the one bundled with abacus. */
export function depcruiseBinPath(cwd = process.cwd()): string {
  return nodeToolBinPath("dependency-cruiser", "depcruise", cwd);
}

/** Repo config if present, else abacus's bundled template. Exported for tests. */
export function cruiseConfigPath(cwd = process.cwd()): string {
  const local = path.join(cwd, ".dependency-cruiser.cjs");
  if (fs.existsSync(local)) return local;
  // Template is CJS (dependency-cruiser require()s it); resolve relative to dist/.
  const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "configs", "dependency-cruiser.cjs");
  if (!fs.existsSync(bundled)) throw new Error(`no dependency-cruiser config found (checked ${local} and ${bundled})`);
  return bundled;
}

/** Source tree to cruise: src/ when present, else the cwd. Exported for tests. */
export function sourceDir(cwd = process.cwd()): string {
  const src = path.join(cwd, "src");
  return fs.existsSync(src) && fs.statSync(src).isDirectory() ? src : cwd;
}

function validateGraphInputs(report: GraphReport, cwd: string): number {
  for (const key of ["tsConfig", "webpackConfig", "babelConfig"]) {
    const option = report.summary.optionsUsed[key];
    if (option && typeof option === "object" && "fileName" in option && typeof option.fileName === "string") assertProjectPath(cwd, option.fileName, "Native cycle config input");
  }
  for (const module of report.modules) if (!module.source.split(/[\\/]/u).includes("node_modules")) assertProjectPath(cwd, module.source, "Cycle graph source");
  if (!report.summary.ruleSetUsed.forbidden.length) throw new Error("Cycle graph has no forbidden native rules");
  // Count unresolved imports instead of failing: report the cycles we *can*
  // see, and warn that coverage may be incomplete. A hard error here trades
  // a true positive ("1 cycle found") for "error: unresolved imports".
  let unresolved = 0;
  for (const item of report.modules) for (const dependency of item.dependencies) if (dependency.couldNotResolve) unresolved++;
  return unresolved;
}

export function runCycles(cwd = process.cwd(), configPath?: string): CyclesResult {
  const bin = depcruiseBinPath(cwd);
  const config = configPath ?? cruiseConfigPath(cwd);
  const dir = sourceDir(cwd);
  const out = runNodeTool(bin, ["--config", config, "--output-type", "json", "--no-cache", "--no-ignore-known", dir], cwd);
  if (out.error) throw new Error(`depcruise failed to run: ${out.error.message}`);
  if (out.status !== 0 && out.status !== 1) throw new Error(`depcruise exited ${out.status}`);
  // depcruise exits non-zero when violations are found; JSON still parses.
  const text = (out.stdout ?? "").trim();
  if (!text) throw new Error(`depcruise produced no output (stderr: ${(out.stderr ?? "").slice(0, 500)})`);
  const report = parseGraphReport(text, out.status ?? -1);
  const unresolved = validateGraphInputs(report, cwd);
  const violations = (report.summary?.violations ?? []).map((v) => ({
    from: v.from,
    to: v.to ?? v.from,
    cycle: (v.cycle ?? []).map((c) => (typeof c === "string" ? c : c.name)),
    rule: v.rule.name,
    severity: v.rule.severity,
  }));
  if (out.status !== 0 && violations.length === 0) throw new Error("depcruise exited nonzero without graph violations");
  return { clean: !violations.some((item) => item.severity === "error"), violations, files: report.modules.length, unresolved };
}

/** Human-readable report. Returns true when no cycles were found. */
export function reportCycles(cwd = process.cwd()): boolean {
  const result = runCycles(cwd);
  if (result.unresolved > 0) {
    console.log(`Cycles — warning: ${result.unresolved} import${result.unresolved === 1 ? "" : "s"} could not be resolved; cycle coverage may be incomplete.\n`);
  }
  if (result.clean) {
    console.log("Cycles — no circular dependencies.\n");
    return result.unresolved === 0;
  }
  console.log(`Cycles — ${result.violations.length} circular dependenc${result.violations.length === 1 ? "y" : "ies"}:\n`);
  for (const v of result.violations) {
    const chain = v.cycle.length > 0 ? v.cycle.join(" → ") : `${v.from} → ${v.to}`;
    console.log(`  ${chain}`);
  }
  console.log("\nBreak the cycle (dependency inversion, extract shared module), or exempt it in .dependency-cruiser.cjs.\n");
  return false;
}
