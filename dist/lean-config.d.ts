export declare const LEAN_TOOLCHAIN = "leanprover/lean4:v4.34.1";
export declare const LEAN_TOOLS: readonly ["lean", "lake", "leanchecker"];
export interface LeanTarget {
    module: string;
    name: string;
    typeDigest: string;
}
export interface LeanConfig {
    project: string;
    specifications: string[];
    toolchain: typeof LEAN_TOOLCHAIN;
    toolchainDigest: string;
    tools: Record<(typeof LEAN_TOOLS)[number], string>;
    targets: LeanTarget[];
}
export declare function leanFields(value: unknown, keys: string[]): Record<string, unknown>;
export declare function leanHash(value: unknown): string;
export declare function leanName(value: unknown): string;
export declare function leanPath(value: unknown): string;
export declare function leanUnique(values: string[]): void;
export declare function leanTools(value: unknown): LeanConfig["tools"];
export declare function leanTarget(value: unknown): LeanTarget;
export declare function validateLeanConfig(value: unknown): LeanConfig;
export declare function leanConfigurationDigest(config: LeanConfig): string;
