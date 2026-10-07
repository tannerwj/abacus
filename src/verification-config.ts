import {
  REPORT_FORMATS,
  reportArray,
  reportId,
  reportObject,
  type ReportFormat,
  type Measurement,
} from "./verification-reports.js";
import type { Enforcement } from "./evidence.js";

export const VERIFICATION_PROFILES = [
  "behavior",
  "authorization",
  "resilience",
  "performance",
  "dependencies",
] as const;
export type VerificationProfile = (typeof VERIFICATION_PROFILES)[number];
export interface VerificationBudget {
  id: string;
  unit: Measurement["unit"];
  max: number;
  minSamples: number;
}
export interface VerificationSpec {
  id: string;
  path: string;
  format: ReportFormat;
  profile: VerificationProfile;
  required: boolean;
  enforcement: Enforcement;
  maxAgeHours?: number;
  maxSkipped?: number;
  maxFlaky?: number;
  environment?: "isolated" | "staging";
  assertions?: string[];
  budgets?: VerificationBudget[];
}
export interface VerificationConfig {
  reports: VerificationSpec[];
}

function numeric(value: unknown, label: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new Error(`Invalid verification ${label}`);
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate verification ${label}`);
}
function profileRequirements(
  item: Record<string, unknown>,
  assertions: string[],
  budgets: VerificationBudget[],
): void {
  if (
    ["authorization", "resilience"].includes(String(item.profile)) &&
    (item.format !== "contract" || !assertions.length || !item.environment)
  )
    throw new Error(
      "Authorization/resilience profiles require contract assertions and an environment",
    );
  if (
    item.profile === "performance" &&
    (item.format !== "contract" || !budgets.length || !item.environment)
  )
    throw new Error("Performance requires contract budgets and an environment");
  if ((item.profile === "dependencies") !== (item.format === "pnpm-audit"))
    throw new Error("Dependency profile requires pnpm-audit format");
  if (assertions.length && item.format !== "contract")
    throw new Error("Named assertions require contract format");
}
function assertBudget(value: unknown): asserts value is VerificationBudget {
  const budget = reportObject(value);
  reportId(budget.id);
  numeric(budget.max, "budget maximum");
  numeric(budget.minSamples, "sample minimum", 1);
  if (
    !Number.isSafeInteger(budget.minSamples) ||
    !(typeof budget.unit === "string" && ["ms", "bytes", "count"].includes(budget.unit)) ||
    Object.keys(budget).some((key) => !["id", "unit", "max", "minSamples"].includes(key))
  )
    throw new Error("Invalid verification budget");
}
function validateBudget(value: unknown): VerificationBudget {
  assertBudget(value);
  return value;
}
function validateSpec(value: unknown): VerificationSpec {
  assertSpec(value);
  return value;
}
function validateLimits(item: Record<string, unknown>): void {
  for (const key of ["maxAgeHours", "maxSkipped", "maxFlaky"])
    if (item[key] !== undefined)
      numeric(item[key], key, key === "maxAgeHours" ? Number.MIN_VALUE : 0);
  for (const key of ["maxSkipped", "maxFlaky"])
    if (item[key] !== undefined && !Number.isSafeInteger(item[key]))
      throw new Error("Verification count limits must be integers");
}
function assertSpec(value: unknown): asserts value is VerificationSpec {
  const item = reportObject(value);
  const allowed = new Set([
    "id",
    "path",
    "format",
    "profile",
    "required",
    "enforcement",
    "maxAgeHours",
    "maxSkipped",
    "maxFlaky",
    "environment",
    "assertions",
    "budgets",
  ]);
  if (Object.keys(item).some((key) => !allowed.has(key)))
    throw new Error("Unsupported verification report field");
  reportId(item.id);
  if (typeof item.path !== "string" || !item.path.trim() || item.path.includes("\0"))
    throw new Error("Verification requires an evidence path");
  if (
    !REPORT_FORMATS.some((format) => format === item.format) ||
    !VERIFICATION_PROFILES.some((profile) => profile === item.profile)
  )
    throw new Error("Unsupported verification format/profile");
  if (
    typeof item.required !== "boolean" ||
    !(
      typeof item.enforcement === "string" &&
      ["block", "warn", "observe"].includes(item.enforcement)
    )
  )
    throw new Error("Verification requires explicit applicability and enforcement");
  if (
    item.environment !== undefined &&
    !(typeof item.environment === "string" && ["isolated", "staging"].includes(item.environment))
  )
    throw new Error("Invalid verification environment");
  validateLimits(item);
  const assertions = reportArray(item.assertions ?? []).map(reportId);
  unique(assertions, "assertions");
  const budgets = reportArray(item.budgets ?? []).map(validateBudget);
  unique(
    budgets.map((budget) => budget.id),
    "budgets",
  );
  profileRequirements(item, assertions, budgets);
}
export function validateVerificationConfig(value: unknown): VerificationConfig {
  const raw = reportObject(value);
  if (Object.keys(raw).some((key) => key !== "reports"))
    throw new Error("Unsupported verification configuration");
  const reports = reportArray(raw.reports).map(validateSpec);
  unique(
    reports.map((report) => report.id),
    "report identities",
  );
  return { reports };
}
