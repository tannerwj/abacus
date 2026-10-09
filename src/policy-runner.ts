import { jsonObject } from "./json-values.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runArchitecture } from "./architecture.js";
import { CHECK_GATES, validateAbacusConfig, validateCheckGates, validateProjectInputs, type AbacusConfig, type CheckGate } from "./config.js";
import { AdapterFailure, digest, finding, validateAdapterResult, type AdapterResult, type CheckEvidence, type RunEvidence } from "./evidence.js";
import { runPackageValidation } from "./package-validation.js";
import { applyExceptions, applyPolicyParameters, assertPolicyCompatibility, expiredExceptions, resolvePolicyPack, validateExceptions, type PolicyCheck, type ResolvedPolicyPack, type RepositoryException } from "./policy.js";
import { sourceProvenance } from "./provenance.js";
import { runSourceAdapter } from "./source-adapters.js";
import { verificationEvidence } from "./verification.js";

export interface EvaluateOptions {
  gates?: CheckGate[];
  includeRepositoryGates?: boolean;
  policy?: ResolvedPolicyPack;
  evaluatedAt?: string;
  /** Used for deterministic fixture testing; ordinary CLI always uses the real adapters. */
  adapter?: (check: PolicyCheck, config: AbacusConfig, cwd: string, evaluatedAt: string, nativeConfig?: string) => AdapterResult;
}
const manifest = () => { const data = jsonObject(fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")); if (typeof data.version !== "string") throw new Error("Invalid package version"); return { version: data.version }; };
export function blocks(check: Pick<CheckEvidence, "required" | "enforcement" | "outcome" | "coverage">): boolean {
  if (check.coverage?.status === "incomplete" && check.required) return true;
  if (["error", "incomplete", "not-applicable"].includes(check.outcome)) return check.required;
  return check.enforcement === "block" && check.outcome === "fail";
}
function adapter(check: PolicyCheck, config: AbacusConfig, cwd: string, evaluatedAt: string, nativeConfig?: string): AdapterResult {
  if (check.gate === "architecture") return runArchitecture(cwd, { configPath: nativeConfig, targets: check.parameters?.architecture?.targets });
  if (check.gate === "package") return runPackageValidation(cwd, check.parameters?.package);
  if (CHECK_GATES.some((gate) => gate === check.gate)) return runSourceAdapter(check.gate, config, cwd, evaluatedAt, nativeConfig);
  throw new Error("Unsupported adapter");
}
function checkEvidence(check: PolicyCheck, result: AdapterResult): CheckEvidence {
  const findings = result.findings.map((item) => item.severity === "error" ? { ...item, severity: check.severity } : item);
  const evidence = { ...result, findings, id: check.id, gate: check.gate, required: check.required, enforcement: check.enforcement, severity: check.severity, rationale: check.rationale, blocking: false, counts: { findings: result.findings.length, waived: 0, active: result.findings.length } };
  evidence.blocking = blocks(evidence);
  return evidence;
}
function metadataError(id: string, outcome: "error" | "incomplete", note: string): CheckEvidence {
  return { id, gate: "policy", required: true, enforcement: "block", outcome, blocking: true, scope: { kind: "repository", targets: ["."], scanned: 0, unit: "inputs" }, findings: [], counts: { findings: 0, waived: 0, active: 0 }, notes: [note] };
}
function policyStable(policy: ResolvedPolicyPack): boolean {
  return [policy.manifest, ...policy.nativeFiles].every((entry) => {
    try { return fs.realpathSync(entry.path) === entry.path && !fs.lstatSync(entry.path).isSymbolicLink() && digest(fs.readFileSync(entry.path)) === entry.digest; }
    catch { return false; }
  });
}
function selectedChecks(config: AbacusConfig, policy: ResolvedPolicyPack | undefined, options: EvaluateOptions): PolicyCheck[] {
  const repository = validateCheckGates(options.gates ?? config.check.gates).map((gate): PolicyCheck => ({ id: gate, gate, required: true, enforcement: "block", severity: "error", rationale: "Repository-selected gate" }));
  if (!policy) return repository;
  const selected = [...policy.pack.checks];
  if (options.includeRepositoryGates) selected.push(...repository.filter((check) => !selected.some((item) => item.gate === check.gate)).map((check) => ({ ...check, id: `repository/${check.id}` })));
  return selected;
}
function compatibilityErrors(pack: ResolvedPolicyPack | undefined, checks: CheckEvidence[], version: string): void {
  if (!pack) return;
  const tools = Object.fromEntries(checks.flatMap((check) => [...(check.tool ? [check.tool] : []), ...(check.tools ?? [])]).map((tool) => [tool.name, tool.version]));
  assertPolicyCompatibility(pack.pack, { abacus: version, tools });
}
function verificationChecks(config: AbacusConfig, cwd: string, source: RunEvidence["source"], at: string, exceptions: RepositoryException[]): CheckEvidence[] {
  return (config.verification?.reports ?? []).map((spec) => {
    const check = { id: `verification/${spec.id}`, gate: "verification", required: spec.required, enforcement: spec.enforcement, severity: "error" as const, rationale: `Repository-owned ${spec.profile} verification` };
    const result = verificationEvidence(spec, cwd, source, at);
    validateAdapterResult(result);
    const evidence: CheckEvidence = { ...result, ...check, blocking: blocks({ ...check, ...result }), counts: { findings: result.findings.length, active: result.findings.length, waived: 0 } };
    return applyExceptions(evidence, exceptions, at);
  });
}

/** No baseline writes, network updates, native configuration rewrites, or fixes. */
export function evaluatePolicy(config: AbacusConfig, cwd = process.cwd(), options: EvaluateOptions = {}): RunEvidence {
  validateAbacusConfig(config);
  validateProjectInputs(config, cwd);
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error("Invalid evaluation timestamp");
  const version = manifest().version;
  const source = sourceProvenance(cwd, config.provenance?.exclude);
  const policy = options.policy ?? (config.policy ? resolvePolicyPack(config.policy.pack, cwd) : undefined);
  const exceptions = validateExceptions(config.policy?.exceptions ?? []);
  const expired = expiredExceptions(exceptions, evaluatedAt);
  const activeExceptions = exceptions.filter((entry) => !expired.some((item) => item.id === entry.id));
  const selected = selectedChecks(config, policy, options);
  const pinnedAtStart = !policy || policyStable(policy);
  const checks = selected.map((check) => {
    let result: AdapterResult;
    try {
      if (!pinnedAtStart) throw new Error("Pinned policy inputs changed after resolution");
      const nativeConfig = policy?.nativeConfigs.find((entry) => entry.checkId === check.id)?.path;
      const effectiveConfig = applyPolicyParameters(config, check.parameters);
      validateAbacusConfig(effectiveConfig);
      validateProjectInputs(effectiveConfig, cwd);
      result = (options.adapter ?? adapter)(check, effectiveConfig, cwd, evaluatedAt, nativeConfig);
      validateAdapterResult(result);
      const closure = nativeConfig ? policy?.nativeFiles ?? [] : [];
      const configEntries = [...(result.configs ?? []), ...closure, { path: "abacus:resolved-config", digest: digest(JSON.stringify(effectiveConfig)) }];
      result.configs = [...new Map(configEntries.map((entry) => [JSON.stringify([entry.path, entry.digest]), entry])).values()];
      if (["pass", "fail", "waived"].includes(result.outcome) && result.scope.scanned === 0) result = { ...result, outcome: "incomplete", notes: [...(result.notes ?? []), "No targets scanned"] };
    } catch (error) {
      // Tool stderr and diagnostic text may contain source snippets or secrets.
      result = { outcome: "error", scope: { kind: "repository", targets: ["."], scanned: 0, unit: "unknown" }, findings: [], ...(error instanceof AdapterFailure ? { errorCode: error.code } : {}), notes: [error instanceof AdapterFailure ? error.message : "Adapter failed. Check installed tools, inputs, native config and supported paths."] };
    }
    return applyExceptions(checkEvidence(check, result), activeExceptions, evaluatedAt);
  });
  checks.push(...verificationChecks(config, cwd, source, evaluatedAt, activeExceptions));
  if (policy && (!pinnedAtStart || !policyStable(policy))) checks.push(metadataError("policy-stability", "incomplete", "Pinned policy manifest or native configuration changed after resolution or during evaluation"));
  if (expired.length) {
    const findings = expired.map((entry) => finding("policy/expired-exception", `exception:${entry.id}`, `Exception ${entry.id} owned by ${entry.owner} expired on ${entry.expires}`));
    checks.push({ id: "policy-exceptions", gate: "policy", required: true, enforcement: "block", outcome: "fail", blocking: true, scope: { kind: "repository", targets: ["repository exceptions"], scanned: exceptions.length, unit: "exceptions" }, findings, counts: { findings: findings.length, waived: 0, active: findings.length } });
  }
  try { compatibilityErrors(policy, checks, version); }
  catch { checks.push(metadataError("policy-compatibility", "error", "Policy requires incompatible or unreported tool versions. Inspect policy compatibility and recorded tool metadata.")); }
  const after = sourceProvenance(cwd, config.provenance?.exclude);
  if (source.commit !== after.commit || source.treeDigest !== after.treeDigest) {
    checks.push(metadataError("source-stability", "incomplete", "Source or built inputs changed during evaluation"));
  }
  const configDigest = digest(JSON.stringify(config));
  return { schemaVersion: 1, fingerprintVersion: 1, evaluatedAt, source, runtime: { node: process.version, platform: process.platform, arch: process.arch, abacus: version }, configDigest, policy: policy ? { name: policy.name, version: policy.version, digest: policy.digest, source: policy.source } : { name: "repository", version: "0.0.0", digest: configDigest, source: "abacus.config.json and defaults" }, checks, clean: checks.every((check) => !check.blocking) };
}

export function printEvidence(run: RunEvidence): void {
  for (const check of run.checks) {
    console.log(`\nChecking ${check.gate}…`);
    console.log(`${check.id}: ${check.outcome}${check.blocking ? " (blocking)" : ""}; scanned ${check.scope.scanned} ${check.scope.unit}; ${check.counts.active} active, ${check.counts.waived} waived findings`);
    for (const item of check.findings.slice(0, 20)) console.log(`  ${item.exceptionId ? "waived " : ""}${item.ruleId}: ${item.subject} ${item.message}`);
    for (const note of check.notes ?? []) console.log(`  ${note}`);
    for (const reason of check.coverage?.reasons ?? []) console.log(`  Coverage ${check.coverage?.status}: ${reason}`);
  }
  console.log(`\n${run.clean ? "Checks completed without blockers" : "Checks have blockers"}; policy ${run.policy.name}@${run.policy.version}`);
}
