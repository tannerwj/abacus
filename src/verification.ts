import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { digest, finding, type AdapterResult, type RunEvidence } from "./evidence.js";
import { canonicalPolicyJson, evaluationDate } from "./policy.js";
import { sourceProvenance } from "./provenance.js";
import {
  VERIFICATION_PROFILES,
  type VerificationProfile,
  type VerificationSpec,
} from "./verification-config.js";
import {
  REPORT_FORMATS,
  parseVerificationReport,
  reportId,
  reportObject,
  type ReportFormat,
  type VerificationSummary,
} from "./verification-reports.js";

import {
  assertVerificationRecord,
  VERIFICATION_ISSUES as ISSUES,
  type VerificationRecord,
} from "./verification-envelope.js";
export type { VerificationRecord } from "./verification-envelope.js";
export interface RecordVerificationOptions {
  id: string;
  profile: VerificationProfile;
  format: ReportFormat;
  report: string;
  evidence: string;
  command: string[];
  environment?: "isolated" | "staging";
  timeoutMs?: number;
}

function externalPath(cwd: string, file: string): string {
  const resolved = path.resolve(cwd, file),
    parent = fs.realpathSync(path.dirname(resolved));
  const canonical = path.join(parent, path.basename(resolved));
  const relative = path.relative(fs.realpathSync(cwd), canonical);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    throw new Error("Verification artifacts must be outside the evaluated project tree");
  return canonical;
}
function executable(command: string, cwd: string): string {
  const candidates =
    command.includes(path.sep) || path.isAbsolute(command)
      ? [path.resolve(cwd, command)]
      : (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.resolve(dir, command));
  const file = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  if (!file) throw new Error("Verification executable was not found");
  return fs.realpathSync(file);
}
function fresh(file: string): void {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("Verification requires new artifact paths");
}
function sameSource(a: RunEvidence["source"], b: RunEvidence["source"]): boolean {
  return a.commit === b.commit && a.treeDigest === b.treeDigest;
}
function safeRead(file: string): { value: unknown; hash: string } {
  if (
    fs.lstatSync(file).isSymbolicLink() ||
    !fs.statSync(file).isFile() ||
    fs.statSync(file).size > 32 * 1024 * 1024
  )
    throw new Error("Invalid verification artifact");
  const bytes = fs.readFileSync(file);
  return { value: JSON.parse(bytes.toString("utf8")), hash: digest(bytes) };
}
function validateInvocation(options: RecordVerificationOptions): number {
  reportId(options.id);
  if (options.environment !== undefined && !["isolated", "staging"].includes(options.environment))
    throw new Error("Invalid verification environment");
  if (
    !VERIFICATION_PROFILES.includes(options.profile) ||
    !REPORT_FORMATS.includes(options.format) ||
    !options.command.length ||
    !options.command.every((arg) => typeof arg === "string" && !arg.includes("\0"))
  )
    throw new Error("Invalid verification invocation");
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3_600_000)
    throw new Error("Verification timeout must be 1 through 3600000 milliseconds");
  return timeout;
}
function sameExecutable(file: string, hash: string): boolean {
  try {
    return digest(fs.readFileSync(file)) === hash;
  } catch {
    return false;
  }
}
export function recordVerification(
  options: RecordVerificationOptions,
  cwd = process.cwd(),
): VerificationRecord {
  const timeout = validateInvocation(options);
  const reportPath = externalPath(cwd, options.report),
    evidencePath = externalPath(cwd, options.evidence);
  fresh(reportPath);
  fresh(evidencePath);
  if (reportPath === evidencePath) throw new Error("Report and evidence need distinct paths");
  const bin = executable(options.command[0], cwd),
    binaryDigest = digest(fs.readFileSync(bin)),
    source = sourceProvenance(cwd);
  const started = Date.now(),
    startedAt = new Date(started).toISOString();
  const executed = spawnSync(bin, options.command.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  const record: VerificationRecord = {
    schemaVersion: 1,
    id: options.id,
    profile: options.profile,
    environment: options.environment ?? "isolated",
    source,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    command: {
      digest: digest(JSON.stringify(options.command)),
      executableDigest: binaryDigest,
      exitCode: executed.status,
    },
    summary: parseVerificationReport("contract", { schemaVersion: 1, cases: [] }),
    issues: [],
  };
  if (executed.error || executed.signal)
    record.issues.push(
      executed.error && "code" in executed.error && executed.error.code === "ETIMEDOUT"
        ? "execution-timeout"
        : "execution-error",
    );
  if (!sameExecutable(bin, binaryDigest)) record.issues.push("execution-error");
  if (!sameSource(source, sourceProvenance(cwd))) record.issues.push("source-changed");
  try {
    const report = safeRead(reportPath);
    record.summary = parseVerificationReport(options.format, report.value);
    record.report = { path: reportPath, format: options.format, digest: report.hash };
  } catch {
    record.issues.push(fs.existsSync(reportPath) ? "invalid-report" : "missing-report");
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return record;
}
function incomplete(note: string): AdapterResult {
  return {
    outcome: "incomplete",
    coverage: { status: "incomplete", reasons: [note] },
    scope: { kind: "repository", targets: ["verification artifact"], scanned: 0, unit: "cases" },
    findings: [],
  };
}
function validateExecution(record: VerificationRecord, at: string, maxAge: number): void {
  evaluationDate(record.startedAt);
  evaluationDate(record.finishedAt);
  evaluationDate(at);
  const age = Date.parse(at) - Date.parse(record.finishedAt);
  if (
    age < 0 ||
    age > maxAge * 3_600_000 ||
    Date.parse(record.finishedAt) < Date.parse(record.startedAt)
  )
    throw new Error("Verification is stale or future-dated");
  if (
    typeof record.durationMs !== "number" ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0 ||
    !Array.isArray(record.issues) ||
    record.issues.some((issue) => !ISSUES.includes(issue))
  )
    throw new Error("Invalid execution metadata");
  for (const value of [record.command.digest, record.command.executableDigest])
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Missing execution provenance");
  if (
    record.command.exitCode !== null &&
    (!Number.isSafeInteger(record.command.exitCode) || record.command.exitCode < 0)
  )
    throw new Error("Invalid execution status");
  reportObject(record.runtime);
}
function validateRecord(
  record: VerificationRecord,
  spec: VerificationSpec,
  source: RunEvidence["source"],
  at: string,
): void {
  if (
    record.schemaVersion !== 1 ||
    record.id !== spec.id ||
    record.profile !== spec.profile ||
    !sameSource(record.source, source)
  )
    throw new Error("Verification identity or source does not match");
  validateExecution(record, at, spec.maxAgeHours ?? 24);
  if (
    !["isolated", "staging"].includes(record.environment) ||
    (spec.environment && record.environment !== spec.environment)
  )
    throw new Error("Verification environment does not match");
  if (
    record.report &&
    (record.report.format !== spec.format || !/^[a-f0-9]{64}$/u.test(record.report.digest))
  )
    throw new Error("Verification format does not match");
}
function budgetFindings(
  spec: VerificationSpec,
  summary: VerificationSummary,
): { findings: AdapterResult["findings"]; missing: string[] } {
  const findings: AdapterResult["findings"] = [],
    missing: string[] = [];
  for (const budget of spec.budgets ?? []) {
    const value = summary.measurements[budget.id];
    const measured = summary.cases.find((item) => item.id === budget.id);
    if (
      !measured ||
      measured.status === "skipped" ||
      !value ||
      value.unit !== budget.unit ||
      value.samples < budget.minSamples
    ) {
      missing.push(`Missing or insufficient measurement: ${budget.id}`);
      continue;
    }
    if (value.value > budget.max)
      findings.push(
        finding(
          "verification/budget",
          budget.id,
          `Measured ${value.value} ${value.unit} exceeds ${budget.max} ${value.unit}`,
        ),
      );
  }
  return { findings, missing };
}
function summarize(
  spec: VerificationSpec,
  summary: VerificationSummary,
  record: VerificationRecord,
): AdapterResult {
  const { findings, missing } = budgetFindings(spec, summary);
  for (const id of spec.assertions ?? []) {
    const item = summary.cases.find((test) => test.id === id);
    if (!item || item.status === "skipped")
      missing.push(`Required assertion was not exercised: ${id}`);
  }
  for (const item of summary.cases.filter((test) => test.status === "failed"))
    findings.push(
      finding(
        spec.profile === "dependencies" ? "verification/advisory" : "verification/case",
        item.id,
        "Verification assertion or dependency advisory failed",
      ),
    );
  const limits = { skipped: spec.maxSkipped ?? 0, flaky: spec.maxFlaky ?? 0 };
  for (const key of ["skipped", "flaky"] as const)
    if (summary[key] > limits[key])
      findings.push(finding(`verification/${key}`, spec.id, `${key} count exceeds ${limits[key]}`));
  if (summary.errors)
    findings.push(
      finding("verification/runner", spec.id, "Runner setup or execution errors were reported"),
    );
  if (record.command.exitCode !== 0)
    findings.push(
      finding("verification/exit", spec.id, "Verification command did not exit successfully"),
    );
  if (!summary.total) missing.push("No verification targets were exercised");
  const outcome = record.issues.length
    ? "error"
    : missing.length
      ? "incomplete"
      : findings.length
        ? "fail"
        : "pass";
  return {
    outcome,
    scope: {
      kind: "repository",
      targets: [spec.id],
      scanned: summary.total,
      unit: spec.profile === "dependencies" ? "dependencies" : "cases",
    },
    findings,
    coverage: {
      status: missing.length || record.issues.length ? "incomplete" : "complete",
      reasons: [...missing, ...record.issues.map((issue) => `Verification ${issue}`)],
    },
    metrics: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      flaky: summary.flaky,
      timedOut: summary.timedOut,
      errors: summary.errors,
      durationMs: record.durationMs,
    },
    notes: summary.limitations,
  };
}
export function verificationEvidence(
  spec: VerificationSpec,
  cwd: string,
  source: RunEvidence["source"],
  evaluatedAt: string,
): AdapterResult {
  try {
    const file = externalPath(cwd, spec.path),
      envelope = safeRead(file),
      record = envelope.value;
    assertVerificationRecord(record);
    validateRecord(record, spec, source, evaluatedAt);
    let summary = record.summary;
    const entries = [{ path: file, digest: envelope.hash }];
    if (record.report) {
      const reportPath = externalPath(cwd, record.report.path),
        raw = safeRead(reportPath);
      if (raw.hash !== record.report.digest) throw new Error("Report bytes changed");
      summary = parseVerificationReport(spec.format, raw.value);
      if (canonicalPolicyJson(summary) !== canonicalPolicyJson(record.summary))
        throw new Error("Cached summary disagrees with report");
      entries.push({ path: reportPath, digest: raw.hash });
    } else if (!record.issues.length) throw new Error("Missing underlying report");
    if (entries.some((entry) => digest(fs.readFileSync(entry.path)) !== entry.digest))
      throw new Error("Verification inputs changed during import");
    return {
      ...summarize(spec, summary, record),
      configs: entries,
      tool: {
        name: `verification/${spec.id}/${spec.format}`,
        version: "1.0.0",
        digest: record.command.executableDigest,
      },
    };
  } catch {
    return incomplete(
      "Verification evidence is missing, stale, malformed, changed, or belongs to different source or scope",
    );
  }
}
