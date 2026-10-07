import { reportObject, reportArray, reportId, count, } from "./verification-reports.js";
import { VERIFICATION_PROFILES } from "./verification-config.js";
import { enumValue } from "./json-values.js";
export const VERIFICATION_ISSUES = [
    "execution-timeout",
    "execution-error",
    "missing-report",
    "invalid-report",
    "source-changed",
];
function hash(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        throw new Error("Invalid verification digest");
}
function text(value) {
    if (typeof value !== "string" || !value)
        throw new Error("Invalid verification text");
}
function finite(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error("Invalid verification number");
}
function summary(value) {
    const raw = reportObject(value);
    for (const key of ["total", "passed", "failed", "skipped", "flaky", "timedOut", "errors"])
        count(raw[key]);
    for (const item of reportArray(raw.cases)) {
        const test = reportObject(item);
        reportId(test.id);
        enumValue(test.status, ["passed", "failed", "skipped"]);
    }
    for (const item of Object.values(reportObject(raw.measurements))) {
        const measurement = reportObject(item);
        finite(measurement.value);
        enumValue(measurement.unit, ["ms", "bytes", "count"]);
        if (!count(measurement.samples))
            throw new Error("Invalid verification samples");
    }
    reportArray(raw.limitations).forEach(text);
}
function provenance(raw) {
    const source = reportObject(raw.source), runtime = reportObject(raw.runtime), command = reportObject(raw.command);
    if (source.commit !== null)
        text(source.commit);
    hash(source.treeDigest);
    if (source.dirty !== null && typeof source.dirty !== "boolean")
        throw new Error("Invalid verification source");
    for (const key of ["node", "platform", "arch"])
        text(runtime[key]);
    hash(command.digest);
    hash(command.executableDigest);
    if (command.exitCode !== null)
        count(command.exitCode);
    if (raw.report !== undefined) {
        const report = reportObject(raw.report);
        text(report.path);
        enumValue(report.format, ["vitest", "playwright", "pnpm-audit", "contract"]);
        hash(report.digest);
    }
}
export function assertVerificationRecord(value) {
    const raw = reportObject(value);
    if (raw.schemaVersion !== 1)
        throw new Error("Unsupported verification record");
    reportId(raw.id);
    enumValue(raw.profile, VERIFICATION_PROFILES);
    enumValue(raw.environment, ["isolated", "staging"]);
    text(raw.startedAt);
    text(raw.finishedAt);
    finite(raw.durationMs);
    reportArray(raw.issues).forEach((issue) => enumValue(issue, VERIFICATION_ISSUES));
    summary(raw.summary);
    provenance(raw);
}
