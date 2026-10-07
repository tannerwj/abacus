import { describe, expect, test } from "vitest";
import fs from "node:fs";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { digest, finding, type CheckEvidence, type Finding, type RunEvidence } from "../src/evidence.js";
import { comparePolicyRuns } from "../src/preview.js";
import { validatePolicyPack, type PolicyPack, type RepositoryException } from "../src/policy.js";

function pack(file = "configs/policy-packs/advisory/policy.json"): PolicyPack { return validatePolicyPack(JSON.parse(fs.readFileSync(file, "utf8"))); }
function run(policy: PolicyPack): RunEvidence {
  return { schemaVersion: 1, fingerprintVersion: 1, evaluatedAt: "2026-10-04T12:00:00.000Z", source: { commit: "a".repeat(40), treeDigest: digest("same immutable source"), dirty: false },
    runtime: { node: "v24.0.0", platform: "linux", arch: "x64", abacus: "0.2.0" }, configDigest: digest("config"),
    policy: { name: policy.name, version: policy.version, digest: digest(policy.version), source: `local:policy-${policy.version}.json` },
    checks: policy.checks.map((check) => ({ id: check.id, gate: check.gate, required: check.required, enforcement: check.enforcement, outcome: "pass", blocking: false,
      scope: { kind: "file", targets: ["src"], scanned: 1, unit: "files" }, findings: [], counts: { findings: 0, waived: 0, active: 0 },
      ...(check.nativeConfig ? { configs: [{ path: check.nativeConfig, digest: digest("native-config") }] } : {}) })), clean: true,
  };
}
function findCheck(evidence: RunEvidence, id = "function-complexity"): CheckEvidence { return evidence.checks.find((item) => item.id === id)!; }
function fail(target: CheckEvidence, items: Finding[], blocking = false): void { target.findings = items; target.outcome = "fail"; target.blocking = blocking; target.counts = { findings: items.length, waived: items.filter((item) => item.exceptionId).length, active: items.filter((item) => !item.exceptionId).length }; }
const exception: RepositoryException = { id: "legacy-complexity", ruleId: "abc/budget", subject: "src/a.ts fn", owner: "team", reason: "Tracked decomposition", expires: "2026-12-31" };

test("comparing identical generated evidence never invents finding changes", () => hegel.test((tc) => {
  const evidence = run(pack());
  const subjects = tc.draw(gs.arrays(gs.integers(), { maxSize: 64 }));
  fail(evidence.checks[0], [...new Set(subjects)].map((subject) => finding("abc/budget", String(subject), "Over budget")), true);
  const comparison = comparePolicyRuns(evidence, structuredClone(evidence));
  expect([comparison.addedFindings, comparison.resolvedFindings, comparison.newBlockers]).toEqual([[], [], []]);
}, { testCases: 2000, seed: Number(process.env.ABACUS_PBT_SEED ?? 20261007), database: hegel.Database.disabled }));

