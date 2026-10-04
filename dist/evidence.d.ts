export type Outcome = "pass" | "fail" | "waived" | "not-applicable" | "incomplete" | "error";
export type Enforcement = "block" | "warn" | "observe";
export type ScopeKind = "file" | "package" | "graph" | "repository" | "built-assets";
export interface Finding {
    ruleId: string;
    subject: string;
    /** Safe, normalized evidence only. Never raw secret values or arbitrary tool output. */
    message: string;
    fingerprint: string;
    severity: "error" | "warning" | "info";
    exceptionId?: string;
    /** Explicit compiler-project context; no raw diagnostic text. */
    project?: string;
}
export interface CompilerDiagnostic {
    code: string;
    location?: {
        path: string;
        line: number;
        column: number;
    };
}
export interface CompilerProjectEvidence {
    project: string;
    outcome: Outcome;
    scope: AdapterResult["scope"];
    diagnostics: CompilerDiagnostic[];
    configs: Array<{
        path: string;
        digest: string;
    }>;
    /** Local, non-dependency source inputs reported by the actual compiler. */
    sources: Array<{
        path: string;
        digest: string;
    }>;
    /** Actual installed declaration/compiler library inputs, excluded from source coverage. */
    dependencies: Array<{
        path: string;
        digest: string;
    }>;
    /** Project selector and sorted config/source byte fingerprints, when complete. */
    inputDigest?: string;
    notes?: string[];
}
export interface AdapterResult {
    outcome: Outcome;
    scope: {
        kind: ScopeKind;
        targets: string[];
        scanned: number;
        unit: string;
        excluded?: string[];
    };
    findings: Finding[];
    metrics?: Record<string, number>;
    notes?: string[];
    tool?: {
        name: string;
        version: string;
        digest?: string;
    };
    tools?: Array<{
        name: string;
        version: string;
        digest?: string;
    }>;
    configs?: Array<{
        path: string;
        digest: string;
    }>;
    /** Independent compiler outcomes, retained even when another project is successful. */
    projects?: CompilerProjectEvidence[];
    errorCode?: AdapterFailureCode;
}
declare const SAFE_FAILURE_MESSAGES: {
    readonly "missing-baseline": "Committed ratchet baseline is missing. Create it only as an explicit reviewed baseline decision.";
    readonly "invalid-baseline": "Committed ratchet baseline is malformed or has invalid/missing metric values. Normal checks do not repair it.";
    readonly "unresolved-imports": "Dependency graph contains unresolved imports. Check aliases and runtime-specific modules in the native configuration.";
    readonly "unsupported-native-config": "The pinned native configuration uses an unsupported profile feature. Repository-local native configuration remains available.";
};
export type AdapterFailureCode = keyof typeof SAFE_FAILURE_MESSAGES;
/** Only known safe causes cross the tool boundary; arbitrary stderr remains private. */
export declare class AdapterFailure extends Error {
    readonly code: AdapterFailureCode;
    constructor(code: AdapterFailureCode);
}
export interface CheckEvidence extends AdapterResult {
    id: string;
    gate: string;
    required: boolean;
    enforcement: Enforcement;
    severity?: Finding["severity"];
    rationale?: string;
    blocking: boolean;
    counts: {
        findings: number;
        waived: number;
        active: number;
    };
}
export interface RunEvidence {
    schemaVersion: 1;
    fingerprintVersion: 1;
    evaluatedAt: string;
    source: {
        commit: string | null;
        treeDigest: string;
        dirty: boolean | null;
    };
    runtime: {
        node: string;
        platform: string;
        arch: string;
        abacus: string;
    };
    configDigest: string;
    policy: {
        name: string;
        version: string;
        digest: string;
        source: string;
    };
    checks: CheckEvidence[];
    clean: boolean;
}
export declare function digest(value: string | Uint8Array): string;
export declare function finding(ruleId: string, subject: string, message: string, severity?: Finding["severity"]): Finding;
export declare function validateAdapterResult(result: AdapterResult): void;
export {};
