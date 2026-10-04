import { createHash } from "node:crypto";
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
}
