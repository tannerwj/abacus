export type Preset = "typescript" | "cloudflare-worker" | "vite-spa";
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
}
export declare const CONFIG_FILE = "abacus.config.json";
export declare function defaults(preset: Preset): AbacusConfig;
export declare function loadConfig(cwd?: string): AbacusConfig;
