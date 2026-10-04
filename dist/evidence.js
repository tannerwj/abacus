import { createHash } from "node:crypto";
const SAFE_FAILURE_MESSAGES = {
    "missing-baseline": "Committed ratchet baseline is missing. Create it only as an explicit reviewed baseline decision.",
    "invalid-baseline": "Committed ratchet baseline is malformed or has invalid/missing metric values. Normal checks do not repair it.",
    "unresolved-imports": "Dependency graph contains unresolved imports. Check aliases and runtime-specific modules in the native configuration.",
    "unsupported-native-config": "The pinned native configuration uses an unsupported profile feature. Repository-local native configuration remains available.",
};
/** Only known safe causes cross the tool boundary; arbitrary stderr remains private. */
export class AdapterFailure extends Error {
    code;
    constructor(code) {
        super(SAFE_FAILURE_MESSAGES[code]);
        this.code = code;
    }
}
export function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function finding(ruleId, subject, message, severity = "error") {
    // Deliberately excludes line numbers and threshold values: logical subject continuity.
    return { ruleId, subject, message, severity, fingerprint: digest(JSON.stringify([1, ruleId, subject])) };
}
export function validateAdapterResult(result) {
    if (!["pass", "fail", "waived", "not-applicable", "incomplete", "error"].includes(result.outcome))
        throw new Error("Invalid adapter outcome");
    if (!result.scope || !["file", "package", "graph", "repository", "built-assets"].includes(result.scope.kind) || !Array.isArray(result.scope.targets) || !result.scope.targets.every((item) => typeof item === "string") || !Number.isInteger(result.scope.scanned) || result.scope.scanned < 0 || !result.scope.unit)
        throw new Error("Invalid adapter scope");
    if (!Array.isArray(result.findings))
        throw new Error("Invalid adapter findings");
    for (const item of result.findings) {
        if (!item.ruleId || !item.subject || typeof item.message !== "string" || !/^[a-f0-9]{64}$/u.test(item.fingerprint) || !["error", "warning", "info"].includes(item.severity))
            throw new Error("Invalid adapter finding");
    }
    if (result.outcome === "pass" && result.findings.some((item) => item.severity === "error" && !item.exceptionId))
        throw new Error("Adapter passed despite error findings");
    if (result.projects)
        validateCompilerProjects(result);
}
function validateCompilerProject(project) {
    if (!project.project || !["pass", "fail", "incomplete", "error"].includes(project.outcome) || !Number.isInteger(project.scope.scanned) || project.scope.scanned < 0)
        throw new Error("Invalid compiler project evidence");
    if (["pass", "fail"].includes(project.outcome) && project.scope.scanned === 0)
        throw new Error("Compiler project has no checked sources");
    if (project.sources.length !== project.scope.scanned)
        throw new Error("Compiler project source count mismatch");
    if (["pass", "fail"].includes(project.outcome) && (!project.inputDigest || !project.configs.length))
        throw new Error("Compiler project omitted input provenance");
    if (project.outcome === "pass" && project.diagnostics.length)
        throw new Error("Compiler project passed despite diagnostics");
    validateCompilerFingerprints(project);
    for (const item of project.diagnostics)
        validateCompilerDiagnostic(item);
}
function validateCompilerFingerprints(project) {
    for (const entry of [...project.configs, ...project.sources, ...project.dependencies])
        if (!entry.path || !/^[a-f0-9]{64}$/u.test(entry.digest))
            throw new Error("Invalid compiler input fingerprint");
    if (project.inputDigest !== undefined && !/^[a-f0-9]{64}$/u.test(project.inputDigest))
        throw new Error("Invalid compiler project input digest");
}
function validateCompilerDiagnostic(item) {
    if (!/^(?:TS\d+|compiler)$/u.test(item.code))
        throw new Error("Invalid compiler diagnostic code");
    if (item.location && (!item.location.path || !Number.isInteger(item.location.line) || item.location.line < 1 || !Number.isInteger(item.location.column) || item.location.column < 1))
        throw new Error("Invalid compiler diagnostic location");
}
function validateCompilerProjects(result) {
    const projects = result.projects ?? [];
    if (!projects.length || new Set(projects.map((project) => project.project)).size !== projects.length)
        throw new Error("Invalid compiler project selection");
    for (const project of projects)
        validateCompilerProject(project);
    if (result.scope.scanned !== projects.reduce((count, project) => count + project.scope.scanned, 0))
        throw new Error("Compiler project coverage total mismatch");
    if (result.outcome === "pass" && projects.some((project) => project.outcome !== "pass"))
        throw new Error("Adapter passed despite incomplete or failed compiler project");
}
