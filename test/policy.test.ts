import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { defaults } from "../src/config.js";
import { digest, finding, type AdapterResult, type CheckEvidence } from "../src/evidence.js";
import { applyExceptions, applyPolicyParameters, assertPolicyCompatibility, canonicalPolicyJson, computePolicyPackDigest, expiredExceptions, resolvePolicyPack, satisfiesToolVersion, validateExceptions, validatePolicyPack, type PolicyPack, type PolicyPackReference, type RepositoryException } from "../src/policy.js";

const temporary: string[] = [];
function temp(): string { const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-policy-")); temporary.push(cwd); return cwd; }
afterEach(() => { for (const cwd of temporary.splice(0)) fs.rmSync(cwd, { recursive: true, force: true }); });
const fixture = path.resolve("configs/policy-packs/advisory/policy.json");
function pack(): PolicyPack { return validatePolicyPack(JSON.parse(fs.readFileSync(fixture, "utf8"))); }
function pin(file = fixture): PolicyPackReference { return { path: file, version: pack().version, digest: computePolicyPackDigest(file) }; }
const exception: RepositoryException = { id: "known-abc-debt", ruleId: "abc/budget", subject: "src/a.ts fn", owner: "platform-team", reason: "Tracked decomposition after migration", expires: "2026-10-04" };
function failed(): AdapterResult { return { outcome: "fail", scope: { kind: "file", targets: ["src/a.ts"], scanned: 1, unit: "functions" }, findings: [finding(exception.ruleId, exception.subject, "over budget")] }; }

const propertySettings = { testCases: 2000, seed: Number(process.env.ABACUS_PBT_SEED ?? 20261007), database: hegel.Database.disabled };

describe("policy properties", () => {
  test("canonical JSON is invariant under object key permutations including hostile keys", () => hegel.test((tc) => {
    const entries = tc.draw(gs.arrays(gs.tuples(gs.text({ maxSize: 128 }), gs.integers()), { maxSize: 64 }));
    const value = Object.fromEntries(entries);
    const permuted = Object.fromEntries(Object.entries(value).reverse());
    expect(canonicalPolicyJson(value)).toBe(canonicalPolicyJson(permuted));
  }, propertySettings));

  test("canonical JSON preserves array order and every generated integer value", () => hegel.test((tc) => {
    const values = tc.draw(gs.arrays(gs.integers(), { maxSize: 128 }));
    expect(JSON.parse(canonicalPolicyJson(values))).toEqual(values);
  }, propertySettings));

  test("exact waivers cannot affect a different rule or subject", () => hegel.test((tc) => {
    const suffix = String(tc.draw(gs.integers()));
    const field = tc.draw(gs.sampledFrom(["ruleId", "subject"] as const));
    const value = failed(); value.findings[0][field] += `:${suffix}`;
    expect(applyExceptions(value, [exception], "2026-10-04T00:00:00Z").outcome).toBe("fail");
  }, propertySettings));

  test("matching waivers preserve every tool or applicability failure", () => hegel.test((tc) => {
    const outcome = tc.draw(gs.sampledFrom(["error", "incomplete", "not-applicable"] as const));
    expect(applyExceptions({ ...failed(), outcome }, [exception], "2026-10-04T00:00:00Z").outcome).toBe(outcome);
  }, propertySettings));

  test("numeric semantic version increments preserve order across arbitrary digit widths", () => hegel.test((tc) => {
    const number = tc.draw(gs.bigIntegers({ minValue: 0n }));
    expect(satisfiesToolVersion(`1.${number + 1n}.0`, `>1.${number}.0`)).toBe(true);
  }, propertySettings));

  test("invalid exact-version leading zeros are always rejected", () => hegel.test((tc) => {
    const number = tc.draw(gs.bigIntegers({ minValue: 0n }));
    expect(() => satisfiesToolVersion(`1.0${number}.0`, ">=1.0.0")).toThrow(/semantic version/);
  }, propertySettings));
});

describe("versioned policy packs", () => {
  test("resolves a pinned local pack and records every native config", () => {
    const resolved = resolvePolicyPack(pin());
    expect(resolved.pack.version).toBe("1.0.0"); expect(resolved.source).toContain("local:");
    expect(resolved.nativeConfigs).toEqual([{ checkId: "source-lint", path: path.resolve("configs/policy-packs/advisory/native/oxlint.json"), digest: expect.stringMatching(/^[a-f0-9]{64}$/u) }]);
    expect(resolved.nativeFiles).toHaveLength(2);
    expect(resolved.manifest).toEqual({ path: fs.realpathSync(fixture), digest: digest(fs.readFileSync(fixture)) });
  });
  test("native companions are in the digest closure, while JSON whitespace/key order is stable", () => {
    const cwd = temp(); fs.cpSync(path.dirname(fixture), cwd, { recursive: true }); const file = path.join(cwd, "policy.json");
    const before = computePolicyPackDigest(file); const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(raw).reverse()))); expect(computePolicyPackDigest(file)).toBe(before);
    fs.appendFileSync(path.join(cwd, "native/base.json"), "\n"); expect(computePolicyPackDigest(file)).not.toBe(before);
    expect(() => resolvePolicyPack({ path: file, version: "1.0.0", digest: before })).toThrow("digest mismatch");
  });
  test("requires exact versions and digest pins", () => {
    for (const version of ["latest", "^1.0.0", "1.0", "01.0.0", "1.0.0-01"]) expect(() => resolvePolicyPack({ ...pin(), version })).toThrow("exact semantic version");
    expect(() => resolvePolicyPack({ ...pin(), digest: "sha256-placeholder" })).toThrow("SHA-256");
    expect(() => resolvePolicyPack({ ...pin(), version: "1.1.0" })).toThrow("version does not match");
  });
  test("rejects malformed packs, unknown policy expressions and incompatible schemas", () => {
    expect(() => validatePolicyPack(JSON.parse(fs.readFileSync("configs/policy-packs/negative/unsupported-schema.json", "utf8")))).toThrow("schemaVersion");
    for (const patch of [{ gate: "made-up" }, { enforcement: "mute" }, { rationale: "" }, { required: "yes" }, { parameters: { expression: "runAnything()" } }, { parameters: { abc: { budget: -1 } } }]) {
      const candidate = pack(); Object.assign(candidate.checks[0], patch); expect(() => validatePolicyPack(candidate)).toThrow(/check\.|unsupported fields|finite number/u);
    }
    const duplicate = pack(); duplicate.checks.push(duplicate.checks[0]); expect(() => validatePolicyPack(duplicate)).toThrow("duplicate");
    for (const gate of ["package", "tsc", "abc", "ratchet", "todos", "size"] as const) { const unsupportedNative = pack(); unsupportedNative.checks[0].gate = gate; expect(() => validatePolicyPack(unsupportedNative)).toThrow("nativeConfig is unsupported"); }
    const mismatched = pack(); delete mismatched.checks[0].nativeConfig; mismatched.checks[0].parameters = { package: { modes: ["bundler"] } }; expect(() => validatePolicyPack(mismatched)).toThrow("requires the package gate");
    const incompatible = pack(); (incompatible.compatibility as { adapterVersion: number }).adapterVersion = 2; expect(() => validatePolicyPack(incompatible)).toThrow("incompatible");
  });
  test("resolves installed exact npm JSON exports without imports or network fetch", () => {
    const cwd = temp(), root = path.join(cwd, "node_modules/@example/policy"); fs.mkdirSync(root, { recursive: true }); fs.cpSync(path.dirname(fixture), root, { recursive: true });
    const manifest = path.join(root, "package.json"); fs.writeFileSync(manifest, JSON.stringify({ name: "@example/policy", version: "1.0.0", exports: { "./policy": "./policy.json" } }));
    const ref: PolicyPackReference = { package: "@example/policy", export: "./policy", version: "1.0.0", digest: computePolicyPackDigest(path.join(root, "policy.json")) };
    expect(resolvePolicyPack(ref, cwd).source).toBe("npm:@example/policy@1.0.0/policy");
    fs.writeFileSync(manifest, JSON.stringify({ name: "@example/policy", version: "1.1.0", exports: { "./policy": "./policy.json" } })); expect(() => resolvePolicyPack(ref, cwd)).toThrow("exact pin");
    fs.writeFileSync(manifest, JSON.stringify({ name: "@example/policy", version: "1.0.0", exports: { "./policy": { import: "./policy.json" } } })); expect(() => resolvePolicyPack(ref, cwd)).toThrow("directly");
    expect(() => resolvePolicyPack({ ...ref, package: "@example/policy@latest" }, cwd)).toThrow("bare npm");
  });
  test("rejects native path traversal, symlink escape, and undeclared/external references", () => {
    const cwd = temp(), candidate = pack(); fs.cpSync(path.dirname(fixture), cwd, { recursive: true });
    candidate.checks[0].nativeConfig = "../outside.json"; expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("traversal");
    candidate.checks[0].nativeConfig = "native/oxlint.json"; candidate.nativeFiles = []; expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("digest closure");
    candidate.nativeFiles = ["native/base.json"]; fs.writeFileSync(path.join(cwd, "native/oxlint.json"), '{"extends":"https://example.com/floating.json"}'); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("bundled relative");
    fs.unlinkSync(path.join(cwd, "native/oxlint.json")); fs.symlinkSync(fixture, path.join(cwd, "native/oxlint.json")); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow(/symlinks|bundled regular file/u);
  });
  test("permits static CJS native data and refuses executable config dependencies", () => {
    const cwd = temp(), candidate = pack(); candidate.nativeFiles = []; candidate.checks[0].nativeConfig = "rules.cjs";
    fs.writeFileSync(path.join(cwd, "rules.cjs"), '"use strict"; module.exports = { forbidden: [{ name: "layers", from: { path: "src/ui" }, to: { path: /src\\/data/ } }] };');
    expect(computePolicyPackDigest(candidate, cwd)).toMatch(/^[a-f0-9]{64}$/u);
    for (const code of ['module.exports = require("outside-package");', 'module.exports = { value: process.env.SECRET };', 'module.exports = { rule: () => true };', 'module.exports = { ...require("./companion.cjs") };']) {
      fs.writeFileSync(path.join(cwd, "rules.cjs"), code); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("data-only");
    }
  });
  test("parses every TOML extend.path spelling and retains built-in defaults/allowlist paths", () => {
    const cwd = temp(), candidate = pack(); candidate.nativeFiles = []; candidate.checks[0].gate = "secrets"; candidate.checks[0].nativeConfig = "gitleaks.toml";
    const file = path.join(cwd, "gitleaks.toml");
    for (const source of [
      "extend.path = '../../external.toml'",
      "extend = { path = '../../external.toml' }",
      "[extend]\n'path' = '../../external.toml'",
      "[\"extend\"]\n\"path\" = '../../external.toml'",
    ]) { fs.writeFileSync(file, source); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("external extend.path"); }
    fs.writeFileSync(file, "[extend]\nuseDefault = true\ndisabledRules = ['unused-rule']\n[[allowlists]]\npaths = ['docs/.*']\nregexes = ['redacted']");
    expect(computePolicyPackDigest(candidate, cwd)).toMatch(/^[a-f0-9]{64}$/u);
    fs.writeFileSync(file, "[[extend]]\npath = '../../external.toml'"); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("native TOML.extend must be an object");
  });
  test("rejects executable native JS plugins in JSON/CJS including object forms", () => {
    const cwd = temp(), candidate = pack(); candidate.nativeFiles = [];
    for (const extension of ["json", "cjs"]) {
      candidate.checks[0].nativeConfig = `lint.${extension}`;
      for (const plugins of [["../../external-plugin.cjs"], ["floating-npm-plugin"], { plugin: "../../external-plugin.cjs" }]) {
        const value = JSON.stringify({ jsPlugins: plugins });
        fs.writeFileSync(path.join(cwd, `lint.${extension}`), extension === "cjs" ? `module.exports = ${value};` : value);
        expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("jsPlugins are unsupported");
      }
      const value = JSON.stringify({ jsPlugins: [] }); fs.writeFileSync(path.join(cwd, `lint.${extension}`), extension === "cjs" ? `module.exports = ${value};` : value);
      expect(computePolicyPackDigest(candidate, cwd)).toMatch(/^[a-f0-9]{64}$/u);
    }
  });
  test("records the exact manifest bytes separately from canonical pack identity", () => {
    const cwd = temp(); fs.cpSync(path.dirname(fixture), cwd, { recursive: true }); const file = path.join(cwd, "policy.json");
    const ref: PolicyPackReference = { path: file, version: "1.0.0", digest: computePolicyPackDigest(file) };
    const resolved = resolvePolicyPack(ref); const captured = structuredClone(resolved.manifest);
    fs.appendFileSync(file, "\n");
    expect(computePolicyPackDigest(file)).toBe(ref.digest); expect(digest(fs.readFileSync(file))).not.toBe(captured.digest);
    expect(resolved.manifest).toEqual(captured); expect(captured.path).toBe(fs.realpathSync(file));
    expect(resolvePolicyPack(ref).manifest.digest).not.toBe(captured.digest);
  });
  test("checks static CJS config-file references against the same declared closure as JSON", () => {
    const cwd = temp(), candidate = pack(); candidate.nativeFiles = []; candidate.checks[0].nativeConfig = "rules.cjs";
    const file = path.join(cwd, "rules.cjs");
    for (const source of [
      'module.exports = { options: { tsConfig: { fileName: "../../outside-tsconfig.json" } } };',
      'module.exports = { options: { webpackConfig: { fileName: "../../outside-webpack.cjs" } } };',
      'module.exports = { nested: [{ extends: "https://example.com/floating.json" }] };',
      'module.exports = { "$ref": "https://example.com/floating.json" };',
    ]) { fs.writeFileSync(file, source); expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("declared bundled relative files"); }
    fs.writeFileSync(path.join(cwd, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
    fs.writeFileSync(path.join(cwd, "webpack.cjs"), 'module.exports = { resolve: { extensions: [".ts"] } };');
    fs.writeFileSync(file, 'module.exports = { options: { tsConfig: { fileName: "./tsconfig.json" }, webpackConfig: { fileName: "./webpack.cjs" } } };');
    expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("declared digest closure");
    candidate.nativeFiles = ["tsconfig.json", "webpack.cjs"];
    expect(() => computePolicyPackDigest(candidate, cwd)).toThrow("shared native resolution-file inputs are unsupported");
    fs.writeFileSync(file, 'module.exports = { extends: ["./tsconfig.json"], nested: { "$ref": "./tsconfig.json#/compilerOptions" } };');
    expect(computePolicyPackDigest(candidate, cwd)).toMatch(/^[a-f0-9]{64}$/u);
  });
  test("enforces explicit tool constraints and semver prerelease precedence", () => {
    assertPolicyCompatibility(pack(), { tools: { oxlint: "1.82.0" } });
    expect(() => assertPolicyCompatibility(pack(), { tools: { oxlint: "2.0.0" } })).toThrow("incompatible");
    expect(() => assertPolicyCompatibility(pack(), {})).toThrow("unreported");
    expect(resolvePolicyPack(pin(), process.cwd(), {})).toBeDefined();
    expect(() => resolvePolicyPack(pin(), process.cwd(), { tools: { oxlint: "1.79.0" } })).toThrow("incompatible");
    expect(satisfiesToolVersion("1.2.3-rc-with-hyphens.2", ">=1.2.3-rc-with-hyphens.1 <1.2.3")).toBe(true);
    expect(satisfiesToolVersion("1.2.3+build", "1.2.3")).toBe(true);
    expect(satisfiesToolVersion("1.2.3-rc.1", ">=1.2.3")).toBe(false);
    for (const constraint of ["^1.0.0", "*", "1.0.0 || 2.0.0", ">= 1.0.0"]) expect(() => satisfiesToolVersion("1.0.0", constraint)).toThrow(/semantic version|nonempty string/u);
  });
  test("restricts worker dry-run args to selectors and rejects deployment overrides", () => {
    const base = defaults("typescript");
    for (const args of [["--dry-run=false"], ["--no-dry-run"], ["--"], ["--outdir", "outside"], ["--env", "--no-dry-run"], ["--config"], ["--env=production"], ["--name", "worker", "--dry-run=false"]]) {
      const candidate = pack(); candidate.checks[1].parameters = { size: { worker: { max: 1000, wranglerArgs: args } } };
      expect(() => validatePolicyPack(candidate)).toThrow("supports only --env, --name, --config");
    }
    const args = ["--env", "production", "--name", "worker", "--config", "wrangler.toml"];
    expect(applyPolicyParameters(base, { size: { worker: { max: 1000, wranglerArgs: args } } }).size.worker?.wranglerArgs).toEqual(args);
  });
  test("merges bounded parameters without mutating config or rewriting a baseline", () => {
    const base = defaults("typescript"); base.ratchet.metrics.comments = { roots: ["src"], max: 0.3 };
    const snapshot = structuredClone(base);
    const merged = applyPolicyParameters(base, { roots: ["lib"], abc: { budget: 45 }, size: { worker: { max: 4096 } }, ratchet: { metrics: { comments: { max: 0.2 } } } });
    expect(merged.abc.budget).toBe(45); expect(merged.roots).toEqual(["lib"]); expect(merged.size.worker).toEqual({ max: 4096 });
    expect(merged.ratchet.file).toBe(base.ratchet.file); expect(merged.ratchet.metrics.comments?.roots).toEqual(["src"]); expect(base).toEqual(snapshot);
    expect(() => applyPolicyParameters(base, { package: { modes: [] } })).toThrow("nonempty");
    for (const metric of [{ loc: { max: 0 } }, { comments: { slack: 0.5 } }]) {
      const candidate = pack(); candidate.checks[1].parameters = JSON.parse(JSON.stringify({ ratchet: { metrics: metric } }));
      expect(() => validatePolicyPack(candidate)).toThrow("unsupported fields");
    }
    const bounded = applyPolicyParameters(base, { ratchet: { metrics: { loc: { slack: 0 }, comments: { max: 0.15 } } } });
    expect(bounded.ratchet.metrics.loc?.slack).toBe(0); expect(bounded.ratchet.metrics.comments?.max).toBe(0.15);
    const safe = applyPolicyParameters(base, JSON.parse('{"abc":{"allow":{"__proto__":{"max":70,"why":"Exact function name"}}}}'));
    expect(Object.getPrototypeOf(safe.abc.allow)).toBe(Object.prototype); expect(Object.hasOwn(safe.abc.allow, "__proto__")).toBe(true);
  });
});

