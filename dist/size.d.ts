import type { AbacusConfig } from "./config.js";
export declare function gzipSize(file: string): number;
export interface SizeResult {
    label: string;
    actual: number;
    max: number;
    ok: boolean;
}
export declare function measureBudgets(config: AbacusConfig, cwd?: string): SizeResult[];
export declare function reportSize(config: AbacusConfig, cwd?: string): boolean;
