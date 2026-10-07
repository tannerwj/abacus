import { type RunEvidence } from "./evidence.js";
export type StandardsClassification = "weakening" | "tightening" | "review";
export interface StandardsChange {
    file: string;
    field: string;
    classification: StandardsClassification;
    reason: string;
    beforeDigest: string;
    afterDigest: string;
}
export interface StandardsReport {
    schemaVersion: 1;
    base: {
        commit: string;
    };
    source: RunEvidence["source"];
    changes: StandardsChange[];
    clean: boolean;
    limitations: string[];
}
export declare function reportStandards(base: string, cwd?: string): StandardsReport;
