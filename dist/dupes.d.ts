export interface Clone {
    lines: number;
    tokens: number;
    first: {
        file: string;
        start: number;
        end: number;
    };
    second: {
        file: string;
        start: number;
        end: number;
    };
}
export interface DupesResult {
    clean: boolean;
    percentage: number;
    threshold: number;
    clones: Clone[];
}
export declare const DEFAULT_THRESHOLD = 5;
/** Project's jscpd if installed, else the one bundled with abacus. */
export declare function jscpdBinPath(cwd?: string): string;
/** Source tree to scan: src/ when present, else the cwd. Exported for tests. */
export declare function sourceDir(cwd?: string): string;
/** Threshold from .jscpd.json when present, else the default. Exported for tests. */
export declare function thresholdFor(cwd?: string): number;
export declare function runDupes(cwd?: string): DupesResult;
/** Human-readable report. Returns true when duplication is under the threshold. */
export declare function reportDupes(cwd?: string): boolean;
