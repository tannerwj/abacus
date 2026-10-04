import type { AbacusConfig } from "./config.js";
export type Snapshot = Record<string, number>;
interface Metric {
    key: string;
    value: number;
    slack: number;
    max?: number;
}
/** Code vs comment-only lines, via the TS scanner so strings containing `//` are not miscounted. */
export declare function countLines(text: string): {
    code: number;
    comment: number;
};
/** Prefer the repo's own binary so this works outside `pnpm run` too. */
export declare function localBin(name: string, cwd?: string): string;
export declare function measureRatchet(config: AbacusConfig, cwd?: string): Metric[];
export declare function enabledMetricKeys(config: AbacusConfig): string[];
export declare function readSnapshot(file: string, keys: string[]): Snapshot | string;
export declare function reportRatchet(config: AbacusConfig, write: boolean, cwd?: string): boolean;
export {};
