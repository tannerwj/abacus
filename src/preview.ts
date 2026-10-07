import type { CheckEvidence, Finding, RunEvidence } from "./evidence.js";
import { canonicalPolicyJson, evaluationDate, validateExceptions, validatePolicyPack, type PolicyPack, type RepositoryException } from "./policy.js";

export interface PreviewFinding extends Finding { checkId: string }
export interface PreviewChange { id: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown }
export interface PolicyPreview {
  schemaVersion: 1;
  evaluatedAt: string;
  source: RunEvidence["source"];
  from: RunEvidence["policy"];
  to: RunEvidence["policy"];
  ruleChanges: PreviewChange[];
  nativeConfigChanges: PreviewChange[];
  thresholdChanges: PreviewChange[];
  enforcementChanges: PreviewChange[];
  addedFindings: PreviewFinding[];
  resolvedFindings: PreviewFinding[];
  newBlockers: Array<{ checkId: string; outcome: CheckEvidence["outcome"]; fingerprints: string[] }>;
  affectedExceptions: Array<{ id: string; reasons: string[]; matchedBefore: number; matchedAfter: number }>;
  cleanBefore: boolean;
  cleanAfter: boolean;
}
export interface PreviewOptions { beforePack?: PolicyPack; afterPack?: PolicyPack; exceptions?: RepositoryException[] }
function indexed<T extends { id: string }>(entries: T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) { if (map.has(entry.id)) throw new Error(`duplicate ${label} id in policy preview: ${entry.id}`); map.set(entry.id, entry); }
  return map;
}
function changes<T extends { id: string }>(before: T[], after: T[], select: (item: T) => unknown): PreviewChange[] {
  const old = indexed(before, "check"), next = indexed(after, "check");
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const a = old.get(id), b = next.get(id), from = a ? select(a) : undefined, to = b ? select(b) : undefined;
    if (canonicalPolicyJson(from) === canonicalPolicyJson(to)) return [];
    return [{ id, kind: a && b ? "changed" as const : a ? "removed" as const : "added" as const, ...(a ? { before: structuredClone(from) } : {}), ...(b ? { after: structuredClone(to) } : {}) }];
  });
}
function allFindings(run: RunEvidence): PreviewFinding[] {
  return run.checks.flatMap((check) => check.findings.map((item) => ({ checkId: check.id, ...structuredClone(item) })));
}
function key(item: PreviewFinding): string { return JSON.stringify([item.checkId, item.fingerprint]); }
function fingerprints(items: PreviewFinding[]): Map<string, PreviewFinding> { return new Map(items.map((item) => [key(item), item])); }
function difference(before: Map<string, PreviewFinding>, after: Map<string, PreviewFinding>): PreviewFinding[] {
  return [...after].filter(([id]) => !before.has(id)).map(([, item]) => item).sort((a, b) => key(a).localeCompare(key(b), "en"));
}
function toolInputs(run: RunEvidence): Map<string, { name: string; version: string; digest?: string }> {
  const tools = new Map<string, { name: string; version: string; digest?: string }>();
  for (const check of run.checks) for (const tool of [...(check.tool ? [check.tool] : []), ...(check.tools ?? [])]) {
    const previous = tools.get(tool.name);
    if (previous && canonicalPolicyJson(previous) !== canonicalPolicyJson(tool)) throw new Error(`policy preview has inconsistent recorded tool inputs for ${tool.name}`);
    tools.set(tool.name, tool);
  }
  return tools;
}
function recordCompilerInput(inputs: Map<string, string>, kind: string, entry: { path: string; digest: string }): void {
  const inputKey = JSON.stringify([kind, entry.path]);
  if (!entry.path || !/^[a-f0-9]{64}$/u.test(entry.digest)) throw new Error("policy preview has invalid compiler input evidence");
  const previous = inputs.get(inputKey);
  if (previous && previous !== entry.digest) throw new Error("policy preview has inconsistent compiler input bytes within a run");
  inputs.set(inputKey, entry.digest);
}
function compilerInputs(run: RunEvidence): Map<string, string> {
  const inputs = new Map<string, string>();
  for (const check of run.checks) for (const project of check.projects ?? []) for (const kind of ["configs", "sources", "dependencies"] as const) {
    for (const entry of project[kind]) recordCompilerInput(inputs, kind, entry);
  }
  return inputs;
}
function compilerProjectClosures(run: RunEvidence): Map<string, string> {
  const closures = new Map<string, string>();
  for (const check of run.checks) for (const project of check.projects ?? []) {
    if (!["pass", "fail"].includes(project.outcome)) continue;
    if (!project.project || (project.inputDigest !== undefined && !/^[a-f0-9]{64}$/u.test(project.inputDigest))) throw new Error("policy preview has invalid compiler project input evidence");
    const inputs = new Map<string, string>();
    for (const kind of ["configs", "sources", "dependencies"] as const) for (const entry of project[kind]) recordCompilerInput(inputs, kind, entry);
    const closure = canonicalPolicyJson({ inputs: [...inputs].sort(([a], [b]) => a.localeCompare(b, "en")), inputDigest: project.inputDigest });
    const previous = closures.get(project.project);
    if (previous !== undefined && previous !== closure) throw new Error("policy preview has inconsistent complete compiler project inputs within a run");
    closures.set(project.project, closure);
  }
  return closures;
}
function assertSameCompilerInputs(before: RunEvidence, after: RunEvidence): void {
  const old = compilerInputs(before), next = compilerInputs(after);
  for (const [inputKey, hash] of old) if (next.has(inputKey) && next.get(inputKey) !== hash) throw new Error("policy preview must use the same bytes for shared compiler inputs");
  const oldProjects = compilerProjectClosures(before), nextProjects = compilerProjectClosures(after);
  for (const [project, closure] of oldProjects) if (nextProjects.has(project) && nextProjects.get(project) !== closure) throw new Error("policy preview must use the same complete input closure for shared compiler projects");
}
function assertSameEnvironment(before: RunEvidence, after: RunEvidence): void {
  if (canonicalPolicyJson(before.runtime) !== canonicalPolicyJson(after.runtime)) throw new Error("policy preview must use the same runtime (Node, Abacus, platform and architecture)");
  if (before.configDigest !== after.configDigest || !/^[a-f0-9]{64}$/u.test(before.configDigest)) throw new Error("policy preview must use the same repository configuration digest");
  const old = toolInputs(before), next = toolInputs(after);
  for (const [name, tool] of old) {
    const candidate = next.get(name);
    if (candidate && canonicalPolicyJson(tool) !== canonicalPolicyJson(candidate)) throw new Error(`policy preview must use the same version and digest for shared tool ${name}`);
  }
}

