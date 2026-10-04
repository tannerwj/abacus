/**
 * `abacus dupes` — copy-paste duplication gate via jscpd.
 *
 * Runs jscpd (bundled) over the project's `src/` tree with min-lines 5 /
 * min-tokens 50 and exits 1 when the duplication percentage exceeds the
 * threshold (default 5%, configurable via `threshold` in `.jscpd.json`).
 * Prints every clone pair so the fix is obvious.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeToolBinPath, runNodeTool } from "./tool-runner.js";
export const DEFAULT_THRESHOLD = 5;
/** Project's jscpd if installed, else the one bundled with abacus. */
export function jscpdBinPath(cwd = process.cwd()) {
    return nodeToolBinPath("jscpd", "jscpd", cwd);
}
/** Source tree to scan: src/ when present, else the cwd. Exported for tests. */
export function sourceDir(cwd = process.cwd()) {
    const src = path.join(cwd, "src");
    return fs.existsSync(src) && fs.statSync(src).isDirectory() ? src : cwd;
}
/** Threshold from .jscpd.json when present, else the default. Exported for tests. */
export function thresholdFor(cwd = process.cwd()) {
    const configPath = path.join(cwd, ".jscpd.json");
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            if (typeof config.threshold === "number" && config.threshold >= 0)
                return config.threshold;
        }
        catch {
            // Malformed config: fall through to default; jscpd will surface the error.
        }
    }
    return DEFAULT_THRESHOLD;
}
export function runDupes(cwd = process.cwd()) {
    const bin = jscpdBinPath(cwd);
    const dir = sourceDir(cwd);
    const threshold = thresholdFor(cwd);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-dupes-"));
    try {
        const args = [
            "--min-lines", "5",
            "--min-tokens", "50",
            "--reporters", "json",
            "--output", outDir,
            "--silent",
        ];
        const configPath = path.join(cwd, ".jscpd.json");
        if (fs.existsSync(configPath))
            args.push("--config", configPath);
        args.push(dir);
        const out = runNodeTool(bin, args, cwd);
        if (out.error)
            throw new Error(`jscpd failed to run: ${out.error.message}`);
        const reportPath = path.join(outDir, "jscpd-report.json");
        if (!fs.existsSync(reportPath)) {
            throw new Error(`jscpd produced no report (stderr: ${(out.stderr ?? "").slice(0, 500)})`);
        }
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        const clones = (report.duplicates ?? []).map((d) => ({
            lines: d.lines,
            tokens: d.tokens,
            first: { file: d.firstFile.name, start: d.firstFile.start, end: d.firstFile.end },
            second: { file: d.secondFile.name, start: d.secondFile.start, end: d.secondFile.end },
        }));
        const percentage = report.statistics?.total?.percentage ?? 0;
        return { clean: percentage <= threshold, percentage, threshold, clones };
    }
    finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}
/** Human-readable report. Returns true when duplication is under the threshold. */
export function reportDupes(cwd = process.cwd()) {
    const result = runDupes(cwd);
    const pct = result.percentage.toFixed(1);
    if (result.clean) {
        console.log(`Dupes — ${pct}% duplication (threshold ${result.threshold}%), ${result.clones.length} clone${result.clones.length === 1 ? "" : "s"}.\n`);
        return true;
    }
    console.log(`Dupes — ${pct}% duplication exceeds threshold ${result.threshold}% (${result.clones.length} clones):\n`);
    for (const c of result.clones.slice(0, 20)) {
        console.log(`  ${c.lines} lines: ${c.first.file}:${c.first.start}-${c.first.end} ↔ ${c.second.file}:${c.second.start}-${c.second.end}`);
    }
    if (result.clones.length > 20)
        console.log(`  … and ${result.clones.length - 20} more`);
    console.log("\nExtract the shared logic into one module, or raise `threshold` in .jscpd.json.\n");
    return false;
}
