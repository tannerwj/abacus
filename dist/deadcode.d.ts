export interface DeadcodeIssue {
    /** knip issue type: files, exports, types, enumMembers, dependencies, ... */
    type: string;
    file: string;
    line?: number;
    name: string;
}
export interface DeadcodeReport {
    issues: DeadcodeIssue[];
    /** issue type -> count */
    counts: Record<string, number>;
}
/** Path to the knip binary bundled with abacus, resolved relative to this module. */
export declare function knipBinPath(): string;
/** Parse knip's `--reporter json` output into a flat issue list. Exported for tests. */
export declare function parseKnipJson(stdout: string): DeadcodeReport;
export declare function runKnip(cwd?: string): DeadcodeReport;
/** Human-readable report. Returns true when clean (no dead code). */
export declare function reportDeadcode(cwd?: string): boolean;
/**
 * Detect knip `entry` points for `abacus init`: package.json main/exports/bin
 * plus src/index.ts when it exists (the Cloudflare Worker default).
 * Exported for tests.
 */
export declare function detectKnipEntry(cwd?: string): string[];
/** knip.json content for `abacus init`. Entry points are detected, not guessed. */
export declare function knipConfig(cwd?: string): string;
