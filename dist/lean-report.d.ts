import { LEAN_TOOLCHAIN, type LeanConfig, type LeanTarget } from "./lean-config.js";
import { type LeanInput } from "./lean-inputs.js";
import type { VerificationSummary } from "./verification-reports.js";
export interface LeanCheckedTarget extends LeanTarget {
    axioms: string[];
    checked: true;
    rechecked: true;
}
export interface LeanReport {
    schemaVersion: 1;
    kind: "lean";
    claim: "model";
    configurationDigest: string;
    adapterDigest: string;
    toolchain: typeof LEAN_TOOLCHAIN;
    toolchainDigest: string;
    tools: LeanConfig["tools"];
    inputs: LeanInput[];
    targets: LeanCheckedTarget[];
}
export declare function parseLeanReport(value: unknown): LeanReport;
export declare function leanSummary(value: unknown): VerificationSummary;
export declare function validateLeanEvidence(value: unknown, config: LeanConfig, cwd: string): void;