function validateRunPair(before: RunEvidence, after: RunEvidence): void {
  if (before.schemaVersion !== 1 || after.schemaVersion !== 1 || before.fingerprintVersion !== 1 || after.fingerprintVersion !== 1) throw new Error("policy preview requires matching supported evidence/fingerprint schema versions");
  evaluationDate(before.evaluatedAt); evaluationDate(after.evaluatedAt);
  if (Date.parse(before.evaluatedAt) !== Date.parse(after.evaluatedAt)) throw new Error("policy preview must use the same evaluation time for both policies");
  if (before.source.commit !== after.source.commit || before.source.treeDigest !== after.source.treeDigest || !/^[a-f0-9]{64}$/u.test(before.source.treeDigest)) throw new Error("policy preview must evaluate the same source commit and treeDigest");
  indexed(before.checks, "check"); indexed(after.checks, "check");
  assertSameEnvironment(before, after);
  assertSameCompilerInputs(before, after);
}
function assertPackMetadata(run: RunEvidence, pack?: PolicyPack): void {
  if (!pack) return;
  validatePolicyPack(pack);
  if (run.policy.name !== pack.name || run.policy.version !== pack.version) throw new Error("preview policy metadata does not match the supplied pack");
  const ids = [...indexed(pack.checks, "pack check").keys()].sort();
  if (canonicalPolicyJson(ids) !== canonicalPolicyJson(run.checks.filter((check) => check.gate !== "verification" && !(check.gate === "policy" && ["policy-compatibility", "source-stability", "policy-exceptions", "policy-stability"].includes(check.id))).map((check) => check.id).sort())) throw new Error("preview evidence checks do not match the supplied policy pack");
}
function affectedExceptions(before: PreviewFinding[], after: PreviewFinding[], exceptions: RepositoryException[], changedRules: PreviewChange[], evaluatedAt: string): PolicyPreview["affectedExceptions"] {
  const changed = new Set(changedRules.map((change) => change.id)); const date = evaluationDate(evaluatedAt);
  return validateExceptions(exceptions).flatMap((exception) => {
    const matches = (items: PreviewFinding[]) => items.filter((item) => item.ruleId === exception.ruleId && item.subject === exception.subject);
    const a = matches(before), b = matches(after), reasons: string[] = [];
    if (exception.expires < date) reasons.push("expired");
    if (a.length && !b.length) reasons.push("finding-resolved");
    if (!a.length && b.length) reasons.push("newly-matched");
    if ([...a, ...b].some((item) => changed.has(item.checkId))) reasons.push("check-changed");
    if (canonicalPolicyJson(a.map(key).sort()) !== canonicalPolicyJson(b.map(key).sort()) && a.length && b.length) reasons.push("matching-findings-changed");
    if (!reasons.length) return [];
    return [{ id: exception.id, reasons, matchedBefore: a.length, matchedAfter: b.length }];
  });
}
/**
 * Pure comparison of already evaluated runs. It never invokes a tool, touches a source file,
 * changes a pin/exception, or creates a ratchet baseline. Evaluate both policies first on one tree.
 */
