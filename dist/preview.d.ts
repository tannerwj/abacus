import type { CheckEvidence, Finding, RunEvidence } from "./evidence.js";
import { type PolicyPack, type RepositoryException } from "./policy.js";
export interface PreviewFinding extends Finding {
    checkId: string;
}
export interface PreviewChange {
    id: string;
    kind: "added" | "removed" | "changed";
    before?: unknown;
    after?: unknown;
}
export interface PolicyPreview {
    schemaVersion: 1;
    evaluatedAt: string;
    source: RunEvidence["source"];
    from: RunEvidence["policy"];
    to: RunEvidence["policy"];
    ruleChanges: PreviewChange[];
    nativeConfigChanges: PreviewChange[];
    thresholdChanges: PreviewChange[];
    enforcementChanges: PreviewChange[];
    addedFindings: PreviewFinding[];
    resolvedFindings: PreviewFinding[];
    newBlockers: Array<{
        checkId: string;
        outcome: CheckEvidence["outcome"];
        fingerprints: string[];
    }>;
    affectedExceptions: Array<{
        id: string;
        reasons: string[];
        matchedBefore: number;
        matchedAfter: number;
    }>;
    cleanBefore: boolean;
    cleanAfter: boolean;
}
export interface PreviewOptions {
    beforePack?: PolicyPack;
    afterPack?: PolicyPack;
    exceptions?: RepositoryException[];
}
/**
 * Pure comparison of already evaluated runs. It never invokes a tool, touches a source file,
 * changes a pin/exception, or creates a ratchet baseline. Evaluate both policies first on one tree.
 */
export declare function comparePolicyRuns(before: RunEvidence, after: RunEvidence, options?: PreviewOptions): PolicyPreview;
