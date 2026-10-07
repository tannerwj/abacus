import { type ReportFormat, type Measurement } from "./verification-reports.js";
import type { Enforcement } from "./evidence.js";
export declare const VERIFICATION_PROFILES: readonly ["behavior", "authorization", "resilience", "performance", "dependencies"];
export type VerificationProfile = (typeof VERIFICATION_PROFILES)[number];
export interface VerificationBudget {
    id: string;
    unit: Measurement["unit"];
    max: number;
    minSamples: number;
}
export interface VerificationSpec {
    id: string;
    path: string;
    format: ReportFormat;
    profile: VerificationProfile;
    required: boolean;
    enforcement: Enforcement;
    maxAgeHours?: number;
    maxSkipped?: number;
    maxFlaky?: number;
    environment?: "isolated" | "staging";
    assertions?: string[];
    budgets?: VerificationBudget[];
}
export interface VerificationConfig {
    reports: VerificationSpec[];
}
export declare function validateVerificationConfig(value: unknown): VerificationConfig;