export function comparePolicyRuns(before: RunEvidence, after: RunEvidence, options: PreviewOptions = {}): PolicyPreview {
  validateRunPair(before, after); assertPackMetadata(before, options.beforePack); assertPackMetadata(after, options.afterPack);
  const beforeFindings = allFindings(before), afterFindings = allFindings(after);
  const old = fingerprints(beforeFindings), next = fingerprints(afterFindings);
  const evidenceRules = changes(before.checks, after.checks, (check) => ({ gate: check.gate, required: check.required }));
  const ruleChanges = options.beforePack && options.afterPack ? changes(options.beforePack.checks, options.afterPack.checks, (check) => ({ gate: check.gate, required: check.required, severity: check.severity, rationale: check.rationale })) : evidenceRules;
  const beforePackChecks = options.beforePack && options.afterPack ? indexed(options.beforePack.checks, "pack check") : undefined;
  const afterPackChecks = options.beforePack && options.afterPack ? indexed(options.afterPack.checks, "pack check") : undefined;
  const nativeConfigChanges = changes(
    before.checks.map((check) => ({ ...check, declaration: beforePackChecks?.get(check.id)?.nativeConfig })),
    after.checks.map((check) => ({ ...check, declaration: afterPackChecks?.get(check.id)?.nativeConfig })),
    (check) => check.declaration || check.configs?.length ? { declaration: check.declaration, configs: check.configs ?? [] } : undefined,
  );
  const thresholdChanges = options.beforePack && options.afterPack ? changes(options.beforePack.checks, options.afterPack.checks, (check) => check.parameters && Object.keys(check.parameters).length ? check.parameters : undefined) : [];
  const enforcementChanges = changes(before.checks, after.checks, (check) => check.enforcement);
  const priorChecks = indexed(before.checks, "check");
  const newBlockers = after.checks.filter((check) => check.blocking).flatMap((check) => {
    const prior = priorChecks.get(check.id); const active = check.findings.filter((item) => !item.exceptionId);
    const priorActive = new Set(prior?.findings.filter((item) => !item.exceptionId).map((item) => item.fingerprint) ?? []);
    const added = active.filter((item) => !priorActive.has(item.fingerprint)).map((item) => item.fingerprint).sort();
    return !prior?.blocking || added.length || prior.outcome !== check.outcome ? [{ checkId: check.id, outcome: check.outcome, fingerprints: added }] : [];
  });
  return { schemaVersion: 1, evaluatedAt: before.evaluatedAt, source: structuredClone(before.source), from: structuredClone(before.policy), to: structuredClone(after.policy),
    ruleChanges, nativeConfigChanges, thresholdChanges, enforcementChanges,
    addedFindings: difference(old, next), resolvedFindings: difference(next, old), newBlockers,
    affectedExceptions: affectedExceptions(beforeFindings, afterFindings, options.exceptions ?? [], [...ruleChanges, ...nativeConfigChanges, ...thresholdChanges, ...enforcementChanges], before.evaluatedAt),
    cleanBefore: before.clean, cleanAfter: after.clean,
  };
}
