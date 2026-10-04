/**
 * Gzip size budgets for built assets, plus the Cloudflare Worker bundle via
 * `wrangler deploy --dry-run`. Fails when a budget is exceeded so growth is a
 * decision recorded in abacus.config.json, not a surprise in production.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { AbacusConfig } from "./config.js";

const KB = 1024;
const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;

export function gzipSize(file: string): number { return gzipSync(fs.readFileSync(file)).length; }

export interface SizeResult { label: string; actual: number; max: number; ok: boolean; error?: string }

export function measureBudgets(config: AbacusConfig, cwd = process.cwd()): SizeResult[] {
  const results: SizeResult[] = [];
  for (const budget of config.size.budgets) {
    const dir = path.join(cwd, budget.dir);
    if (!fs.existsSync(dir)) throw new Error(`${budget.label}: ${budget.dir} missing — build first`);
    const re = new RegExp(budget.match, "u");
    const sizes = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => re.test(entry.name) && (entry.isFile() || (entry.isSymbolicLink() && fs.statSync(path.join(dir, entry.name)).isFile()))).map((entry) => gzipSize(path.join(dir, entry.name)));
    if (sizes.length === 0 && budget.allowEmpty !== true) {
      results.push({ label: budget.label, actual: 0, max: budget.max, ok: false, error: `No files matching ${JSON.stringify(budget.match)} in ${budget.dir} — build first or correct the budget configuration.` });
      continue;
    }
    const actual = budget.mode === "largest" ? Math.max(0, ...sizes) : sizes.reduce((sum, size) => sum + size, 0);
    results.push({ label: budget.label, actual, max: budget.max, ok: actual <= budget.max });
  }
  if (config.size.worker) {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-worker-"));
    try {
      const out = execSync(`wrangler deploy --dry-run --outdir ${outdir} ${(config.size.worker.wranglerArgs ?? []).join(" ")}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const match = /Total Upload: ([\d.]+) KiB \/ gzip: ([\d.]+) KiB/u.exec(out);
      if (!match) throw new Error("could not parse `wrangler deploy --dry-run` size output");
      const actual = Number(match[2]) * KB;
      results.push({ label: "Worker bundle (gzip, wrangler dry-run)", actual, max: config.size.worker.max, ok: actual <= config.size.worker.max });
    } finally {
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  }
  return results;
}

export function reportSize(config: AbacusConfig, cwd = process.cwd()): boolean {
  if (config.size.budgets.length === 0 && !config.size.worker) { console.log("No size budgets configured (abacus.config.json → size)."); return true; }
  const results = measureBudgets(config, cwd);
  for (const r of results) {
    console.log(`${r.ok ? " " : "✗"} ${r.label.padEnd(42)} ${kb(r.actual).padStart(10)} / ${kb(r.max)}`);
    if (r.error) console.error(`  ${r.error}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.error("\nSize budget check failed. Verify matching build assets; raise a size limit only as a deliberate decision."); return false; }
  console.log("\nAll bundles within budget.");
  return true;
}
