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
/** Close config, extends, and reference reads without building unselected projects. */
export declare function inspectCompilerInputs(cwd: string, project?: string): CompilerInputs;
