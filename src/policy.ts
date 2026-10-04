import fs from "node:fs";
import path from "node:path";
import { bundledFile, relativeFile, validateNativeClosure } from "./policy-native.js";
import { CHECK_GATES, type AbacusConfig } from "./config.js";
import { digest, finding, type AdapterResult, type CheckEvidence, type Enforcement, type Finding } from "./evidence.js";

export const POLICY_GATES = [...CHECK_GATES, "architecture", "package"] as const;
export type PolicyGate = typeof POLICY_GATES[number];
type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type PolicyParameters = DeepPartial<Omit<AbacusConfig, "check" | "policy">> & {
  architecture?: { targets?: string[] };
  package?: { modes?: Array<"node16-esm" | "node16-cjs" | "bundler">; publintLevel?: "suggestion" | "warning" | "error"; attwProfile?: "strict" | "node16" | "esm-only" };
};
export interface PolicyCheck {
  id: string;
  gate: PolicyGate;
  required: boolean;
  enforcement: Enforcement;
  severity: Finding["severity"];
  rationale: string;
  nativeConfig?: string;
  parameters?: PolicyParameters;
}
export interface PolicyPack {
  schemaVersion: 1;
  name: string;
  version: string;
  compatibility: { adapterVersion: 1; evidenceSchemaVersion: 1; abacus?: string; tools?: Record<string, string> };
  checks: PolicyCheck[];
  /** Explicit inventory of bundled native-config companions, relative to the pack JSON. */
  nativeFiles?: string[];
}
export type PolicyPackReference = { version: string; digest: string } & (
  { path: string; package?: never; export?: never } |
  { package: string; export: string; path?: never }
);
export interface ResolvedPolicyPack {
  pack: PolicyPack;
  name: string;
  version: string;
  digest: string;
  source: string;
  /** Exact manifest bytes parsed at resolution, including whitespace, for live integrity checks. */
  manifest: { path: string; digest: string };
  nativeConfigs: Array<{ checkId: string; path: string; digest: string }>;
  nativeFiles: Array<{ path: string; digest: string }>;
}
export interface PolicyRuntime {
  adapterVersion?: number;
  evidenceSchemaVersion?: number;
  abacus?: string;
  tools?: Record<string, string>;
}
export interface RepositoryException { id: string; ruleId: string; subject: string; owner: string; reason: string; expires: string }

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} has unsupported fields: ${extra.join(", ")}`);
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}
function list(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new Error(`${label} must be a string list`);
}
function finite(value: unknown, label: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${label} must be a finite number >= ${minimum}`);
}
function bool(value: unknown, label: string): void { if (typeof value !== "boolean") throw new Error(`${label} must be boolean`); }
function enumeration(value: unknown, choices: readonly string[], label: string): asserts value is string {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(", ")}`);
}
function semver(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SEMVER.test(value)) throw new Error(`${label} must be an exact semantic version`);
}
function optional(value: Record<string, unknown>, key: string, validate: (input: unknown, label: string) => void, label: string): void {
  if (value[key] !== undefined) validate(value[key], `${label}.${key}`);
}
function settings(value: unknown, allowed: Record<string, (input: unknown, label: string) => void>, label: string): void {
  const record = object(value, label); keys(record, Object.keys(allowed), label);
  for (const [key, validate] of Object.entries(allowed)) optional(record, key, validate, label);
}
function locMetric(value: unknown, label: string): void { settings(value, { roots: list, slack: finite }, label); }
function commentsMetric(value: unknown, label: string): void { settings(value, { roots: list, max: finite }, label); }
function abcParameters(value: unknown, label: string): void {
  settings(value, { budget: (input, name) => finite(input, name, 1), allow: (input, name) => {
    for (const [subject, entry] of Object.entries(object(input, name))) {
      text(subject, name); const record = object(entry, `${name}.${subject}`); keys(record, ["max", "why"], name);
      finite(record.max, `${name}.${subject}.max`, 1); text(record.why, `${name}.${subject}.why`);
    }
  } }, label);
}
function wranglerSelectors(value: unknown, label: string): void {
  list(value, label);
  for (let i = 0; i < value.length; i += 2) {
    if (!["--env", "--name", "--config"].includes(value[i]) || !value[i + 1] || value[i + 1].startsWith("-")) throw new Error(`${label} supports only --env, --name, --config with explicit non-flag values`);
  }
}

function sizeParameters(value: unknown, label: string): void {
  settings(value, { budgets: (input, name) => {
    if (!Array.isArray(input)) throw new Error(`${name} must be a list`);
    for (const [index, item] of input.entries()) {
      const record = object(item, `${name}[${index}]`); keys(record, ["label", "dir", "match", "max", "mode", "allowEmpty"], name);
      for (const key of ["label", "dir", "match"]) text(record[key], `${name}.${key}`);
      finite(record.max, `${name}.max`, 1); optional(record, "mode", (val, key) => enumeration(val, ["sum", "largest"], key), name); optional(record, "allowEmpty", bool, name);
      text(record.match, `${name}.match`);
      try { new RegExp(record.match).test(""); } catch { throw new Error(`${name}.match must be a valid regex`); }
    }
  }, worker: (input, name) => settings(input, { max: (val, key) => finite(val, key, 1), wranglerArgs: wranglerSelectors }, name) }, label);
}
function ratchetParameters(value: unknown, label: string): void {
  settings(value, { file: text, metrics: (input, name) => settings(input, { loc: locMetric, comments: commentsMetric, oxlintWarnings: bool, abcMax: bool }, name) }, label);
}
function packageParameters(value: unknown, label: string): void {
  settings(value, {
    modes: (input, name) => { list(input, name); if (!input.length || new Set(input).size !== input.length) throw new Error(`${name} must be a nonempty unique list`); for (const mode of input) enumeration(mode, ["node16-esm", "node16-cjs", "bundler"], name); },
    publintLevel: (input, name) => enumeration(input, ["suggestion", "warning", "error"], name),
    attwProfile: (input, name) => enumeration(input, ["strict", "node16", "esm-only"], name),
  }, label);
}
export function validatePolicyParameters(value: unknown): PolicyParameters {
  settings(value, {
    preset: (input, name) => enumeration(input, ["typescript", "cloudflare-worker", "vite-spa", "nextjs"], name),
    roots: list, exclude: (input, name) => { list(input, name); for (const expr of input) { try { new RegExp(expr).test(""); } catch { throw new Error(`${name} must contain valid regex strings`); } } },
    abc: abcParameters, size: sizeParameters, ratchet: ratchetParameters,
    architecture: (input, name) => settings(input, { targets: list }, name), package: packageParameters,
  }, "parameters");
  return structuredClone(value) as PolicyParameters;
}

/** Deliberately bounded: exact versions or whitespace-conjoined >=, >, <=, <, = comparators. */
function constraints(value: unknown, label: string): asserts value is string {
  text(value, label);
  for (const part of value.split(/\s+/u)) semver(part.replace(/^(?:>=|<=|>|<|=)/u, ""), label);
}
export function validatePolicyPack(value: unknown): PolicyPack {
  const pack = object(value, "policy pack"); keys(pack, ["schemaVersion", "name", "version", "compatibility", "checks", "nativeFiles"], "policy pack");
  if (pack.schemaVersion !== 1) throw new Error("policy pack schemaVersion must be 1");
  text(pack.name, "policy pack name"); if (!NAME.test(pack.name)) throw new Error("policy pack name must be an npm-style lowercase name");
  semver(pack.version, "policy pack version");
  const compat = object(pack.compatibility, "compatibility"); keys(compat, ["adapterVersion", "evidenceSchemaVersion", "abacus", "tools"], "compatibility");
  if (compat.adapterVersion !== 1 || compat.evidenceSchemaVersion !== 1) throw new Error("incompatible adapterVersion or evidenceSchemaVersion; expected 1");
  optional(compat, "abacus", constraints, "compatibility");
  if (compat.tools !== undefined) for (const [name, rule] of Object.entries(object(compat.tools, "compatibility.tools"))) { text(name, "tool name"); constraints(rule, `compatibility.tools.${name}`); }
  if (!Array.isArray(pack.checks) || !pack.checks.length) throw new Error("policy checks must be a nonempty list");
  const ids = new Set<string>();
  for (const item of pack.checks) {
    const check = object(item, "policy check"); keys(check, ["id", "gate", "required", "enforcement", "severity", "rationale", "nativeConfig", "parameters"], "policy check");
    text(check.id, "check.id"); if (ids.has(check.id)) throw new Error(`duplicate policy check id: ${check.id}`); ids.add(check.id);
    enumeration(check.gate, POLICY_GATES, "check.gate"); bool(check.required, "check.required");
    enumeration(check.enforcement, ["block", "warn", "observe"], "check.enforcement"); enumeration(check.severity, ["error", "warning", "info"], "check.severity"); text(check.rationale, "check.rationale");
    optional(check, "nativeConfig", relativeFile, "check");
    if (check.nativeConfig !== undefined && !["lint", "deadcode", "architecture", "cycles", "secrets", "dupes"].includes(check.gate)) throw new Error(`check.nativeConfig is unsupported for ${check.gate}`);
    if (check.parameters !== undefined) {
      const params = validatePolicyParameters(check.parameters);
      if (params.package && check.gate !== "package") throw new Error("parameters.package requires the package gate");
      if (params.architecture && check.gate !== "architecture") throw new Error("parameters.architecture requires the architecture gate");
    }
  }
  if (pack.nativeFiles !== undefined) { list(pack.nativeFiles, "nativeFiles"); for (const file of pack.nativeFiles) relativeFile(file, "nativeFiles entry"); }
  return structuredClone(value) as PolicyPack;
}

/** Stable key ordering makes JSON whitespace/ordering irrelevant, while every native byte is pinned. */
export function canonicalPolicyJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalPolicyJson(item)}`).join(",")}}`;
}
function packFiles(pack: PolicyPack): string[] { return [...new Set([...pack.checks.flatMap((check) => check.nativeConfig ? [check.nativeConfig] : []), ...(pack.nativeFiles ?? [])])].sort(); }
export function computePolicyPackDigest(packOrFile: PolicyPack | string, root?: string): string {
  const file = typeof packOrFile === "string" ? fs.realpathSync(packOrFile) : undefined;
  const pack = validatePolicyPack(file ? JSON.parse(fs.readFileSync(file, "utf8")) : packOrFile);
  const directory = fs.realpathSync(root ?? (file ? path.dirname(file) : process.cwd()));
  const files = packFiles(pack); validateNativeClosure(directory, files);
  return digest(canonicalPolicyJson({ schemaVersion: 1, pack, nativeFiles: files.map((relative) => ({ path: relative, digest: digest(fs.readFileSync(bundledFile(directory, relative))) })) }));
}
function installedPackage(name: string, cwd: string): string {
  if (!NAME.test(name)) throw new Error("policy package must be a bare npm package name without a version or URL");
  let dir = path.resolve(cwd);
  for (;;) {
    const manifest = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(manifest)) return fs.realpathSync(manifest);
    const parent = path.dirname(dir); if (parent === dir) throw new Error(`policy package is not installed: ${name}`); dir = parent;
  }
}
function exportedJson(pkg: Record<string, unknown>, subpath: string): string {
  if (!(subpath === "." || /^\.\/[a-z0-9._/-]+$/iu.test(subpath)) || subpath.includes("..")) throw new Error("policy export must be an exact package subpath");
  const exports = pkg.exports;
  const target = typeof exports === "string" && subpath === "." ? exports : exports && typeof exports === "object" ? Reflect.get(exports, subpath) : undefined;
  if (typeof target !== "string" || !target.startsWith("./") || !target.endsWith(".json")) throw new Error("policy package export must point directly to bundled JSON (conditional/wildcard exports unsupported)");
  return target.slice(2);
}
function resolveReference(ref: PolicyPackReference, cwd: string): { file: string; source: string } {
  const raw = object(ref, "policy reference"); keys(raw, ["path", "package", "export", "version", "digest"], "policy reference");
  semver(ref.version, "policy reference version"); if (!SHA256.test(ref.digest)) throw new Error("policy reference requires a lowercase SHA-256 digest");
  if (typeof raw.path === "string" && raw.package === undefined && raw.export === undefined) {
    if (!raw.path.endsWith(".json") || /^[a-z]+:/iu.test(raw.path)) throw new Error("local policy path must be a JSON file, not a network URL");
    const file = fs.realpathSync(path.resolve(cwd, raw.path)); return { file, source: `local:${path.relative(cwd, file).split(path.sep).join("/")}` };
  }
  text(raw.package, "policy package"); text(raw.export, "policy export"); if (raw.path !== undefined) throw new Error("policy reference must choose exactly one source");
  const manifest = installedPackage(raw.package, cwd); const pkg = object(JSON.parse(fs.readFileSync(manifest, "utf8")), "policy package manifest");
  if (pkg.name !== raw.package || pkg.version !== ref.version) throw new Error("installed policy package name/version does not match the exact pin");
  const root = path.dirname(manifest); const file = bundledFile(root, exportedJson(pkg, raw.export));
  return { file, source: `npm:${raw.package}@${ref.version}${raw.export === "." ? "" : raw.export.slice(1)}` };
}
export function resolvePolicyPack(ref: PolicyPackReference, cwd = process.cwd(), runtime?: PolicyRuntime): ResolvedPolicyPack {
  const { file, source } = resolveReference(ref, cwd); const manifestBytes = fs.readFileSync(file); const pack = validatePolicyPack(JSON.parse(manifestBytes.toString("utf8")));
  if (pack.version !== ref.version) throw new Error("policy pack version does not match the exact pin");
  const root = path.dirname(file); const hash = computePolicyPackDigest(pack, root);
  if (hash !== ref.digest) throw new Error(`policy pack digest mismatch: expected ${ref.digest}, received ${hash}`);
  if (runtime) assertPolicyCompatibility({ ...pack, compatibility: { ...pack.compatibility, tools: runtime.tools === undefined ? undefined : pack.compatibility.tools } }, runtime);
  const snapshot = packFiles(pack).map((relative) => ({ relative, path: bundledFile(root, relative), digest: digest(fs.readFileSync(bundledFile(root, relative))) }));
  const snapshotDigest = digest(canonicalPolicyJson({ schemaVersion: 1, pack, nativeFiles: snapshot.map((entry) => ({ path: entry.relative, digest: entry.digest })) }));
  if (snapshotDigest !== hash) throw new Error("policy native files changed during resolution");
  return { pack, name: pack.name, version: pack.version, digest: hash, source, manifest: { path: file, digest: digest(manifestBytes) },
    nativeConfigs: pack.checks.flatMap((check) => {
      const entry = snapshot.find((item) => item.relative === check.nativeConfig);
      return entry ? [{ checkId: check.id, path: entry.path, digest: entry.digest }] : [];
    }),
    nativeFiles: snapshot.map(({ relative: _relative, ...entry }) => entry),
  };
}
function compareVersions(a: string, b: string): number {
  semver(a, "runtime tool version"); semver(b, "compatibility version");
  const am = a.match(/^(\d+\.\d+\.\d+)(?:-([^+]+))?/u), bm = b.match(/^(\d+\.\d+\.\d+)(?:-([^+]+))?/u);
  if (!am || !bm) throw new Error("invalid compatibility version");
  const [, aCore, aPre] = am, [, bCore, bPre] = bm;
  const av = aCore.split(".").map(BigInt), bv = bCore.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  if (!aPre || !bPre) return aPre === bPre ? 0 : aPre ? -1 : 1;
  const ap = aPre.split("."), bp = bPre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
    const an = /^\d+$/u.test(ap[i]), bn = /^\d+$/u.test(bp[i]);
    if (an !== bn) return an ? -1 : 1;
    return an ? BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1 : ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}
export function satisfiesToolVersion(version: string, requirement: string): boolean {
  constraints(requirement, "tool version constraint"); semver(version, "tool version");
  return requirement.split(/\s+/u).every((term) => {
    const operator = term.match(/^(>=|<=|>|<|=)/u)?.[0] ?? "=";
    const compared = compareVersions(version, term.slice(operator === "=" && !term.startsWith("=") ? 0 : operator.length));
    return { ">=": compared >= 0, "<=": compared <= 0, ">": compared > 0, "<": compared < 0, "=": compared === 0 }[operator];
  });
}
export function assertPolicyCompatibility(pack: PolicyPack, runtime: PolicyRuntime): void {
  if ((runtime.adapterVersion ?? 1) !== pack.compatibility.adapterVersion || (runtime.evidenceSchemaVersion ?? 1) !== pack.compatibility.evidenceSchemaVersion) throw new Error("policy adapter/evidence schema is incompatible with this runtime");
  const requirements = { ...pack.compatibility.tools, ...(pack.compatibility.abacus ? { abacus: pack.compatibility.abacus } : {}) };
  for (const [name, requirement] of Object.entries(requirements)) {
    const version = name === "abacus" ? runtime.abacus : runtime.tools?.[name];
    if (!version || !satisfiesToolVersion(version, requirement)) throw new Error(`incompatible or unreported ${name} tool version; policy requires ${requirement}`);
  }
}

function validDate(date: string): boolean { return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date; }
export function validateExceptions(value: unknown): RepositoryException[] {
  if (!Array.isArray(value)) throw new Error("repository exceptions must be a list");
  const ids = new Set<string>(), targets = new Set<string>();
  for (const entry of value) {
    const item = object(entry, "exception"); keys(item, ["id", "ruleId", "subject", "owner", "reason", "expires"], "exception");
    for (const key of ["id", "ruleId", "subject", "owner", "reason", "expires"]) text(item[key], `exception.${key}`);
    if (item.ruleId === "policy/expired-exception") throw new Error("exception cannot waive policy expiration governance");
    if ((item.ruleId as string).includes("*") || (item.subject as string).includes("*")) throw new Error("exception ruleId/subject must be exact, without wildcard matching");
    if (!validDate(item.expires as string)) throw new Error("exception.expires must be a valid YYYY-MM-DD date");
    const target = JSON.stringify([item.ruleId, item.subject]);
    if (ids.has(item.id as string) || targets.has(target)) throw new Error("duplicate exception id or exact ruleId/subject target");
    ids.add(item.id as string); targets.add(target);
  }
  return structuredClone(value) as RepositoryException[];
}
export function evaluationDate(evaluatedAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(evaluatedAt) || !validDate(evaluatedAt.slice(0, 10)) || !Number.isFinite(Date.parse(evaluatedAt))) throw new Error("evaluatedAt must be an explicit valid ISO timestamp with timezone");
  return new Date(evaluatedAt).toISOString().slice(0, 10);
}
export function expiredExceptions(exceptions: RepositoryException[], evaluatedAt: string): RepositoryException[] {
  const date = evaluationDate(evaluatedAt); return validateExceptions(exceptions).filter((exception) => exception.expires < date);
}
/** Pure, exact-match overlays. Waivers cannot turn tool errors or incomplete scans into success. */
export function applyExceptions<T extends AdapterResult>(result: T, exceptions: RepositoryException[], evaluatedAt: string): T {
  const date = evaluationDate(evaluatedAt); const validated = validateExceptions(exceptions); const copy = structuredClone(result);
  const active = new Map(validated.filter((exception) => exception.expires >= date).map((exception) => [JSON.stringify([exception.ruleId, exception.subject]), exception]));
  copy.findings = copy.findings.filter((item) => item.ruleId !== "policy/expired-exception").map(({ exceptionId: _previous, ...item }) => {
    const exception = active.get(JSON.stringify([item.ruleId, item.subject])); return exception ? { ...item, exceptionId: exception.id } : item;
  });
  const expired = validated.filter((exception) => exception.expires < date);
  copy.findings.push(...expired.map((exception) => finding("policy/expired-exception", `exception:${exception.id}`, `Exception ${exception.id} owned by ${exception.owner} expired on ${exception.expires}`)));
  const activeCount = copy.findings.filter((item) => !item.exceptionId).length;
  if (copy.outcome !== "error" && copy.outcome !== "incomplete") {
    if (expired.length) copy.outcome = "fail";
    else if ((copy.outcome === "fail" || copy.outcome === "waived") && copy.findings.length && !activeCount) copy.outcome = "waived";
    else if (copy.outcome === "waived" && activeCount) copy.outcome = "fail";
  }
  if ("counts" in copy) {
    const check = copy as T & CheckEvidence;
    check.counts = { findings: copy.findings.length, waived: copy.findings.length - activeCount, active: activeCount };
    check.blocking = (check.enforcement === "block" && check.outcome === "fail") || (check.required && ["error", "incomplete", "not-applicable"].includes(check.outcome));
  }
  return copy;
}
/** Merge only supported parameters; arrays replace rather than concatenate. No baseline is written. */
export function applyPolicyParameters(config: AbacusConfig, parameters?: PolicyParameters): AbacusConfig {
  if (!parameters) return structuredClone(config);
  const { architecture: _architecture, package: _package, ...validated } = validatePolicyParameters(parameters);
  const merge = (base: unknown, patch: unknown): unknown => {
    if (patch === undefined) return structuredClone(base);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
    const output = { ...(base === undefined ? {} : object(base, "base config")) };
    for (const [key, val] of Object.entries(patch)) Object.defineProperty(output, key, { value: merge(Object.hasOwn(output, key) ? output[key] : undefined, val), writable: true, enumerable: true, configurable: true });
    return output;
  };
  return merge(config, validated) as AbacusConfig;
}
