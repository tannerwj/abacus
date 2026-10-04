import { type AbacusConfig } from "./config.js";
import { type AdapterResult } from "./evidence.js";
/** Check every selected project independently. Reference builds and source cache writes are never requested. */
export declare function typescriptEvidence(config: AbacusConfig, cwd: string): AdapterResult;
export declare function reportTypeScriptProfile(config: AbacusConfig, cwd?: string): boolean;
