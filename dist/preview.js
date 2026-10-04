import { canonicalPolicyJson, evaluationDate, validateExceptions, validatePolicyPack } from "./policy.js";
function indexed(entries, label) {
    const map = new Map();
    for (const entry of entries) {
        if (map.has(entry.id))
            throw new Error(`duplicate ${label} id in policy preview: ${entry.id}`);
        map.set(entry.id, entry);
    }
    return map;
}
function changes(before, after, select) {
    const old = indexed(before, "check"), next = indexed(after, "check");
    return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
        const a = old.get(id), b = next.get(id), from = a ? select(a) : undefined, to = b ? select(b) : undefined;
        if (canonicalPolicyJson(from) === canonicalPolicyJson(to))
            return [];
        return [{ id, kind: a && b ? "changed" : a ? "removed" : "added", ...(a ? { before: structuredClone(from) } : {}), ...(b ? { after: structuredClone(to) } : {}) }];
    });
}
function allFindings(run) {
    return run.checks.flatMap((check) => check.findings.map((item) => ({ checkId: check.id, ...structuredClone(item) })));
}
function key(item) { return JSON.stringify([item.checkId, item.fingerprint]); }
function fingerprints(items) { return new Map(items.map((item) => [key(item), item])); }
function difference(before, after) {
    return [...after].filter(([id]) => !before.has(id)).map(([, item]) => item).sort((a, b) => key(a).localeCompare(key(b), "en"));
}
function toolInputs(run) {
    const tools = new Map();
    for (const check of run.checks)
        for (const tool of [...(check.tool ? [check.tool] : []), ...(check.tools ?? [])]) {
            const previous = tools.get(tool.name);
            if (previous && canonicalPolicyJson(previous) !== canonicalPolicyJson(tool))
                throw new Error(`policy preview has inconsistent recorded tool inputs for ${tool.name}`);
            tools.set(tool.name, tool);
        }
    return tools;
}
function recordCompilerInput(inputs, kind, entry) {
    const inputKey = JSON.stringify([kind, entry.path]);
    if (!entry.path || !/^[a-f0-9]{64}$/u.test(entry.digest))
        throw new Error("policy preview has invalid compiler input evidence");
    const previous = inputs.get(inputKey);
    if (previous && previous !== entry.digest)
        throw new Error("policy preview has inconsistent compiler input bytes within a run");
    inputs.set(inputKey, entry.digest);
}
function compilerInputs(run) {
    const inputs = new Map();
    for (const check of run.checks)
        for (const project of check.projects ?? [])
            for (const kind of ["configs", "sources", "dependencies"]) {
                for (const entry of project[kind])
                    recordCompilerInput(inputs, kind, entry);
            }
    return inputs;
}
function assertSameCompilerInputs(before, after) {
    const old = compilerInputs(before), next = compilerInputs(after);
    for (const [inputKey, hash] of old)
        if (next.has(inputKey) && next.get(inputKey) !== hash)
            throw new Error("policy preview must use the same bytes for shared compiler inputs");
}
function assertSameEnvironment(before, after) {
    if (canonicalPolicyJson(before.runtime) !== canonicalPolicyJson(after.runtime))
        throw new Error("policy preview must use the same runtime (Node, Abacus, platform and architecture)");
    if (before.configDigest !== after.configDigest || !/^[a-f0-9]{64}$/u.test(before.configDigest))
        throw new Error("policy preview must use the same repository configuration digest");
    const old = toolInputs(before), next = toolInputs(after);
    for (const [name, tool] of old) {
        const candidate = next.get(name);
        if (candidate && canonicalPolicyJson(tool) !== canonicalPolicyJson(candidate))
            throw new Error(`policy preview must use the same version and digest for shared tool ${name}`);
    }
}
function validateRunPair(before, after) {
    if (before.schemaVersion !== 1 || after.schemaVersion !== 1 || before.fingerprintVersion !== 1 || after.fingerprintVersion !== 1)
        throw new Error("policy preview requires matching supported evidence/fingerprint schema versions");
    evaluationDate(before.evaluatedAt);
    evaluationDate(after.evaluatedAt);
    if (Date.parse(before.evaluatedAt) !== Date.parse(after.evaluatedAt))
        throw new Error("policy preview must use the same evaluation time for both policies");
    if (before.source.commit !== after.source.commit || before.source.treeDigest !== after.source.treeDigest || !/^[a-f0-9]{64}$/u.test(before.source.treeDigest))
        throw new Error("policy preview must evaluate the same source commit and treeDigest");
    indexed(before.checks, "check");
    indexed(after.checks, "check");
    assertSameEnvironment(before, after);
    assertSameCompilerInputs(before, after);
}
function assertPackMetadata(run, pack) {
    if (!pack)
        return;
    validatePolicyPack(pack);
    if (run.policy.name !== pack.name || run.policy.version !== pack.version)
        throw new Error("preview policy metadata does not match the supplied pack");
    const ids = [...indexed(pack.checks, "pack check").keys()].sort();
    if (canonicalPolicyJson(ids) !== canonicalPolicyJson(run.checks.filter((check) => !(check.gate === "policy" && ["policy-compatibility", "source-stability", "policy-exceptions", "policy-stability"].includes(check.id))).map((check) => check.id).sort()))
        throw new Error("preview evidence checks do not match the supplied policy pack");
}
function affectedExceptions(before, after, exceptions, changedRules, evaluatedAt) {
    const changed = new Set(changedRules.map((change) => change.id));
    const date = evaluationDate(evaluatedAt);
    return validateExceptions(exceptions).flatMap((exception) => {
        const matches = (items) => items.filter((item) => item.ruleId === exception.ruleId && item.subject === exception.subject);
        const a = matches(before), b = matches(after), reasons = [];
        if (exception.expires < date)
            reasons.push("expired");
        if (a.length && !b.length)
            reasons.push("finding-resolved");
        if (!a.length && b.length)
            reasons.push("newly-matched");
        if ([...a, ...b].some((item) => changed.has(item.checkId)))
            reasons.push("check-changed");
        if (canonicalPolicyJson(a.map(key).sort()) !== canonicalPolicyJson(b.map(key).sort()) && a.length && b.length)
            reasons.push("matching-findings-changed");
        if (!reasons.length)
            return [];
        return [{ id: exception.id, reasons, matchedBefore: a.length, matchedAfter: b.length }];
    });
}
/**
 * Pure comparison of already evaluated runs. It never invokes a tool, touches a source file,
 * changes a pin/exception, or creates a ratchet baseline. Evaluate both policies first on one tree.
 */