describe("pure policy upgrade preview", () => {
  test("compares versioned thresholds and enforcement without editing either run or pack", () => {
    const beforePack = pack(), afterPack = pack("configs/policy-packs/advisory-next/policy.json"), before = run(beforePack), after = run(afterPack);
    const inputs = structuredClone({ beforePack, afterPack, before, after });
    const result = comparePolicyRuns(before, after, { beforePack, afterPack });
    expect(result.thresholdChanges).toEqual([{ id: "function-complexity", kind: "changed", before: { abc: { budget: 60 } }, after: { abc: { budget: 50 } } }]);
    expect(result.enforcementChanges).toEqual([{ id: "function-complexity", kind: "changed", before: "observe", after: "warn" }]);
    expect(result.ruleChanges).toEqual([]); expect(result.addedFindings).toEqual([]); expect(result.newBlockers).toEqual([]);
    expect({ beforePack, afterPack, before, after }).toEqual(inputs);
  });
  test("reports added/resolved logical fingerprints and new blockers", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    const resolved = finding("abc/budget", "src/a.ts fn", "60 exceeded"), added = finding("abc/budget", "src/b.ts fn", "50 exceeded");
    fail(findCheck(before), [resolved]); fail(findCheck(after), [added], true); findCheck(after).enforcement = "block"; after.clean = false;
    const result = comparePolicyRuns(before, after, { exceptions: [exception] });
    expect(result.resolvedFindings).toEqual([{ checkId: "function-complexity", ...resolved }]); expect(result.addedFindings).toEqual([{ checkId: "function-complexity", ...added }]);
    expect(result.newBlockers).toEqual([{ checkId: "function-complexity", outcome: "fail", fingerprints: [added.fingerprint] }]);
    expect(result.affectedExceptions).toEqual([{ id: exception.id, reasons: ["finding-resolved", "check-changed"], matchedBefore: 1, matchedAfter: 0 }]);
    expect(result.cleanBefore).toBe(true); expect(result.cleanAfter).toBe(false);
  });
  test("threshold/message changes preserve finding continuity", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    fail(findCheck(before), [finding("abc/budget", "src/a.ts fn", "score 70 exceeds budget 60")]);
    fail(findCheck(after), [finding("abc/budget", "src/a.ts fn", "score 70 exceeds budget 50")]);
    const result = comparePolicyRuns(before, after);
    expect(result.addedFindings).toEqual([]); expect(result.resolvedFindings).toEqual([]);
  });
  test("tracks added, removed and changed rules plus native config declarations/hashes", () => {
    const beforePack = pack(), afterPack = pack(); afterPack.version = "1.1.0"; afterPack.checks.pop(); afterPack.checks[0].nativeConfig = "native/new.json";
    afterPack.checks[0].rationale = "Promote measured lint coverage"; afterPack.checks.push({ id: "architecture", gate: "architecture", required: true, enforcement: "warn", severity: "error", rationale: "Enforce layer boundaries", parameters: { architecture: { targets: ["src"] } } });
    const before = run(beforePack), after = run(afterPack); after.checks[0].configs![0].digest = digest("changed native rules");
    const result = comparePolicyRuns(before, after, { beforePack, afterPack });
    expect(result.ruleChanges.map((item) => [item.id, item.kind])).toEqual([["architecture", "added"], ["source-lint", "changed"], ["source-types", "removed"]]);
    const changed = result.nativeConfigChanges.find((item) => item.id === "source-lint")!;
    expect(changed.before).toEqual({ declaration: "native/oxlint.json", configs: before.checks[0].configs });
    expect(changed.after).toEqual({ declaration: "native/new.json", configs: after.checks[0].configs });
  });
  test("a removed waiver is a new blocker even when the fingerprint is unchanged", () => {
    const policy = pack(), before = run(policy), after = run(policy), item = finding(exception.ruleId, exception.subject, "over budget");
    fail(findCheck(before), [{ ...item, exceptionId: exception.id }]); findCheck(before).outcome = "waived";
    fail(findCheck(after), [item], true); findCheck(after).enforcement = "block";
    const result = comparePolicyRuns(before, after, { exceptions: [exception] });
    expect(result.addedFindings).toEqual([]); expect(result.newBlockers[0].fingerprints).toEqual([item.fingerprint]); expect(result.affectedExceptions[0].reasons).toContain("check-changed");
  });
  test("new failing required coverage and expired exceptions remain visible", () => {
    const policy = pack(), before = run(policy), after = run(policy); findCheck(after, "source-types").outcome = "incomplete"; findCheck(after, "source-types").blocking = true;
    const result = comparePolicyRuns(before, after, { exceptions: [{ ...exception, expires: "2025-01-01" }] });
    expect(result.newBlockers).toEqual([{ checkId: "source-types", outcome: "incomplete", fingerprints: [] }]);
    expect(result.affectedExceptions).toEqual([{ id: exception.id, reasons: ["expired"], matchedBefore: 0, matchedAfter: 0 }]);
  });
  test("rejects comparisons across source commits, source trees or evaluation times", () => {
    const policy = pack(), before = run(policy);
    for (const change of ["commit", "treeDigest", "evaluatedAt"] as const) {
      const after = run(policy); if (change === "evaluatedAt") after.evaluatedAt = "2026-10-05T12:00:00.000Z"; else after.source[change] = digest("different source");
      expect(() => comparePolicyRuns(before, after)).toThrow(/same evaluation time|same source commit/u);
    }
    const invalid = run(policy); invalid.evaluatedAt = "2026-02-30T12:00:00Z"; expect(() => comparePolicyRuns(invalid, invalid)).toThrow("valid ISO timestamp");
    const unsupported = run(policy); (unsupported as { fingerprintVersion: number }).fingerprintVersion = 2; expect(() => comparePolicyRuns(before, unsupported)).toThrow("schema versions");
  });
  test("refuses runtime or repository configuration drift even on identical source/time", () => {
    const policy = pack(), before = run(policy);
    for (const field of ["node", "abacus", "platform", "arch"] as const) {
      const after = run(policy); after.runtime[field] = `changed-${field}`;
      expect(() => comparePolicyRuns(before, after)).toThrow("same runtime");
    }
    const changedConfig = run(policy); changedConfig.configDigest = digest("different repository configuration");
    expect(() => comparePolicyRuns(before, changedConfig)).toThrow("same repository configuration digest");
    const invalid = run(policy); before.configDigest = invalid.configDigest = "not-a-sha256";
    expect(() => comparePolicyRuns(before, invalid)).toThrow("configuration digest");
  });
  test("requires shared tool versions/digests to match and detects inconsistent manifests", () => {
    const policy = pack(), before = run(policy), original = { name: "oxlint", version: "1.82.0", digest: digest("installed tool") };
    before.checks[0].tool = original;
    for (const patch of [{ version: "1.83.0" }, { digest: digest("different binary") }, { digest: undefined }]) {
      const after = run(policy); after.checks[0].tool = { ...original, ...patch };
      expect(() => comparePolicyRuns(before, after)).toThrow("same version and digest for shared tool oxlint");
    }
    const moved = run(policy); moved.checks[1].tools = [original];
    expect(comparePolicyRuns(before, moved).newBlockers).toEqual([]);
    const addedTool = run(policy); addedTool.checks[0].tool = original; addedTool.checks[1].tools = [{ name: "typescript", version: "5.9.3", digest: digest("added compiler") }];
    expect(comparePolicyRuns(before, addedTool).newBlockers).toEqual([]);
    addedTool.checks[1].tools.push({ ...original, version: "1.83.0" });
    expect(() => comparePolicyRuns(before, addedTool)).toThrow("inconsistent recorded tool inputs");
  });
  test("permits explicit policy metadata failures while rejecting undeclared ordinary checks", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    const meta: CheckEvidence = { ...structuredClone(findCheck(after)), id: "policy-compatibility", gate: "policy", required: true, enforcement: "observe", outcome: "error", blocking: true, findings: [] };
    after.checks.push(meta, { ...structuredClone(meta), id: "policy-exceptions" }, { ...structuredClone(meta), id: "policy-stability" });
    const preview = comparePolicyRuns(before, after, { beforePack: policy, afterPack: policy });
    expect(preview.newBlockers).toContainEqual({ checkId: "policy-compatibility", outcome: "error", fingerprints: [] });
    expect(preview.nativeConfigChanges).toEqual([]); expect(preview.thresholdChanges).toEqual([]);
    after.checks[after.checks.length - 1].id = "unregistered-gate";
    expect(() => comparePolicyRuns(before, after, { beforePack: policy, afterPack: policy })).toThrow("checks do not match");
  });
  test("accepts equivalent explicit timestamp formats but rejects pack/evidence mismatches", () => {
    const policy = pack(), before = run(policy), after = run(policy); after.evaluatedAt = "2026-10-04T12:00:00Z";
    expect(comparePolicyRuns(before, after).newBlockers).toEqual([]);
    const mismatch = pack(); mismatch.name = "another-pack"; expect(() => comparePolicyRuns(before, after, { beforePack: mismatch })).toThrow("metadata");
    const incompletePack = pack(); incompletePack.checks.pop(); expect(() => comparePolicyRuns(before, after, { beforePack: incompletePack })).toThrow("checks do not match");
    after.checks.push(after.checks[0]); expect(() => comparePolicyRuns(before, after)).toThrow("duplicate");
  });
  test("compiler preview refuses changed shared declaration bytes but allows project selection changes", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    const project = { project: "tsconfig.json", outcome: "pass" as const, scope: { kind: "repository" as const, targets: ["tsconfig.json"], scanned: 1, unit: "files" }, diagnostics: [], configs: [{ path: "tsconfig.json", digest: digest("config bytes") }], sources: [{ path: "src/index.ts", digest: digest("source bytes") }], dependencies: [{ path: "installed:node_modules/dependency/index.d.ts", digest: digest("declarations v1") }] };
    findCheck(before, "source-types").projects = [structuredClone(project)];
    findCheck(after, "source-types").projects = [structuredClone(project)];
    const changed = findCheck(after, "source-types").projects?.[0];
    if (!changed) throw new Error("Missing compiler fixture");
    changed.dependencies[0].digest = digest("declarations v2");
    expect(() => comparePolicyRuns(before, after)).toThrow(/same bytes for shared compiler inputs/);
    changed.dependencies[0].digest = digest("declarations v1"); changed.project = "tsconfig.app.json";
    expect(comparePolicyRuns(before, after).cleanAfter).toBe(true);
  });

  test("unchanged compiler project selectors require complete input-set equality", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    const project = { project: "tsconfig.json", outcome: "pass" as const, scope: { kind: "repository" as const, targets: ["tsconfig.json"], scanned: 1, unit: "files" }, diagnostics: [], configs: [{ path: "tsconfig.json", digest: digest("same config") }], sources: [{ path: "src/index.ts", digest: digest("same source") }], dependencies: [{ path: "installed:node_modules/typed/a.d.ts", digest: digest("number declaration") }] };
    findCheck(before, "source-types").projects = [structuredClone(project)];
    findCheck(after, "source-types").projects = [{ ...structuredClone(project), outcome: "fail", dependencies: [{ path: "installed:node_modules/typed/b.d.ts", digest: digest("string declaration") }] }];
    expect(() => comparePolicyRuns(before, after)).toThrow(/same complete input closure for shared compiler projects/);
    const changed = findCheck(after, "source-types").projects?.[0];
    if (!changed) throw new Error("Missing compiler project fixture");
    changed.project = "tsconfig.app.json";
    expect(comparePolicyRuns(before, after).cleanAfter).toBe(true);
  });

  test("shared complete compiler input digests must match even when input paths match", () => {
    const policy = pack(), before = run(policy), after = run(policy);
    const project = { project: "tsconfig.json", outcome: "pass" as const, scope: { kind: "repository" as const, targets: ["tsconfig.json"], scanned: 1, unit: "files" }, diagnostics: [], configs: [{ path: "tsconfig.json", digest: digest("config") }], sources: [{ path: "index.ts", digest: digest("source") }], dependencies: [], inputDigest: digest("input closure") };
    findCheck(before, "source-types").projects = [structuredClone(project)];
    findCheck(after, "source-types").projects = [{ ...structuredClone(project), inputDigest: digest("changed closure") }];
    expect(() => comparePolicyRuns(before, after)).toThrow(/same complete input closure/);
    findCheck(after, "source-types").projects = [{ ...structuredClone(project), outcome: "incomplete", inputDigest: undefined, sources: [] }];
    findCheck(after, "source-types").outcome = "incomplete";
    findCheck(after, "source-types").blocking = true;
    after.clean = false;
    expect(comparePolicyRuns(before, after).newBlockers).toContainEqual({ checkId: "source-types", outcome: "incomplete", fingerprints: [] });
  });

});
