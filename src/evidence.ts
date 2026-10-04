import { createHash } from "node:crypto";

export type Outcome = "pass" | "fail" | "waived" | "not-applicable" | "incomplete" | "error";
export type Enforcement = "block" | "warn" | "observe";
export type ScopeKind = "file" | "package" | "graph" | "repository" | "built-assets";
export interface Finding {
  ruleId: string;
  subject: string;
  /** Safe, normalized evidence only. Never raw secret values or arbitrary tool output. */
  message: string;
  fingerprint: string;
  severity: "error" | "warning" | "info";
  exceptionId?: string;
}
export interface AdapterResult {
  outcome: Outcome;
  scope: { kind: ScopeKind; targets: string[]; scanned: number; unit: string; excluded?: string[] };
  findings: Finding[];
  metrics?: Record<string, number>;
  notes?: string[];
  tool?: { name: string; version: string; digest?: string };
  tools?: Array<{ name: string; version: string; digest?: string }>;
  configs?: Array<{ path: string; digest: string }>;
}
export interface CheckEvidence extends AdapterResult {
  id: string;
  gate: string;
  required: boolean;
  enforcement: Enforcement;
  severity?: Finding["severity"];
  rationale?: string;
  blocking: boolean;
  counts: { findings: number; waived: number; active: number };
}
export interface RunEvidence {
  schemaVersion: 1;
  fingerprintVersion: 1;
  evaluatedAt: string;
  source: { commit: string | null; treeDigest: string; dirty: boolean | null };
  runtime: { node: string; platform: string; arch: string; abacus: string };
  configDigest: string;
  policy: { name: string; version: string; digest: string; source: string };
  checks: CheckEvidence[];
  clean: boolean;
}
export function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function finding(ruleId: string, subject: string, message: string, severity: Finding["severity"] = "error"): Finding {
  // Deliberately excludes line numbers and threshold values: logical subject continuity.
  return { ruleId, subject, message, severity, fingerprint: digest(JSON.stringify([1, ruleId, subject])) };
}

export function validateAdapterResult(result: AdapterResult): void {
  if (!["pass", "fail", "waived", "not-applicable", "incomplete", "error"].includes(result.outcome)) throw new Error("Invalid adapter outcome");
  if (!result.scope || !["file", "package", "graph", "repository", "built-assets"].includes(result.scope.kind) || !Array.isArray(result.scope.targets) || !result.scope.targets.every((item) => typeof item === "string") || !Number.isInteger(result.scope.scanned) || result.scope.scanned < 0 || !result.scope.unit) throw new Error("Invalid adapter scope");
  if (!Array.isArray(result.findings)) throw new Error("Invalid adapter findings");
  for (const item of result.findings) {
    if (!item.ruleId || !item.subject || typeof item.message !== "string" || !/^[a-f0-9]{64}$/u.test(item.fingerprint) || !["error", "warning", "info"].includes(item.severity)) throw new Error("Invalid adapter finding");
  }
  if (result.outcome === "pass" && result.findings.some((item) => item.severity === "error" && !item.exceptionId)) throw new Error("Adapter passed despite error findings");
}
