export interface CycleViolation {
    from: string;
    to: string;
    cycle: string[];
    rule: string;
    severity: "error" | "warn" | "info" | "ignore";
}
export interface CyclesResult {
    clean: boolean;
    violations: CycleViolation[];
    files: number;
    /** Imports dependency-cruiser could not resolve; cycle coverage may be incomplete. */
    unresolved: number;
}
/** Project's depcruise if installed, else the one bundled with abacus. */
export declare function depcruiseBinPath(cwd?: string): string;
/** Repo config if present, else abacus's bundled template. Exported for tests. */
export declare function cruiseConfigPath(cwd?: string): string;
/** Source tree to cruise: src/ when present, else the cwd. Exported for tests. */
export declare function sourceDir(cwd?: string): string;
export declare function runCycles(cwd?: string, configPath?: string): CyclesResult;
/** Human-readable report. Returns true when no cycles were found. */
export declare function reportCycles(cwd?: string): boolean;
