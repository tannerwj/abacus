import type { PolicyPackReference, RepositoryException } from "./policy.js";
import { type VerificationConfig } from "./verification-config.js";
export type Preset = "typescript" | "cloudflare-worker" | "vite-spa" | "nextjs";
export declare const CHECK_GATES: readonly ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos", "size"];
export type CheckGate = typeof CHECK_GATES[number];
/** Source gates can run before a build. Size remains an explicit post-build gate. */
export declare const SOURCE_GATES: CheckGate[];
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
    /** Permit no matching built files for an optional asset budget (default false). */
    allowEmpty?: boolean;
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
    /** Gates selected by `abacus check`; new source gates are opt-in. */
    check: {
        gates: CheckGate[];
    };
    /** Source roots scanned for ABC scores. */
    roots: string[];
    /** Each project is checked separately with its own platform/compiler options. */
    tsc: {
        projects: string[];
    };
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
    /** Optional immutable organization pack. Ordinary checks never update its pin. */
    policy?: {
        pack: PolicyPackReference;
        exceptions?: RepositoryException[];
    };
    verification?: VerificationConfig;
    /** Regex strings (project-relative, `/`-separated; directories end in `/`) for paths left out of the source digest: tool state that changes while checks run, never source. */
    provenance?: {
        exclude: string[];
    };
}
export declare const CONFIG_FILE = "abacus.config.json";
export declare function defaults(preset: Preset): AbacusConfig;
export declare function loadConfig(cwd?: string): AbacusConfig;
/** Only read-only deployment selectors; protected dry-run/output flags are not configurable. */
export declare function validateWranglerArgs(input: unknown): string[];
export declare function assertProjectPath(cwd: string, input: string, label: string): void;
export declare function validateProjectInputs(config: AbacusConfig, cwd: string): void;
/** Runtime validation matters: JSON values do not acquire TypeScript's guarantees. */
export declare function validateAbacusConfig(config: AbacusConfig): void;
export declare function validateCheckGates(gates: unknown): CheckGate[];
/** Local JSON project selectors only; executable arguments and reference builds are unsupported. */
export declare function validateTscProjects(input: unknown, label?: string): string[];
