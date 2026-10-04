export interface CompilerInputs {
    options: Record<string, unknown>;
    configPath?: string;
    configs: Array<{
        path: string;
        digest: string;
    }>;
    incompleteReason?: string;
}
export declare function assertCompilerSource(cwd: string, file: string): void;
/** Inspect actual extends reads without allowing an implicit parent project or external files. */
export declare function inspectCompilerInputs(cwd: string, project?: string): CompilerInputs;
