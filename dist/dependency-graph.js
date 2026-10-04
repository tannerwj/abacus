export class GraphInspectionError extends Error {
    outcome;
    constructor(outcome, message) {
        super(message);
        this.outcome = outcome;
    }
}
function object(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function validRule(value) {
    return object(value) && typeof value.name === "string" && !!value.name.trim()
        && typeof value.severity === "string" && ["error", "warn", "info", "ignore"].includes(value.severity);
}
function validViolation(value) {
    return object(value) && validRule(value.rule) && typeof value.from === "string"
        && (value.to === undefined || typeof value.to === "string")
        && (value.cycle === undefined || (Array.isArray(value.cycle) && value.cycle.every((item) => typeof item === "string" || (object(item) && typeof item.name === "string"))));
}
function validModule(value) {
    return object(value) && typeof value.source === "string" && Array.isArray(value.dependencies)
        && value.dependencies.every((dependency) => object(dependency) && typeof dependency.resolved === "string"
            && (dependency.couldNotResolve === undefined || typeof dependency.couldNotResolve === "boolean"));
}
function validReport(value) {
    if (!object(value) || !Array.isArray(value.modules) || !object(value.summary) || !value.modules.every(validModule))
        return false;
    const summary = value.summary;
    return Array.isArray(summary.violations) && summary.violations.every(validViolation)
        && object(summary.ruleSetUsed) && object(summary.optionsUsed)
        && Array.isArray(summary.ruleSetUsed.forbidden) && summary.ruleSetUsed.forbidden.every(validRule)
        && Number.isInteger(summary.totalCruised) && summary.totalCruised === value.modules.length
        && typeof summary.totalDependenciesCruised === "number" && Number.isInteger(summary.totalDependenciesCruised) && summary.totalDependenciesCruised >= 0
        && typeof summary.advisedExitCode === "number" && Number.isInteger(summary.advisedExitCode) && summary.advisedExitCode >= 0;
}
export function parseGraphReport(text, status) {
    let report;
    try {
        report = JSON.parse(text);
    }
    catch {
        throw new GraphInspectionError("error", "dependency-cruiser did not return valid JSON evidence.");
    }
    if (!validReport(report))
        throw new GraphInspectionError("error", "dependency-cruiser returned malformed graph evidence.");
    const errors = report.summary.violations.filter((item) => item.rule.severity === "error").length;
    const dependencies = report.modules.reduce((count, item) => count + item.dependencies.length, 0);
    if (report.summary.advisedExitCode !== errors || report.summary.totalDependenciesCruised !== dependencies)
        throw new GraphInspectionError("error", "dependency-cruiser graph counts disagree with native evidence.");
    if (report.summary.environment?.issues?.length)
        throw new GraphInspectionError("incomplete", "Native dependency-cruiser reports unavailable parser/transpiler coverage.");
    if (["focus", "reaches", "affected", "collapse"].some((key) => report.summary.optionsUsed[key]))
        throw new GraphInspectionError("incomplete", "A partial graph view cannot establish whole-graph coverage.");
    // JSON is a visualization reporter: it legitimately exits zero even when its
    // advisedExitCode is the number of native errors. Never interpret exit zero alone.
    if (status !== 0 && report.summary.advisedExitCode === 0) {
        throw new GraphInspectionError("error", "dependency-cruiser exit status disagrees with its native findings.");
    }
    return report;
}
