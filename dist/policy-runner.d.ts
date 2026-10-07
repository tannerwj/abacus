import { type AbacusConfig, type CheckGate } from "./config.js";
import { type AdapterResult, type CheckEvidence, type RunEvidence } from "./evidence.js";
import { type PolicyCheck, type ResolvedPolicyPack } from "./policy.js";
export interface EvaluateOptions {
    gates?: CheckGate[];
    includeRepositoryGates?: boolean;
    policy?: ResolvedPolicyPack;
    evaluatedAt?: string;
    /** Used for deterministic fixture testing; ordinary CLI always uses the real adapters. */
    adapter?: (check: PolicyCheck, config: AbacusConfig, cwd: string, evaluatedAt: string, nativeConfig?: string) => AdapterResult;
}
export declare function blocks(check: Pick<CheckEvidence, "required" | "enforcement" | "outcome" | "coverage">): boolean;
/** No baseline writes, network updates, native configuration rewrites, or fixes. */
export declare function evaluatePolicy(config: AbacusConfig, cwd?: string, options?: EvaluateOptions): RunEvidence;
export declare function printEvidence(run: RunEvidence): void;
