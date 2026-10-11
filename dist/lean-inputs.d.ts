import { type LeanConfig } from "./lean-config.js";
export interface LeanInput {
    path: string;
    digest: string;
}
export declare function leanInputFile(cwd: string, relative: string): string;
export declare function leanInputs(config: LeanConfig, cwd: string): LeanInput[];
