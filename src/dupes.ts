import { jsonObject, objectValue, arrayValue, stringValue, numberValue } from "./json-values.js";
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

export interface Clone {
  lines: number;
  tokens: number;
  first: { file: string; start: number; end: number };
  second: { file: string; start: number; end: number };
}

export interface DupesResult {
  clean: boolean;
  percentage: number;
  threshold: number;
  clones: Clone[];
  files: number;
}

export const DEFAULT_THRESHOLD = 5;

function reportStatistics(total: { percentage: number; sources: number } | undefined): { percentage: number; files: number } {
  const percentage = total?.percentage;
  const files = total?.sources;
  if (typeof percentage !== "number" || !Number.isFinite(percentage) || typeof files !== "number" || !Number.isInteger(files) || files < 0) throw new Error("jscpd report has invalid statistics");
  return { percentage, files };
}

/** Project's jscpd if installed, else the one bundled with abacus. */
export function jscpdBinPath(cwd = process.cwd()): string {
  return nodeToolBinPath("jscpd", "jscpd", cwd);
}

/** Source tree to scan: src/ when present, else the cwd. Exported for tests. */
export function sourceDir(cwd = process.cwd()): string {
  const src = path.join(cwd, "src");
  return fs.existsSync(src) && fs.statSync(src).isDirectory() ? src : cwd;
}

/** Threshold from .jscpd.json when present, else the default. Exported for tests. */
export function thresholdFor(cwd = process.cwd(), file?: string): number {
  const configPath = file ?? path.join(cwd, ".jscpd.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = jsonObject(fs.readFileSync(configPath, "utf8"));
      if (typeof config.threshold === "number" && config.threshold >= 0) return config.threshold;
    } catch {
      // Malformed config: fall through to default; jscpd will surface the error.
    }
  }
  return DEFAULT_THRESHOLD;
}

const cloneSide = (value: unknown) => { const side = objectValue(value); return { file: stringValue(side.name), start: numberValue(side.start), end: numberValue(side.end) }; };

export function runDupes(cwd = process.cwd(), file?: string): DupesResult {
  const bin = jscpdBinPath(cwd);
  const dir = sourceDir(cwd);
  const threshold = thresholdFor(cwd, file);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-dupes-"));
  try {
    const args = [
      "--min-lines", "5",
      "--min-tokens", "50",
      "--reporters", "json",
      "--output", outDir,
      "--silent",
    ];
    const configPath = file ?? path.join(cwd, ".jscpd.json");
    if (fs.existsSync(configPath)) args.push("--config", configPath);
    args.push(dir);

    const out = runNodeTool(bin, args, cwd);
    if (out.error) throw new Error(`jscpd failed to run: ${out.error.message}`);
    if (out.status !== 0 && out.status !== 1) throw new Error(`jscpd exited ${out.status}`);

    const reportPath = path.join(outDir, "jscpd-report.json");
    if (!fs.existsSync(reportPath)) {
      throw new Error(`jscpd produced no report (stderr: ${(out.stderr ?? "").slice(0, 500)})`);
    }
    const report = jsonObject(fs.readFileSync(reportPath, "utf8"));

    const clones: Clone[] = arrayValue(report.duplicates).map((value) => {
      const duplicate = objectValue(value);
      return { lines: numberValue(duplicate.lines), tokens: numberValue(duplicate.tokens), first: cloneSide(duplicate.firstFile), second: cloneSide(duplicate.secondFile) };
    });
    const total = objectValue(objectValue(report.statistics).total);
    const { percentage, files } = reportStatistics({ percentage: numberValue(total.percentage), sources: numberValue(total.sources) });
    if (out.status !== 0 && percentage <= threshold) throw new Error("jscpd exited nonzero without a threshold violation");
    return { clean: percentage <= threshold, percentage, threshold, clones, files };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** Human-readable report. Returns true when duplication is under the threshold. */
export function reportDupes(cwd = process.cwd()): boolean {
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
  if (result.clones.length > 20) console.log(`  … and ${result.clones.length - 20} more`);
  console.log("\nExtract the shared logic into one module, or raise `threshold` in .jscpd.json.\n");
  return false;
}
