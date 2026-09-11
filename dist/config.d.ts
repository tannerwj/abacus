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
        loc?: {
            roots: string[];
            slack?: number;
        };
        /** oxlint warning + error count for `.` (slack 0). */
        oxlintWarnings?: boolean;
        /** Highest ABC score in the project (slack 0). */
        abcMax?: boolean;
        /** Comment lines / code lines per root; `max` is a fixed ceiling, snapshot still ratchets. */
        comments?: {
            roots: string[];
            max?: number;
        };
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
        allow: Record<string, {
            max: number;
            why: string;
        }>;
    };
    size: {
        budgets: SizeBudget[];
        /** Cloudflare Worker: gzip budget for `wrangler deploy --dry-run` output. */
        worker?: {
            max: number;
            wranglerArgs?: string[];
        };
    };
    ratchet: RatchetConfig;
}
export declare const CONFIG_FILE = "abacus.config.json";
export declare function defaults(preset: Preset): AbacusConfig;
export declare function loadConfig(cwd?: string): AbacusConfig;
