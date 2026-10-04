import { type AbacusConfig, type CheckGate } from "./config.js";
export type GateRunners = Record<CheckGate, () => boolean>;
/** Compatibility helper for callers supplying their own boolean gates. */
export declare function runGates(gates: CheckGate[], runners: GateRunners): boolean;
export declare function reportCheck(config: AbacusConfig, gates?: ("lint" | "abc" | "ratchet" | "tsc" | "deadcode" | "secrets" | "cycles" | "dupes" | "todos" | "size")[], cwd?: string, _top?: number): boolean;
