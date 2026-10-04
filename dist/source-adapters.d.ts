import type { AbacusConfig, CheckGate } from "./config.js";
import { type AdapterResult } from "./evidence.js";
export declare function lintEvidence(cwd: string, configPath?: string): AdapterResult;
export declare function runSourceAdapter(gate: CheckGate, config: AbacusConfig, cwd: string, evaluatedAt: string, nativeConfig?: string): AdapterResult;
