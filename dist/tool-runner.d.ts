/**
 * Resolve the declared JavaScript CLI, preferring the project's installation.
 * npm/pnpm .bin files may be shell or Windows .cmd shims, not Node programs.
 */
export declare function nodeToolBinPath(packageName: string, command: string, cwd?: string, moduleUrl?: string): string;
/** Run a declared Node CLI directly, with arguments kept out of a shell. */
export declare function runNodeTool(bin: string, args: string[], cwd: string, env?: Record<string, string>): import("child_process").SpawnSyncReturns<string>;
/** Metadata for the actual resolved installation, rather than a PATH guess. */
export declare function toolMetadata(bin: string, name: string): {
    name: string;
    version: string;
    digest: string;
};
