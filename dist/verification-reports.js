import { digest } from "./evidence.js";
import { objectValue, enumValue } from "./json-values.js";
export const REPORT_FORMATS = ["vitest", "playwright", "contract", "pnpm-audit"];
export function reportObject(value) {
    return objectValue(value);
}
export function reportArray(value) {
    if (!Array.isArray(value))
        throw new Error("Invalid report array");
    return value;
}
export function count(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid report count");
    return value;
}
export function reportId(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/u.test(value))
        throw new Error("Invalid report identity");
    return value;
}
function empty() {
    return {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        timedOut: 0,
        errors: 0,
        cases: [],
        measurements: {},
        limitations: [],
    };
}
function add(result, id, status) {
    result.cases.push({ id, status });
    result.total++;
    result[status]++;
}
function requireCount(value, actual) {
    if (count(value) !== actual)
        throw new Error("Report summary disagrees with cases");
}
function nativeId(parts) {
    if (!parts.every((item) => typeof item === "string"))
        throw new Error("Invalid native case identity");
    return digest(JSON.stringify(parts));
}
function vitestReport(raw) {
    const result = empty();
    if (typeof raw.success !== "boolean")
        throw new Error("Missing test run success");
    for (const entry of reportArray(raw.testResults)) {
        const suite = reportObject(entry);
        if (!["passed", "failed"].includes(String(suite.status)))
            throw new Error("Invalid suite status");
        for (const item of reportArray(suite.assertionResults)) {
            const test = reportObject(item);
            const status = test.status === "passed"
                ? "passed"
                : test.status === "failed"
                    ? "failed"
                    : ["pending", "todo", "skipped"].includes(String(test.status))
                        ? "skipped"
                        : undefined;
            if (!status)
                throw new Error("Invalid assertion status");
            add(result, nativeId([suite.name, test.fullName, String(result.total)]), status);
        }
    }
    requireCount(raw.numTotalTests, result.total);
    requireCount(raw.numPassedTests, result.passed);
    requireCount(raw.numFailedTests, result.failed);
    requireCount(count(raw.numPendingTests) + count(raw.numTodoTests ?? 0), result.skipped);
    result.errors = count(raw.numFailedTestSuites);
    if (!raw.success && !result.failed && !result.errors)
        result.errors = 1;
    if (raw.success && (result.failed || result.errors))
        throw new Error("Contradictory successful test report");
    result.limitations.push("Vitest JSON does not distinguish retry or timeout attempts; use contract evidence for those assertions");
    return result;
}
function playwrightCase(result, spec, test) {
    const status = String(test.status);
    if (!["expected", "unexpected", "flaky", "skipped"].includes(status))
        throw new Error("Invalid Playwright outcome");
    const attempts = reportArray(test.results).map(reportObject);
    if (status !== "skipped" && !attempts.length)
        throw new Error("Executed test has no results");
    const allowed = new Set(["passed", "failed", "timedOut", "skipped", "interrupted"]);
    if (!allowed.has(String(test.expectedStatus)))
        throw new Error("Missing expected test status");
    for (const attempt of attempts) {
        if (!allowed.has(String(attempt.status)))
            throw new Error("Invalid test attempt status");
        count(attempt.retry);
        if (attempt.status === "timedOut")
            result.timedOut++;
        if (attempt.status === "interrupted")
            result.errors++;
    }
    const last = attempts.at(-1)?.status;
    if (status === "expected" && last !== test.expectedStatus)
        throw new Error("Expected outcome disagrees with actual result");
    if (status === "flaky" &&
        (attempts.length < 2 ||
            last !== "passed" ||
            !attempts.some((attempt) => attempt.status !== "passed")))
        throw new Error("Invalid flaky results");
    if (status === "flaky")
        result.flaky++;
    const normalized = status === "unexpected"
        ? "failed"
        : status === "skipped" || test.expectedStatus !== "passed"
            ? "skipped"
            : "passed";
    add(result, nativeId([spec.id, test.projectName, String(result.total)]), normalized);
}
function playwrightReport(raw) {
    const result = empty(), nativeCounts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    const queue = [...reportArray(raw.suites)];
    while (queue.length) {
        const suite = reportObject(queue.pop());
        queue.push(...reportArray(suite.suites ?? []));
        for (const item of reportArray(suite.specs ?? [])) {
            const spec = reportObject(item);
            for (const value of reportArray(spec.tests)) {
                const test = reportObject(value);
                playwrightCase(result, spec, test);
                nativeCounts[enumValue(test.status, ["expected", "unexpected", "flaky", "skipped"])]++;
            }
        }
    }
    const stats = reportObject(raw.stats);
    for (const [key, value] of Object.entries(nativeCounts))
        requireCount(stats[key], value);
    result.errors += reportArray(raw.errors).length;
    return result;
}
function measurement(value) {
    const raw = reportObject(value);
    if (typeof raw.value !== "number" ||
        !Number.isFinite(raw.value) ||
        raw.value < 0 ||
        !["ms", "bytes", "count"].includes(String(raw.unit)) ||
        !count(raw.samples))
        throw new Error("Invalid measurement");
    return {
        value: raw.value,
        unit: enumValue(raw.unit, ["ms", "bytes", "count"]),
        samples: count(raw.samples),
    };
}
function contractReport(raw) {
    const result = empty();
    if (raw.schemaVersion !== 1)
        throw new Error("Unsupported contract schema");
    const ids = new Set();
    for (const item of reportArray(raw.cases)) {
        const test = reportObject(item), id = reportId(test.id);
        if (ids.has(id) || !["passed", "failed", "skipped"].includes(String(test.status)))
            throw new Error("Invalid or duplicate contract case");
        ids.add(id);
        add(result, id, enumValue(test.status, ["passed", "failed", "skipped"]));
        if (test.measurement !== undefined)
            Object.defineProperty(result.measurements, id, {
                value: measurement(test.measurement),
                enumerable: true,
            });
    }
    result.errors = count(raw.errors ?? 0);
    result.flaky = count(raw.flaky ?? 0);
    result.timedOut = count(raw.timedOut ?? 0);
    return result;
}
function auditReport(raw) {
    if (raw.error)
        throw new Error("Dependency audit unavailable");
    const metadata = reportObject(raw.metadata), vulnerabilities = reportObject(metadata.vulnerabilities);
    const result = empty();
    const levels = ["info", "low", "moderate", "high", "critical"];
    const observed = Object.fromEntries(levels.map((level) => [level, 0]));
    const cases = new Map();
    for (const [key, value] of Object.entries(reportObject(raw.advisories))) {
        const advisory = reportObject(value), severity = String(advisory.severity);
        if (!Object.hasOwn(observed, severity))
            throw new Error("Invalid advisory severity");
        const id = advisory.github_advisory_id === undefined
            ? reportId(`pnpm/${key}`)
            : reportId(advisory.github_advisory_id);
        if (advisory.github_advisory_id !== undefined &&
            !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/u.test(id))
            throw new Error("Invalid advisory identity");
        observed[severity]++;
        cases.set(id, { id, status: "failed" });
    }
    for (const level of levels)
        requireCount(vulnerabilities[level], observed[level]);
    result.cases = [...cases.values()].sort((a, b) => a.id.localeCompare(b.id));
    const inventory = count(count(metadata.dependencies) +
        count(metadata.devDependencies) +
        count(metadata.optionalDependencies));
    result.total =
        metadata.totalDependencies === undefined ? inventory : count(metadata.totalDependencies);
    result.failed = count(levels.reduce((sum, level) => sum + count(vulnerabilities[level]), 0));
    result.passed = result.total;
    result.measurements = Object.fromEntries(Object.entries(vulnerabilities)
        .filter(([key]) => ["info", "low", "moderate", "high", "critical"].includes(key))
        .map(([key, value]) => [key, { value: count(value), unit: "count", samples: 1 }]));
    result.limitations.push("Dependency inventory and advisory counts have different units; vulnerability counts are not failed test counts");
    return result;
}
export function parseVerificationReport(format, value) {
    const raw = reportObject(value);
    const parsers = {
        vitest: vitestReport,
        playwright: playwrightReport,
        contract: contractReport,
        "pnpm-audit": auditReport,
    };
    if (!Object.hasOwn(parsers, format))
        throw new Error("Unsupported report format");
    return parsers[format](raw);
}
