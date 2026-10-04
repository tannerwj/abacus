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
