import { type AbacusConfig, type CheckGate } from "./config.js";
export type GateRunners = Record<CheckGate, () => boolean>;
/** Run every selected gate, including after a failure, to show the whole result. */
export declare function runGates(gates: CheckGate[], runners: GateRunners): boolean;
export declare function reportCheck(config: AbacusConfig, gates?: ("lint" | "abc" | "ratchet" | "tsc" | "deadcode" | "secrets" | "cycles" | "dupes" | "todos" | "size")[], cwd?: string, top?: number): boolean;
