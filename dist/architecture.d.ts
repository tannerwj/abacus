import { type AdapterResult } from "./evidence.js";
export interface ArchitectureOptions {
    /** Inspectable native rules; no architecture is inferred. */
    configPath?: string;
    /** Complete source roots, never a changed-file list. Defaults to the repository. */
    targets?: string[];
}
/** Native forbidden-rule validation over a complete configured dependency graph. */
export declare function runArchitecture(cwd?: string, options?: ArchitectureOptions): AdapterResult;
