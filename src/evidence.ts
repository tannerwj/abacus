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
  /** Explicit compiler-project context; no raw diagnostic text. */
  project?: string;
}
export interface CompilerDiagnostic {
  code: string;
  location?: { path: string; line: number; column: number };
}
export interface CompilerProjectEvidence {
  project: string;
  outcome: Outcome;
  scope: AdapterResult["scope"];
  diagnostics: CompilerDiagnostic[];
  configs: Array<{ path: string; digest: string }>;
  /** Local, non-dependency source inputs reported by the actual compiler. */
  sources: Array<{ path: string; digest: string }>;
  /** Actual installed declaration/compiler library inputs, excluded from source coverage. */
  dependencies: Array<{ path: string; digest: string }>;
  /** Project selector and sorted config/source byte fingerprints, when complete. */
  inputDigest?: string;
  notes?: string[];
}
export interface AdapterResult {
  outcome: Outcome;
  scope: { kind: ScopeKind; targets: string[]; scanned: number; unit: string; excluded?: string[] };
  findings: Finding[];
  coverage?: { status: "complete" | "incomplete"; reasons: string[] };
  metrics?: Record<string, number>;
  notes?: string[];
  tool?: { name: string; version: string; digest?: string };
  tools?: Array<{ name: string; version: string; digest?: string }>;
  configs?: Array<{ path: string; digest: string }>;
  /** Independent compiler outcomes, retained even when another project is successful. */
  projects?: CompilerProjectEvidence[];
  errorCode?: AdapterFailureCode;
}

const SAFE_FAILURE_MESSAGES = {
  "missing-baseline": "Committed ratchet baseline is missing. Create it only as an explicit reviewed baseline decision.",
  "invalid-baseline": "Committed ratchet baseline is malformed or has invalid/missing metric values. Normal checks do not repair it.",
  "unresolved-imports": "Dependency graph contains unresolved imports. Check aliases and runtime-specific modules in the native configuration.",
  "unsupported-native-config": "The pinned native configuration uses an unsupported profile feature. Repository-local native configuration remains available.",
} as const;
export type AdapterFailureCode = keyof typeof SAFE_FAILURE_MESSAGES;
/** Only known safe causes cross the tool boundary; arbitrary stderr remains private. */
export class AdapterFailure extends Error {
  constructor(readonly code: AdapterFailureCode) { super(SAFE_FAILURE_MESSAGES[code]); }
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

function validateCoverage(coverage: AdapterResult["coverage"]): void {
  if (coverage && (!["complete", "incomplete"].includes(coverage.status) || !Array.isArray(coverage.reasons) || !coverage.reasons.every((reason) => typeof reason === "string") || (coverage.status === "incomplete" && !coverage.reasons.length))) throw new Error("Invalid adapter coverage");
}
export function validateAdapterResult(result: AdapterResult): void {
  validateCoverage(result.coverage);
  if (!["pass", "fail", "waived", "not-applicable", "incomplete", "error"].includes(result.outcome)) throw new Error("Invalid adapter outcome");
  if (!result.scope || !["file", "package", "graph", "repository", "built-assets"].includes(result.scope.kind) || !Array.isArray(result.scope.targets) || !result.scope.targets.every((item) => typeof item === "string") || !Number.isInteger(result.scope.scanned) || result.scope.scanned < 0 || !result.scope.unit) throw new Error("Invalid adapter scope");
  if (!Array.isArray(result.findings)) throw new Error("Invalid adapter findings");
  for (const item of result.findings) {
    if (!item.ruleId || !item.subject || typeof item.message !== "string" || !/^[a-f0-9]{64}$/u.test(item.fingerprint) || !["error", "warning", "info"].includes(item.severity)) throw new Error("Invalid adapter finding");
  }
  if (result.outcome === "pass" && result.findings.some((item) => item.severity === "error" && !item.exceptionId)) throw new Error("Adapter passed despite error findings");
  if (result.projects) validateCompilerProjects(result);
}

function validateCompilerProject(project: CompilerProjectEvidence): void {
  if (!project.project || !["pass", "fail", "incomplete", "error"].includes(project.outcome) || !Number.isInteger(project.scope.scanned) || project.scope.scanned < 0) throw new Error("Invalid compiler project evidence");
  if (["pass", "fail"].includes(project.outcome) && project.scope.scanned === 0) throw new Error("Compiler project has no checked sources");
  if (project.sources.length !== project.scope.scanned) throw new Error("Compiler project source count mismatch");
  if (["pass", "fail"].includes(project.outcome) && (!project.inputDigest || !project.configs.length)) throw new Error("Compiler project omitted input provenance");
  if (project.outcome === "pass" && project.diagnostics.length) throw new Error("Compiler project passed despite diagnostics");
  validateCompilerFingerprints(project);
  for (const item of project.diagnostics) validateCompilerDiagnostic(item);
}
function validateCompilerFingerprints(project: CompilerProjectEvidence): void {
  for (const entry of [...project.configs, ...project.sources, ...project.dependencies]) if (!entry.path || !/^[a-f0-9]{64}$/u.test(entry.digest)) throw new Error("Invalid compiler input fingerprint");
  if (project.inputDigest !== undefined && !/^[a-f0-9]{64}$/u.test(project.inputDigest)) throw new Error("Invalid compiler project input digest");
}
function validateCompilerDiagnostic(item: CompilerDiagnostic): void {
  if (!/^(?:TS\d+|compiler)$/u.test(item.code)) throw new Error("Invalid compiler diagnostic code");
  if (item.location && (!item.location.path || !Number.isInteger(item.location.line) || item.location.line < 1 || !Number.isInteger(item.location.column) || item.location.column < 1)) throw new Error("Invalid compiler diagnostic location");
}
function validateCompilerProjects(result: AdapterResult): void {
  const projects = result.projects ?? [];
  if (!projects.length || new Set(projects.map((project) => project.project)).size !== projects.length) throw new Error("Invalid compiler project selection");
  for (const project of projects) validateCompilerProject(project);
  if (result.scope.scanned !== projects.reduce((count, project) => count + project.scope.scanned, 0)) throw new Error("Compiler project coverage total mismatch");
  if (result.outcome === "pass" && projects.some((project) => project.outcome !== "pass")) throw new Error("Adapter passed despite incomplete or failed compiler project");
}