describe("repository-owned exceptions", () => {
  test("applies an exact owned expiring waiver through the expiration date, purely", () => {
    const result = failed(), snapshot = structuredClone(result);
    const waived = applyExceptions(result, [exception], "2026-10-04T23:59:59.999Z");
    expect(waived.outcome).toBe("waived"); expect(waived.findings[0].exceptionId).toBe(exception.id); expect(result).toEqual(snapshot);
    expect(applyExceptions(result, [{ ...exception, subject: "src/a.ts other" }], "2026-10-04T00:00:00Z").outcome).toBe("fail");
    expect(applyExceptions(result, [{ ...exception, ruleId: "other" }], "2026-10-04T00:00:00Z").findings[0].exceptionId).toBeUndefined();
  });
  test("requires ownership, reason, exact targets and real dates; duplicates fail", () => {
    for (const patch of [{ owner: "" }, { reason: "" }, { expires: "2026-02-30" }, { expires: "2026-99-99" }, { expires: "tomorrow" }, { subject: "src/*" }, { ruleId: "abc/*" }, { blanket: true }]) expect(() => validateExceptions([{ ...exception, ...patch }])).toThrow(/exception\.|wildcard|unsupported fields/u);
    expect(() => validateExceptions([exception, exception])).toThrow("duplicate");
    expect(() => applyExceptions(failed(), [exception], "2026-10-04")).toThrow("ISO timestamp");
  });
  test("expired exceptions visibly fail even after their original finding disappears", () => {
    const input: AdapterResult = { ...failed(), outcome: "pass", findings: [] };
    const result = applyExceptions(input, [exception], "2026-10-05T00:00:00Z");
    expect(result.outcome).toBe("fail"); expect(result.findings[0].ruleId).toBe("policy/expired-exception");
    const negative = validateExceptions(JSON.parse(fs.readFileSync("configs/policy-packs/negative/expired-exceptions.json", "utf8")));
    expect(expiredExceptions(negative, "2026-10-05T00:00:00Z")[0].id).toBe("legacy-function");
    expect(expiredExceptions([exception], "2026-10-05T00:00:00Z")).toEqual([exception]);
    expect(applyExceptions(result, [exception], "2026-10-05T00:00:00Z").findings).toEqual(result.findings);
    expect(() => validateExceptions([{ ...exception, ruleId: "policy/expired-exception" }])).toThrow("cannot waive");
  });
  test("never waives tool errors, incomplete scans or required not-applicable outcomes", () => {
    for (const outcome of ["error", "incomplete", "not-applicable"] as const) expect(applyExceptions({ ...failed(), outcome }, [exception], "2026-10-04T12:00:00Z").outcome).toBe(outcome);
  });
  test("updates aggregate evidence counts and blocking, and removes stale waivers", () => {
    const input: CheckEvidence = { ...failed(), id: "abc", gate: "abc", required: true, enforcement: "block", blocking: true, counts: { findings: 1, waived: 0, active: 1 } };
    const waived = applyExceptions(input, [exception], "2026-10-04T00:00:00Z");
    expect(waived.counts).toEqual({ findings: 1, waived: 1, active: 0 }); expect(waived.blocking).toBe(false);
    const removed = applyExceptions(waived, [], "2026-10-04T00:00:00Z"); expect(removed.findings[0].exceptionId).toBeUndefined(); expect(removed.blocking).toBe(true);
    for (const enforcement of ["warn", "observe"] as const) for (const outcome of ["error", "incomplete", "not-applicable"] as const) {
      expect(applyExceptions({ ...input, enforcement, outcome }, [exception], "2026-10-04T00:00:00Z").blocking).toBe(true);
      expect(applyExceptions({ ...input, required: false, enforcement, outcome }, [exception], "2026-10-04T00:00:00Z").blocking).toBe(false);
    }
    const expired = applyExceptions(input, [exception], "2026-10-05T00:00:00Z"); expect(expired.counts).toEqual({ findings: 2, waived: 0, active: 2 }); expect(expired.blocking).toBe(true);
  });
});
