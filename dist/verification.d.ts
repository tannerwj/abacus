import { type AdapterResult, type RunEvidence } from "./evidence.js";
import { type VerificationProfile, type VerificationSpec } from "./verification-config.js";
import { type ReportFormat } from "./verification-reports.js";
import { type VerificationRecord } from "./verification-envelope.js";
export type { VerificationRecord } from "./verification-envelope.js";
export interface RecordVerificationOptions {
    id: string;
    profile: VerificationProfile;
    format: ReportFormat;
    report: string;
    evidence: string;
    command: string[];
    environment?: "isolated" | "staging";
    timeoutMs?: number;
}
export declare function recordVerification(options: RecordVerificationOptions, cwd?: string): VerificationRecord;
export declare function verificationEvidence(spec: VerificationSpec, cwd: string, source: RunEvidence["source"], evaluatedAt: string): AdapterResult;
