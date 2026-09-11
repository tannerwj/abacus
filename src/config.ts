/**
 * abacus.config.json — lives in the consuming repo so every budget and every
 * exemption is owned (and reviewed) there. Everything has a default; an empty
 * `{}` is a valid config for the `typescript` preset.
 */
import fs from "node:fs";
import path from "node:path";

export type Preset = "typescript" | "cloudflare-worker" | "vite-spa" | "nextjs";

export interface SizeBudget {
  label: string;
  /** Directory holding built assets, relative to the repo root. */
  dir: string;
  /** Regex (string) matched against file names in `dir`. */
  match: string;
  /** Max gzip bytes. */
  max: number;
  /** `sum` (default) adds every matching file; `largest` gates the biggest single file. */
  mode?: "sum" | "largest";
}

export interface RatchetConfig {
  /** Snapshot file, committed to the repo. */
  file: string;
  metrics: {
    /** Code lines (no blank / comment-only) per root; `slack` = allowed growth fraction. */
    loc?: { roots: string[]; slack?: number };
    /** oxlint warning + error count for `.` (slack 0). */
    oxlintWarnings?: boolean;
    /** Highest ABC score in the project (slack 0). */
    abcMax?: boolean;
    /** Comment lines / code lines per root; `max` is a fixed ceiling, snapshot still ratchets. */
    comments?: { roots: string[]; max?: number };
  };
}

export interface AbacusConfig {
  preset: Preset;
  /** Source roots scanned for ABC scores. */
  roots: string[];
  /** Regex strings; matching paths are skipped by the ABC scan (generated/vendored code). */
  exclude: string[];
  abc: {
    budget: number;
    /** `"<file> <function>": { max, why }` — known debt, each with a reason. */
    allow: Record<string, { max: number; why: string }>;
  };
  size: {
    budgets: SizeBudget[];
    /** Cloudflare Worker: gzip budget for `wrangler deploy --dry-run` output. */
    worker?: { max: number; wranglerArgs?: string[] };
  };
  ratchet: RatchetConfig;
}

export const CONFIG_FILE = "abacus.config.json";
const KB = 1024;

export function defaults(preset: Preset): AbacusConfig {
  const base: AbacusConfig = {
    preset,
    roots: ["src", "scripts"],
    exclude: ["\\.d\\.ts$", "\\.test\\.tsx?$", "/components/ui/"],
    abc: { budget: 60, allow: {} },
    size: { budgets: [] },
    ratchet: { file: "abacus.ratchet.json", metrics: { loc: { roots: ["src"], slack: 0.02 }, oxlintWarnings: true, abcMax: true, comments: { roots: ["src"], max: 0.3 } } }
  };
  if (preset === "cloudflare-worker") base.size.worker = { max: 400 * KB };
  if (preset === "nextjs") base.exclude.push("/components/ui/", "^\\.next/", "^\\.open-next/", "next-env\\.d\\.ts$");
  if (preset === "vite-spa" || preset === "cloudflare-worker") {
    base.size.budgets = [
      { label: "SPA JS (all chunks, gzip)", dir: "dist/client/assets", match: "\\.js$", max: 280 * KB },
      { label: "SPA largest JS chunk (gzip)", dir: "dist/client/assets", match: "\\.js$", max: 260 * KB, mode: "largest" },
      { label: "SPA CSS (gzip)", dir: "dist/client/assets", match: "\\.css$", max: 20 * KB }
    ];
  }
  return base;
}

export function loadConfig(cwd = process.cwd()): AbacusConfig {
  const file = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(file)) return defaults("typescript");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AbacusConfig> & { $schema?: string };
  const base = defaults(raw.preset ?? "typescript");
  return {
    preset: raw.preset ?? base.preset,
    roots: raw.roots ?? base.roots,
    exclude: raw.exclude ?? base.exclude,
    abc: { budget: raw.abc?.budget ?? base.abc.budget, allow: raw.abc?.allow ?? {} },
    size: { budgets: raw.size?.budgets ?? base.size.budgets, worker: raw.size?.worker ?? base.size.worker },
    ratchet: { file: raw.ratchet?.file ?? base.ratchet.file, metrics: raw.ratchet?.metrics ?? base.ratchet.metrics }
  };
}
