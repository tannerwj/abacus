export interface GraphRule {
    name: string;
    severity: "error" | "warn" | "info" | "ignore";
}
export interface GraphViolation {
    from: string;
    to?: string;
    rule: GraphRule;
    cycle?: Array<string | {
        name: string;
    }>;
}
export interface GraphModule {
    source: string;
    dependencies: Array<{
        resolved: string;
        couldNotResolve?: boolean;
    }>;
}
export interface GraphReport {
    modules: GraphModule[];
    summary: {
        violations: GraphViolation[];
        ruleSetUsed: {
            forbidden: GraphRule[];
        };
        optionsUsed: Record<string, unknown>;
        totalCruised: number;
        totalDependenciesCruised: number;
        advisedExitCode: number;
        environment?: {
            issues?: unknown[];
        };
    };
}
export declare class GraphInspectionError extends Error {
    readonly outcome: "incomplete" | "error";
    constructor(outcome: "incomplete" | "error", message: string);
}
export declare function parseGraphReport(text: string, status: number): GraphReport;
