import { type LeanReport } from "./lean-report.js";
export interface RunLeanOptions {
    id: string;
    report: string;
    toolchainDir: string;
    timeoutMs?: number;
}
export declare function digestToolchain(toolchainDir: string): string;
export declare function runLeanVerification(options: RunLeanOptions, cwd?: string): LeanReport;
