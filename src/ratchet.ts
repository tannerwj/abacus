/**
 * `abacus ratchet` — aggregate ceilings that only move down. A snapshot
 * (abacus.ratchet.json) is the committed high-water mark; CI fails when a
 * metric grows past snapshot × (1 + slack) or a fixed `max`. Fixed per-function
 * budgets (oxlint, ABC) stop the worst offenders; the ratchet stops the slow creep.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { scoreProject } from "./abc.js";
import type { AbacusConfig } from "./config.js";

export type Snapshot = Record<string, number>;
interface Metric { key: string; value: number; slack: number; max?: number }

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/u;

/** Code vs comment-only lines, via the TS scanner so strings containing `//` are not miscounted. */
export function countLines(text: string): { code: number; comment: number } {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.JSX, text);
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const codeLines = new Set<number>(); const commentLines = new Set<number>();
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) continue;
    const start = lineOf(scanner.getTokenStart()), end = lineOf(scanner.getTokenEnd() - 1);
    const target = kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia ? commentLines : codeLines;
    for (let line = start; line <= end; line++) target.add(line);
  }
  for (const line of codeLines) commentLines.delete(line); // `x = 1; // note` is code
  return { code: codeLines.size, comment: commentLines.size };
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!["node_modules", "dist", ".next", ".open-next"].includes(entry.name)) walk(full, out); }
    else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

function linesForRoot(cwd: string, root: string): { code: number; comment: number } {
  const files: string[] = [];
  if (fs.existsSync(path.join(cwd, root))) walk(path.join(cwd, root), files);
  return files.reduce((sum, file) => { const n = countLines(fs.readFileSync(file, "utf8")); return { code: sum.code + n.code, comment: sum.comment + n.comment }; }, { code: 0, comment: 0 });
}

/** Prefer the repo's own binary so this works outside `pnpm run` too. */
export function localBin(name: string, cwd = process.cwd()): string { const local = path.join(cwd, "node_modules/.bin", name); return fs.existsSync(local) ? local : name; }

function oxlintCount(cwd: string): number {
  const out = spawnSync(localBin("oxlint", cwd), ["--format", "json", "."], { cwd, encoding: "utf8" });
  if (out.error) throw new Error(`oxlint not runnable: ${out.error.message}`);
  const json = out.stdout.slice(out.stdout.indexOf("{"));
  return (JSON.parse(json) as { diagnostics: unknown[] }).diagnostics.length;
}

export function measureRatchet(config: AbacusConfig, cwd = process.cwd()): Metric[] {
  const m = config.ratchet.metrics; const metrics: Metric[] = [];
  const lines = new Map<string, { code: number; comment: number }>();
  const linesFor = (root: string) => lines.get(root) ?? lines.set(root, linesForRoot(cwd, root)).get(root) ?? { code: 0, comment: 0 };
  for (const root of m.loc?.roots ?? []) metrics.push({ key: `loc ${root}`, value: linesFor(root).code, slack: m.loc?.slack ?? 0 });
  for (const root of m.comments?.roots ?? []) { const n = linesFor(root); metrics.push({ key: `comments ${root}`, value: Number((n.comment / Math.max(1, n.code)).toFixed(3)), slack: 0, max: m.comments?.max }); }
  if (m.abcMax) metrics.push({ key: "abcMax", value: scoreProject(config, cwd).scores[0]?.score ?? 0, slack: 0 });
  if (m.oxlintWarnings) metrics.push({ key: "oxlintWarnings", value: oxlintCount(cwd), slack: 0 });
  return metrics;
}

export function reportRatchet(config: AbacusConfig, write: boolean, cwd = process.cwd()): boolean {
  const file = path.join(cwd, config.ratchet.file);
  const metrics = measureRatchet(config, cwd);
  let snapshot: Snapshot = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot) : {};
  if (write || Object.keys(snapshot).length === 0) {
    snapshot = Object.fromEntries(metrics.map((x) => [x.key, x.value]));
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`${write ? "wrote" : "no snapshot yet — wrote"} ${config.ratchet.file}; fixed \`max\` ceilings still apply\n`);
  }
  let failed = 0, down = 0;
  for (const x of metrics) {
    const prev = snapshot[x.key] ?? x.value;
    const ceiling = Math.min(prev * (1 + x.slack), x.max ?? Infinity);
    const mark = x.value > ceiling ? "✗" : x.value < prev ? "↓" : " ";
    if (x.value > ceiling) failed++; else if (x.value < prev) down++;
    console.log(`${mark} ${x.key.padEnd(28)} ${String(x.value).padStart(9)}  ceiling ${Number(ceiling.toFixed(3))}${x.max !== undefined ? ` (max ${x.max})` : ""}`);
  }
  if (failed) { console.error(`\n${failed} metric(s) over the ratchet. Shrink it, or \`abacus ratchet --write\` as a deliberate, reviewed decision.`); return false; }
  if (down) console.log(`\nratchet down available: ${down} metric(s) decreased — run \`abacus ratchet --write\` to lock it in.`);
  else console.log("\nAll metrics within the ratchet.");
  return true;
}
