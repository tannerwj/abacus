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
/** Project's depcruise if installed, else the one bundled with abacus. */
export function depcruiseBinPath(cwd = process.cwd()) {
    return nodeToolBinPath("dependency-cruiser", "depcruise", cwd);
}
/** Repo config if present, else abacus's bundled template. Exported for tests. */
export function cruiseConfigPath(cwd = process.cwd()) {
    const local = path.join(cwd, ".dependency-cruiser.cjs");
    if (fs.existsSync(local))
        return local;
    // Template is CJS (dependency-cruiser require()s it); resolve relative to dist/.
    const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "configs", "dependency-cruiser.cjs");
    if (!fs.existsSync(bundled))
        throw new Error(`no dependency-cruiser config found (checked ${local} and ${bundled})`);
    return bundled;
}
/** Source tree to cruise: src/ when present, else the cwd. Exported for tests. */
export function sourceDir(cwd = process.cwd()) {
    const src = path.join(cwd, "src");
    return fs.existsSync(src) && fs.statSync(src).isDirectory() ? src : cwd;
}
export function runCycles(cwd = process.cwd()) {
    const bin = depcruiseBinPath(cwd);
    const config = cruiseConfigPath(cwd);
    const dir = sourceDir(cwd);
    const out = runNodeTool(bin, ["--config", config, "--output-type", "json", dir], cwd);
    if (out.error)
        throw new Error(`depcruise failed to run: ${out.error.message}`);
    // depcruise exits non-zero when violations are found; JSON still parses.
    const text = (out.stdout ?? "").trim();
    if (!text)
        throw new Error(`depcruise produced no output (stderr: ${(out.stderr ?? "").slice(0, 500)})`);
    const report = JSON.parse(text);
    const violations = (report.summary?.violations ?? []).map((v) => ({
        from: v.from,
        to: v.to,
        cycle: (v.cycle ?? []).map((c) => (typeof c === "string" ? c : c.name)),
    }));
    return { clean: violations.length === 0, violations };
}
/** Human-readable report. Returns true when no cycles were found. */
export function reportCycles(cwd = process.cwd()) {
    const result = runCycles(cwd);
    if (result.clean) {
        console.log("Cycles — no circular dependencies.\n");
        return true;
    }
    console.log(`Cycles — ${result.violations.length} circular dependenc${result.violations.length === 1 ? "y" : "ies"}:\n`);
    for (const v of result.violations) {
        const chain = v.cycle.length > 0 ? v.cycle.join(" → ") : `${v.from} → ${v.to}`;
        console.log(`  ${chain}`);
    }
    console.log("\nBreak the cycle (dependency inversion, extract shared module), or exempt it in .dependency-cruiser.cjs.\n");
    return false;
}
