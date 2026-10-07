import { type VerificationSummary, type ReportFormat } from "./verification-reports.js";
import { type VerificationProfile } from "./verification-config.js";
import type { RunEvidence } from "./evidence.js";
export declare const VERIFICATION_ISSUES: readonly ["execution-timeout", "execution-error", "missing-report", "invalid-report", "source-changed"];
export interface VerificationRecord {
    schemaVersion: 1;
    id: string;
    profile: VerificationProfile;
    environment: "isolated" | "staging";
    source: RunEvidence["source"];
    runtime: {
        node: string;
        platform: string;
        arch: string;
    };
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    command: {
        digest: string;
        executableDigest: string;
        exitCode: number | null;
    };
    report?: {
        path: string;
        format: ReportFormat;
        digest: string;
    };
    summary: VerificationSummary;
    issues: Array<(typeof VERIFICATION_ISSUES)[number]>;
}
export declare function assertVerificationRecord(value: unknown): asserts value is VerificationRecord;
