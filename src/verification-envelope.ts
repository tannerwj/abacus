import {
  reportObject,
  reportArray,
  reportId,
  count,
  type VerificationSummary,
  type ReportFormat,
} from "./verification-reports.js";
import { VERIFICATION_PROFILES, type VerificationProfile } from "./verification-config.js";
import { enumValue } from "./json-values.js";
import type { RunEvidence } from "./evidence.js";

export const VERIFICATION_ISSUES = [
  "execution-timeout",
  "execution-error",
  "missing-report",
  "invalid-report",
  "source-changed",
] as const;
export interface VerificationRecord {
  schemaVersion: 1;
  id: string;
  profile: VerificationProfile;
  environment: "isolated" | "staging";
  source: RunEvidence["source"];
  runtime: { node: string; platform: string; arch: string };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  command: { digest: string; executableDigest: string; exitCode: number | null };
  report?: { path: string; format: ReportFormat; digest: string };
  summary: VerificationSummary;
  issues: Array<(typeof VERIFICATION_ISSUES)[number]>;
}
function hash(value: unknown): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Invalid verification digest");
}
function text(value: unknown): void {
  if (typeof value !== "string" || !value) throw new Error("Invalid verification text");
}
function finite(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid verification number");
}
function summary(value: unknown): void {
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
    if (!count(measurement.samples)) throw new Error("Invalid verification samples");
  }
  reportArray(raw.limitations).forEach(text);
}
function provenance(raw: Record<string, unknown>): void {
  const source = reportObject(raw.source),
    runtime = reportObject(raw.runtime),
    command = reportObject(raw.command);
  if (source.commit !== null) text(source.commit);
  hash(source.treeDigest);
  if (source.dirty !== null && typeof source.dirty !== "boolean")
    throw new Error("Invalid verification source");
  for (const key of ["node", "platform", "arch"]) text(runtime[key]);
  hash(command.digest);
  hash(command.executableDigest);
  if (command.exitCode !== null) count(command.exitCode);
  if (raw.report !== undefined) {
    const report = reportObject(raw.report);
    text(report.path);
    enumValue(report.format, ["vitest", "playwright", "pnpm-audit", "contract"]);
    hash(report.digest);
  }
}
export function assertVerificationRecord(value: unknown): asserts value is VerificationRecord {
  const raw = reportObject(value);
  if (raw.schemaVersion !== 1) throw new Error("Unsupported verification record");
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
