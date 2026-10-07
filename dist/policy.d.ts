import { type AbacusConfig } from "./config.js";
import { type AdapterResult, type Enforcement, type Finding } from "./evidence.js";
export declare const POLICY_GATES: readonly ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos", "size", "architecture", "package"];
export type PolicyGate = typeof POLICY_GATES[number];
type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;
export type PolicyParameters = DeepPartial<Omit<AbacusConfig, "check" | "policy" | "verification">> & {
    architecture?: {
        targets?: string[];
    };
    package?: {
        modes?: Array<"node16-esm" | "node16-cjs" | "bundler">;
        publintLevel?: "suggestion" | "warning" | "error";
        attwProfile?: "strict" | "node16" | "esm-only";
    };
};
export interface PolicyCheck {
    id: string;
    gate: PolicyGate;
    required: boolean;
    enforcement: Enforcement;
    severity: Finding["severity"];
    rationale: string;
    nativeConfig?: string;
    parameters?: PolicyParameters;
}
export interface PolicyPack {
    schemaVersion: 1;
    name: string;
    version: string;
    compatibility: {
        adapterVersion: 1;
        evidenceSchemaVersion: 1;
        abacus?: string;
        tools?: Record<string, string>;
    };
    checks: PolicyCheck[];
    /** Explicit inventory of bundled native-config companions, relative to the pack JSON. */
    nativeFiles?: string[];
}
export type PolicyPackReference = {
    version: string;
    digest: string;
} & ({
    path: string;
    package?: never;
    export?: never;
} | {
    package: string;
    export: string;
    path?: never;
});
export interface ResolvedPolicyPack {
    pack: PolicyPack;
    name: string;
    version: string;
    digest: string;
    source: string;
    /** Exact manifest bytes parsed at resolution, including whitespace, for live integrity checks. */
    manifest: {
        path: string;
        digest: string;
    };
    nativeConfigs: Array<{
        checkId: string;
        path: string;
        digest: string;
    }>;
    nativeFiles: Array<{
        path: string;
        digest: string;
    }>;
}
export interface PolicyRuntime {
    adapterVersion?: number;
    evidenceSchemaVersion?: number;
    abacus?: string;
    tools?: Record<string, string>;
}
export interface RepositoryException {
    id: string;
    ruleId: string;
    subject: string;
    owner: string;
    reason: string;
    expires: string;
}
export declare function validatePolicyParameters(value: unknown): PolicyParameters;
export declare function validatePolicyPack(value: unknown): PolicyPack;
/** Stable key ordering makes JSON whitespace/ordering irrelevant, while every native byte is pinned. */
export declare function canonicalPolicyJson(value: unknown): string;
export declare function computePolicyPackDigest(packOrFile: PolicyPack | string, root?: string): string;
export declare function resolvePolicyPack(ref: PolicyPackReference, cwd?: string, runtime?: PolicyRuntime): ResolvedPolicyPack;
export declare function satisfiesToolVersion(version: string, requirement: string): boolean;
export declare function assertPolicyCompatibility(pack: PolicyPack, runtime: PolicyRuntime): void;
export declare function validateExceptions(value: unknown): RepositoryException[];
export declare function evaluationDate(evaluatedAt: string): string;
export declare function expiredExceptions(exceptions: RepositoryException[], evaluatedAt: string): RepositoryException[];
/** Pure, exact-match overlays. Waivers cannot turn tool errors or incomplete scans into success. */
export declare function applyExceptions<T extends AdapterResult>(result: T, exceptions: RepositoryException[], evaluatedAt: string): T;
/** Merge only supported parameters; arrays replace rather than concatenate. No baseline is written. */
export declare function applyPolicyParameters(config: AbacusConfig, parameters?: PolicyParameters): AbacusConfig;
export {};
