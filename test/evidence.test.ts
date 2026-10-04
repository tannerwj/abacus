import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaults, loadConfig } from "../src/config.js";
import { digest, finding, type AdapterResult } from "../src/evidence.js";
import { evaluatePolicy } from "../src/policy-runner.js";
import { computePolicyPackDigest, resolvePolicyPack, type PolicyPack } from "../src/policy.js";
import { reportRatchet } from "../src/ratchet.js";
import { runSourceAdapter } from "../src/source-adapters.js";

const at = "2026-10-04T07:00:00.000Z";
const cleanResult = (): AdapterResult => ({ outcome: "pass", scope: { kind: "repository", targets: ["src"], scanned: 1, unit: "files" }, findings: [] });
const config = () => { const value = defaults("typescript"); value.check.gates = ["todos", "abc"]; value.roots = ["src"]; return value; };

describe("trustworthy evidence", () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-evidence-")); fs.mkdirSync(path.join(cwd, "src")); fs.writeFileSync(path.join(cwd, "src/index.ts"), 'export const hello = "world";\n'); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  test("runs every check and records distinct failure and error outcomes", () => {
    const calls: string[] = [];
    const run = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: (check) => {
      calls.push(check.id);
      if (check.gate === "todos") return { ...cleanResult(), outcome: "fail", findings: [finding("todos/expired", "src/index.ts:1", "Expired deadline")] };
      throw new Error("secret-bearing tool output must not be returned");
    } });
    expect(calls).toEqual(["todos", "abc"]);
    expect(run.checks.map((item) => item.outcome)).toEqual(["fail", "error"]);
    expect(run.clean).toBe(false);
    expect(JSON.stringify(run)).not.toContain("secret-bearing");
    expect(run.source.treeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run.runtime.abacus).toBeTruthy();
  });

  test.each([0, -1, Number.NaN])("zero/invalid scanned count %s cannot be green", (scanned) => {
    const run = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: () => ({ ...cleanResult(), scope: { ...cleanResult().scope, scanned } }) });
    expect(run.clean).toBe(false);
    expect(run.checks[0].outcome).toBe(scanned === 0 ? "incomplete" : "error");
  });

  test("invalid outcomes and contradictory pass/error findings are errors", () => {
    const run = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: () => ({ ...cleanResult(), findings: [finding("abc/budget", "subject", "Bad")] }) });
    expect(run.checks.every((item) => item.outcome === "error")).toBe(true);
  });

  test("detects mutations during a run and keeps evidence incomplete", () => {
    const run = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: () => {
      fs.writeFileSync(path.join(cwd, "src/index.ts"), 'export const changed = true;\n'); return cleanResult();
    } });
    expect(run.clean).toBe(false);
    expect(run.checks.at(-1)).toMatchObject({ id: "source-stability", outcome: "incomplete", blocking: true });
  });

  test("normal checks never create a ratchet baseline", () => {
    const value = config(); value.check.gates = ["ratchet"];
    const run = evaluatePolicy(value, cwd, { evaluatedAt: at });
    expect(run.clean).toBe(false);
    expect(run.checks[0]).toMatchObject({ outcome: "error", errorCode: "missing-baseline", notes: [expect.stringContaining("baseline is missing")] });
    expect(fs.existsSync(path.join(cwd, value.ratchet.file))).toBe(false);
  });

  test("real source adapters distinguish populated, empty and absent scopes", () => {
    expect(runSourceAdapter("abc", config(), cwd, at)).toMatchObject({ outcome: "pass", scope: { scanned: 1 } });
    fs.rmSync(path.join(cwd, "src/index.ts"));
    expect(runSourceAdapter("abc", config(), cwd, at).outcome).toBe("incomplete");
    expect(runSourceAdapter("todos", config(), cwd, at).outcome).toBe("incomplete");
    expect(runSourceAdapter("size", config(), cwd, at).outcome).toBe("not-applicable");
  });

  test("an exact exception stays visible as waived", () => {
    const value = config(); value.policy = { pack: { path: "pack.json", version: "1.0.0", digest: digest("placeholder") }, exceptions: [{ id: "temporary-debt", ruleId: "abc/budget", subject: "src/index.ts compute #1", owner: "repo-maintainers", reason: "Tracking a bounded refactor", expires: "2026-11-01" }] };
    const pack: PolicyPack = { schemaVersion: 1, name: "test-pack", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "abc", gate: "abc", required: true, enforcement: "block", severity: "error", rationale: "Bounded complexity" }] };
    fs.writeFileSync(path.join(cwd, "pack.json"), JSON.stringify(pack));
    value.policy.pack.digest = computePolicyPackDigest(path.join(cwd, "pack.json"));
    const run = evaluatePolicy(value, cwd, { evaluatedAt: at, adapter: () => ({ ...cleanResult(), outcome: "fail", findings: [finding("abc/budget", "src/index.ts compute #1", "ABC 61 exceeds 60")] }) });
    expect(run.clean).toBe(true);
    expect(run.checks[0]).toMatchObject({ outcome: "waived", counts: { findings: 1, waived: 1, active: 0 } });
  });

  test("required advisory adapters still block when their tool is unavailable", () => {
    const pack: PolicyPack = { schemaVersion: 1, name: "advisory", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1, tools: { oxlint: "1.82.0" } }, checks: [{ id: "advisory-lint", gate: "lint", required: true, enforcement: "observe", severity: "warning", rationale: "Gather complete evidence" }] };
    const file = path.join(cwd, "policy.json"); fs.writeFileSync(file, JSON.stringify(pack));
    const policy = resolvePolicyPack({ path: "policy.json", version: "1.0.0", digest: computePolicyPackDigest(file) }, cwd);
    const run = evaluatePolicy(config(), cwd, { policy, evaluatedAt: at, adapter: () => { throw new Error("unavailable"); } });
    expect(run.clean).toBe(false);
    expect(run.checks[0]).toMatchObject({ outcome: "error", blocking: true });
    expect(run.checks.at(-1)).toMatchObject({ id: "policy-compatibility", outcome: "error" });
  });
  test("expired waivers block even an advisory-only policy", () => {
    const value = config();
    const pack: PolicyPack = { schemaVersion: 1, name: "advisory-debt", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "abc", gate: "abc", required: true, enforcement: "warn", severity: "warning", rationale: "Observe debt" }] };
    const file = path.join(cwd, "pack.json"); fs.writeFileSync(file, JSON.stringify(pack));
    value.policy = { pack: { path: "pack.json", version: "1.0.0", digest: computePolicyPackDigest(file) }, exceptions: [{ id: "expired", ruleId: "abc/budget", subject: "old-function", owner: "maintainers", reason: "No longer an active waiver", expires: "2026-10-01" }] };
    const run = evaluatePolicy(value, cwd, { evaluatedAt: at, adapter: cleanResult });
    expect(run.clean).toBe(false);
    expect(run.checks[0].outcome).toBe("pass");
    expect(run.checks.at(-1)).toMatchObject({ id: "policy-exceptions", gate: "policy", blocking: true, counts: { findings: 1, active: 1, waived: 0 } });
  });

  test("ABC-only ratchet without source files is incomplete rather than metric zero", () => {
    const value = config(); value.check.gates = ["ratchet"]; value.ratchet.metrics = { abcMax: true };
    fs.rmSync(path.join(cwd, "src/index.ts"));
    fs.writeFileSync(path.join(cwd, value.ratchet.file), JSON.stringify({ abcMax: 10 }));
    expect(evaluatePolicy(value, cwd, { evaluatedAt: at }).checks[0].outcome).toBe("incomplete");
  });

  test("malformed metric slack and out-of-tree build scope cannot be green", () => {
    const file = path.join(cwd, "abacus.config.json");
    fs.writeFileSync(file, JSON.stringify({ ratchet: { metrics: { loc: { roots: ["src"], slack: "malformed" } } } }));
    expect(() => loadConfig(cwd)).toThrow(/finite/);
    const value = config(); value.size.budgets = [{ label: "external", dir: "../build", match: "\\.js$", max: 100 }];
    expect(() => evaluatePolicy(value, cwd)).toThrow(/within/);
  });

  test.skipIf(process.platform === "win32")("hashes supported in-tree asset symlinks without skipping measurements", () => {
    const value = config(); value.check.gates = ["size"]; value.size.budgets = [{ label: "JS", dir: "assets", match: "\\.js$", max: 1000 }];
    fs.mkdirSync(path.join(cwd, "assets")); fs.writeFileSync(path.join(cwd, "actual.js"), "export const x = 1;");
    fs.symlinkSync(path.join(cwd, "actual.js"), path.join(cwd, "assets/app.js"));
    expect(evaluatePolicy(value, cwd).checks[0]).toMatchObject({ outcome: "pass", scope: { scanned: 1 } });
  });

  test("resolved external pack inputs cannot mutate before or during evaluation", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-external-pack-"));
    try {
      const native = path.join(outside, "lint.json"), file = path.join(outside, "policy.json");
      fs.writeFileSync(native, "{}");
      const pack: PolicyPack = { schemaVersion: 1, name: "external-pack", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "lint", gate: "lint", required: true, enforcement: "block", severity: "error", rationale: "Pinned inputs", nativeConfig: "lint.json" }] };
      fs.writeFileSync(file, JSON.stringify(pack));
      const policy = resolvePolicyPack({ path: file, version: "1.0.0", digest: computePolicyPackDigest(file) }, cwd);
      const run = evaluatePolicy(config(), cwd, { policy, evaluatedAt: at, adapter: () => { fs.writeFileSync(native, '{"rules":{}}'); return cleanResult(); } });
      expect(run.clean).toBe(false);
      expect(run.checks.at(-1)).toMatchObject({ id: "policy-stability", outcome: "incomplete", blocking: true });
      let ran = false;
      const stale = evaluatePolicy(config(), cwd, { policy, evaluatedAt: at, adapter: () => { ran = true; return cleanResult(); } });
      expect(stale.clean).toBe(false); expect(ran).toBe(false);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  test("coverage-named source folders participate in the input digest", () => {
    fs.mkdirSync(path.join(cwd, "src/coverage"));
    const file = path.join(cwd, "src/coverage/index.ts"); fs.writeFileSync(file, "export const value = 1;");
    const before = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: cleanResult });
    fs.writeFileSync(file, "export const value = 2;");
    const after = evaluatePolicy(config(), cwd, { evaluatedAt: at, adapter: cleanResult });
    expect(before.source.treeDigest).not.toBe(after.source.treeDigest);
  });

  test("compiler sources outside the declared project tree are incomplete", () => {
    const external = path.join(path.dirname(cwd), `${path.basename(cwd)}-external.ts`);
    try {
      fs.writeFileSync(external, "export const value: number = 1;\n");
      fs.writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [] }, files: [external] }));
      const value = config(); value.check.gates = ["tsc"];
      const before = evaluatePolicy(value, cwd, { evaluatedAt: at });
      fs.writeFileSync(external, "export const value: number = 'wrong';\n");
      const after = evaluatePolicy(value, cwd, { evaluatedAt: at });
      expect(before.checks[0]).toMatchObject({ outcome: "incomplete", blocking: true });
      expect(after.checks[0]).toMatchObject({ outcome: "incomplete", blocking: true });
      expect(before.source.treeDigest).toBe(after.source.treeDigest);
    } finally { fs.rmSync(external, { force: true }); }
  }, 60_000);

  test("corrupt disabled ratchet entries fail aggregate and standalone validation equally", () => {
    const value = config(); value.check.gates = ["ratchet"]; value.ratchet.metrics = { loc: { roots: ["src"] } };
    const file = path.join(cwd, value.ratchet.file); const contents = JSON.stringify({ "loc src": 1, oldMetric: "corrupt" });
    fs.writeFileSync(file, contents);
    expect(reportRatchet(value, false, cwd)).toBe(false);
    expect(evaluatePolicy(value, cwd, { evaluatedAt: at }).checks[0]).toMatchObject({ outcome: "error", blocking: true });
    expect(fs.readFileSync(file, "utf8")).toBe(contents);
  });

  test("required zero-target failures cannot be green through advisory enforcement or exact waivers", () => {
    const value = config();
    const pack: PolicyPack = { schemaVersion: 1, name: "zero-target", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "compiler", gate: "tsc", required: true, enforcement: "warn", severity: "error", rationale: "Require actual compiler coverage" }] };
    const file = path.join(cwd, "policy.json"); fs.writeFileSync(file, JSON.stringify(pack));
    value.policy = { pack: { path: "policy.json", version: "1.0.0", digest: computePolicyPackDigest(file) }, exceptions: [{ id: "empty-project", ruleId: "tsc/TS18002", subject: "tsconfig.json #1", owner: "maintainers", reason: "This waiver cannot grant missing coverage", expires: "2026-11-01" }] };
    const run = evaluatePolicy(value, cwd, { evaluatedAt: at, adapter: () => ({ outcome: "fail", scope: { kind: "repository", targets: ["tsconfig.json"], scanned: 0, unit: "files" }, findings: [finding("tsc/TS18002", "tsconfig.json #1", "Empty project")] }) });
    expect(run.clean).toBe(false);
    expect(run.checks[0]).toMatchObject({ outcome: "incomplete", blocking: true });
  });

});
