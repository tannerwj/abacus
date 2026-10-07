export declare const REPORT_FORMATS: readonly ["vitest", "playwright", "contract", "pnpm-audit"];
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type CaseStatus = "passed" | "failed" | "skipped";
export interface Measurement {
    value: number;
    unit: "ms" | "bytes" | "count";
    samples: number;
}
export interface VerificationSummary {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    timedOut: number;
    errors: number;
    cases: Array<{
        id: string;
        status: CaseStatus;
    }>;
    measurements: Record<string, Measurement>;
    limitations: string[];
}
export declare function reportObject(value: unknown): Record<string, unknown>;
export declare function reportArray(value: unknown): unknown[];
export declare function count(value: unknown): number;
export declare function reportId(value: unknown): string;
export declare function parseVerificationReport(format: ReportFormat, value: unknown): VerificationSummary;