export function comparePolicyRuns(before, after, options = {}) {
    validateRunPair(before, after);
    assertPackMetadata(before, options.beforePack);
    assertPackMetadata(after, options.afterPack);
    const beforeFindings = allFindings(before), afterFindings = allFindings(after);
    const old = fingerprints(beforeFindings), next = fingerprints(afterFindings);
    const evidenceRules = changes(before.checks, after.checks, (check) => ({ gate: check.gate, required: check.required }));
    const ruleChanges = options.beforePack && options.afterPack ? changes(options.beforePack.checks, options.afterPack.checks, (check) => ({ gate: check.gate, required: check.required, severity: check.severity, rationale: check.rationale })) : evidenceRules;
    const beforePackChecks = options.beforePack && options.afterPack ? indexed(options.beforePack.checks, "pack check") : undefined;
    const afterPackChecks = options.beforePack && options.afterPack ? indexed(options.afterPack.checks, "pack check") : undefined;
    const nativeConfigChanges = changes(before.checks.map((check) => ({ ...check, declaration: beforePackChecks?.get(check.id)?.nativeConfig })), after.checks.map((check) => ({ ...check, declaration: afterPackChecks?.get(check.id)?.nativeConfig })), (check) => check.declaration || check.configs?.length ? { declaration: check.declaration, configs: check.configs ?? [] } : undefined);
    const thresholdChanges = options.beforePack && options.afterPack ? changes(options.beforePack.checks, options.afterPack.checks, (check) => check.parameters && Object.keys(check.parameters).length ? check.parameters : undefined) : [];
    const enforcementChanges = changes(before.checks, after.checks, (check) => check.enforcement);
    const priorChecks = indexed(before.checks, "check");
    const newBlockers = after.checks.filter((check) => check.blocking).flatMap((check) => {
        const prior = priorChecks.get(check.id);
        const active = check.findings.filter((item) => !item.exceptionId);
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
