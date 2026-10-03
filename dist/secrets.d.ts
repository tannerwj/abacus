export interface SecretFinding {
    file: string;
    line: number;
    /** gitleaks rule id, e.g. "stripe-access-token" */
    rule: string;
    /** short description of the rule, when available */
    description: string;
}
/** Path to the gitleaks binary bundled with abacus, resolved relative to this module. */
export declare function gitleaksBinPath(): string;
/** Run gitleaks detect on the working tree. Secret values are dropped, never returned. */
export declare function scanSecrets(cwd?: string): SecretFinding[];
/** Human-readable report. Returns true when clean (no findings). */
export declare function reportSecrets(cwd?: string): boolean;
