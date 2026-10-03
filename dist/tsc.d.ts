export interface TscResult {
    /** true when tsc reported zero errors */
    clean: boolean;
    /** raw error lines (empty when clean) */
    errors: string[];
    /** effective compiler options after resolving tsconfig extends */
    options: Record<string, unknown>;
    /** tsconfig path used, if any */
    configPath?: string;
}
/** Project's tsc if installed, else the TypeScript bundled with abacus. */
export declare function tscBinPath(cwd?: string): string;
/** Resolve the effective tsconfig (following `extends`) via the TS API. Exported for tests. */
export declare function effectiveOptions(cwd?: string): {
    options: Record<string, unknown>;
    configPath?: string;
};
export declare function runTsc(cwd?: string): TscResult;
/** Beyond-`strict` flags worth adopting, with the one-line reason. */
export declare const STRICTNESS_FLAGS: Array<{
    flag: string;
    why: string;
}>;
/** Human-readable report. Returns true when tsc is clean (strictness gaps are advisory). */
export declare function reportTsc(cwd?: string): boolean;
