import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaults, loadConfig, validateAbacusConfig, validateProjectInputs, validateTscProjects } from "../src/config.js";
import { finding, validateAdapterResult } from "../src/evidence.js";
import { evaluatePolicy } from "../src/policy-runner.js";
import { applyPolicyParameters, computePolicyPackDigest, validatePolicyParameters, type PolicyPack } from "../src/policy.js";
import { typescriptEvidence } from "../src/typescript-profile.js";
import { comparePolicyRuns } from "../src/preview.js";

const at = "2026-10-04T08:00:00.000Z";
const options = { strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", types: [], lib: ["ES2022"] };
function writeJson(cwd: string, file: string, value: unknown): void { fs.writeFileSync(path.join(cwd, file), JSON.stringify(value)); }
function config(projects = ["tsconfig.json"]) { const value = defaults("typescript"); value.check.gates = ["tsc"]; value.tsc.projects = projects; return value; }
function populated(cwd: string, project: string, file: string, source = "export const value: number = 1;\n"): void {
  fs.writeFileSync(path.join(cwd, file), source);
  writeJson(cwd, project, { compilerOptions: options, files: [file] });
}

describe("bounded compiler project selection", () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-ts-profile-")); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  test("loads defaults and explicit local configs without mutating native inputs", () => {
    expect(defaults("typescript").tsc.projects).toEqual(["tsconfig.json"]);
    writeJson(cwd, "abacus.config.json", { tsc: { projects: ["./tsconfig.worker.json", "configs/tsconfig.app.json"] } });
    expect(loadConfig(cwd).tsc.projects).toEqual(["tsconfig.worker.json", "configs/tsconfig.app.json"]);
    expect(validateTscProjects(["configs/tsconfig.json"])).toEqual(["configs/tsconfig.json"]);
    const base = defaults("typescript"), before = structuredClone(base);
    expect(applyPolicyParameters(base, { tsc: { projects: ["tsconfig.app.json"] } }).tsc.projects).toEqual(["tsconfig.app.json"]);
    expect(base).toEqual(before);
  });

  test.each([[], [""], ["tsconfig.json", "./tsconfig.json"], ["../outside.json"], ["nested/../tsconfig.json"], ["/tmp/tsconfig.json"], ["C:\\tsconfig.json"], ["C:tsconfig.json"], ["https://example.com/tsconfig.json"], ["--build"], ["tsconfig.js"], "tsconfig.json", null])("rejects invalid project selector %j in repository and policy configs", (projects) => {
    writeJson(cwd, "abacus.config.json", { tsc: { projects } });
    expect(() => loadConfig(cwd)).toThrow(/tsc.projects/);
    expect(() => validatePolicyParameters({ tsc: { projects } })).toThrow(/projects/);
  });

  test("rejects compiler execution knobs and empty/nonobject config sections", () => {
    for (const tsc of [null, [], "root", { projects: ["tsconfig.json"], build: true }]) {
      writeJson(cwd, "abacus.config.json", { tsc });
      expect(() => loadConfig(cwd)).toThrow(/tsc/);
      expect(() => validatePolicyParameters({ tsc })).toThrow(/object|unsupported/);
    }
    const value = config(); value.tsc.projects = ["../external.json"];
    expect(() => validateAbacusConfig(value)).toThrow(/within/);
    expect(() => validateProjectInputs(value, cwd)).toThrow(/within/);
  });

  test("checks platform-separated projects and counts shared sources under each config", () => {
    fs.writeFileSync(path.join(cwd, "worker.ts"), 'declare const platform: "worker"; export const target = platform;\n');
    fs.writeFileSync(path.join(cwd, "app.ts"), "export const target = document.title;\n");
    fs.writeFileSync(path.join(cwd, "shared.ts"), "export interface Shared { value: number }\n");
    writeJson(cwd, "tsconfig.base.json", { compilerOptions: options });
    writeJson(cwd, "tsconfig.worker.json", { extends: "./tsconfig.base.json", files: ["worker.ts", "shared.ts"] });
    writeJson(cwd, "tsconfig.app.json", { extends: "./tsconfig.base.json", compilerOptions: { lib: ["ES2022", "DOM"] }, files: ["app.ts", "shared.ts"] });
    writeJson(cwd, "tsconfig.json", { files: [], references: [{ path: "./tsconfig.worker.json" }, { path: "./tsconfig.app.json" }] });
    const result = typescriptEvidence(config(["tsconfig.worker.json", "tsconfig.app.json"]), cwd);
    expect(result).toMatchObject({ outcome: "pass", scope: { scanned: 4, unit: "project-files" }, metrics: { projects: 2, sourceChecks: 4, uniqueFiles: 3 } });
    expect(result.projects?.map((item) => item.scope.scanned)).toEqual([2, 2]);
    expect(result.projects?.map((item) => item.outcome)).toEqual(["pass", "pass"]);
    expect(result.configs?.map((item) => item.path)).toEqual(expect.arrayContaining(["tsconfig.base.json", "tsconfig.worker.json", "tsconfig.app.json"]));
    expect(result.tools?.map((item) => item.name)).toContain("typescript/config-reader");
    validateAdapterResult(result);
    expect(typescriptEvidence(config(), cwd)).toMatchObject({ outcome: "incomplete", scope: { scanned: 0 } });
  }, 60_000);

  test("preserves a later compiler failure and emits safe project-specific diagnostics", () => {
    populated(cwd, "tsconfig.worker.json", "worker.ts");
    populated(cwd, "tsconfig.app.json", "app.ts", 'export const value: number = "diagnostic-payload-must-stay-private";\n');
    const result = typescriptEvidence(config(["tsconfig.worker.json", "tsconfig.app.json"]), cwd);
    expect(result.projects?.map((item) => item.outcome)).toEqual(["pass", "fail"]);
    expect(result.outcome).toBe("fail");
    expect(result.findings[0]).toMatchObject({ ruleId: "tsc/TS2322", project: "tsconfig.app.json", subject: "tsconfig.app.json: app.ts #1", message: "TypeScript TS2322 at app.ts:1:14" });
    expect(result.projects?.[1].diagnostics[0]).toMatchObject({ code: "TS2322", location: { path: "app.ts", line: 1, column: 14 } });
    expect(JSON.stringify(result)).not.toContain("diagnostic-payload");
    validateAdapterResult(result);
  }, 60_000);

  test("findings distinguish the same error checked by two compiler projects", () => {
    populated(cwd, "tsconfig.first.json", "shared.ts", 'export const value: number = "wrong";\n');
    writeJson(cwd, "tsconfig.second.json", { compilerOptions: options, files: ["shared.ts"] });
    const result = typescriptEvidence(config(["tsconfig.first.json", "tsconfig.second.json"]), cwd);
    expect(result.findings).toHaveLength(2);
    expect(new Set(result.findings.map((item) => item.fingerprint)).size).toBe(2);
    expect(result.scope.scanned).toBe(2);
    expect(result.metrics?.uniqueFiles).toBe(1);
  }, 60_000);

  test("preserves default single-project finding fingerprints", () => {
    populated(cwd, "tsconfig.json", "index.ts", 'export const value: number = "wrong";\n');
    const result = typescriptEvidence(config(), cwd);
    expect(result.findings[0].subject).toBe("index.ts #1");
    expect(result.findings[0].fingerprint).toBe(finding("tsc/TS2322", "index.ts #1", "TypeScript TS2322").fingerprint);
  }, 60_000);

  test.each(["missing", "empty", "empty-include"])("a %s project cannot be hidden by populated projects", (kind) => {
    populated(cwd, "tsconfig.first.json", "first.ts");
    populated(cwd, "tsconfig.last.json", "last.ts");
    if (kind === "empty") writeJson(cwd, "tsconfig.bad.json", { compilerOptions: options, files: [] });
    if (kind === "empty-include") writeJson(cwd, "tsconfig.bad.json", { compilerOptions: options, include: ["absent/**/*.ts"] });
    const result = typescriptEvidence(config(["tsconfig.first.json", "tsconfig.bad.json", "tsconfig.last.json"]), cwd);
    expect(result.projects?.map((item) => item.outcome)).toEqual(["pass", "incomplete", "pass"]);
    expect(result.outcome).toBe("incomplete");
    expect(result.scope.scanned).toBe(2);
    expect(result.projects?.[1].inputDigest).toBeUndefined();
  }, 60_000);

  test("required missing project remains blocking under observe enforcement", () => {
    populated(cwd, "tsconfig.first.json", "first.ts");
    const value = config(["tsconfig.first.json", "missing.json"]);
    const pack: PolicyPack = { schemaVersion: 1, name: "compiler-observe", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "compiler", gate: "tsc", required: true, enforcement: "observe", severity: "warning", rationale: "Require complete platform coverage" }] };
    writeJson(cwd, "policy.json", pack);
    value.policy = { pack: { path: "policy.json", version: "1.0.0", digest: computePolicyPackDigest(path.join(cwd, "policy.json")) } };
    const result = evaluatePolicy(value, cwd, { evaluatedAt: at, adapter: (_check, selected) => typescriptEvidence(selected, cwd) });
    expect(result.clean).toBe(false);
    expect(result.checks[0]).toMatchObject({ outcome: "incomplete", blocking: true, enforcement: "observe" });
    expect(result.checks[0].projects?.map((item) => item.outcome)).toEqual(["pass", "incomplete"]);
  }, 60_000);

  test.each(["extends", "source", "import", "config-symlink"])("external %s closure inputs stay incomplete", (kind) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-ts-profile-outside-"));
    try {
      populated(cwd, "tsconfig.first.json", "first.ts");
      populated(cwd, "tsconfig.bad.json", "bad.ts");
      fs.writeFileSync(path.join(outside, "external.ts"), "export const external = 1;\n");
      writeJson(outside, "outside.json", { compilerOptions: options, files: ["external.ts"] });
      if (kind === "extends") writeJson(cwd, "tsconfig.bad.json", { extends: path.join(outside, "outside.json"), files: ["bad.ts"] });
      if (kind === "source") writeJson(cwd, "tsconfig.bad.json", { compilerOptions: options, files: [path.join(outside, "external.ts")] });
      if (kind === "import") fs.writeFileSync(path.join(cwd, "bad.ts"), `export { external } from ${JSON.stringify(path.join(outside, "external"))};\n`);
      if (kind === "config-symlink") { fs.rmSync(path.join(cwd, "tsconfig.bad.json")); fs.symlinkSync(path.join(outside, "outside.json"), path.join(cwd, "tsconfig.bad.json")); }
      const result = typescriptEvidence(config(["tsconfig.first.json", "tsconfig.bad.json"]), cwd);
      expect(result.projects?.map((item) => item.outcome)).toEqual(["pass", "incomplete"]);
      expect(result.outcome).toBe("incomplete");
      expect(JSON.stringify(result)).not.toContain(outside);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  }, 60_000);

  test("every project runs after compiler execution errors and stderr stays private", () => {
    for (const name of ["first", "bad", "last"]) populated(cwd, `tsconfig.${name}.json`, `${name}.ts`);
    const tool = path.join(cwd, "node_modules/typescript"); fs.mkdirSync(tool, { recursive: true });
    writeJson(tool, "package.json", { name: "typescript", version: "1.0.0", bin: { tsc: "cli.cjs" } });
    fs.writeFileSync(path.join(tool, "cli.cjs"), 'const fs=require("node:fs");const path=require("node:path");const config=process.argv[process.argv.indexOf("--project")+1];fs.appendFileSync(path.join(process.cwd(),"calls.txt"),path.basename(config)+"\\n");if(config.endsWith("bad.json")){console.error("private-stderr-payload");process.exit(2)}console.log(path.join(process.cwd(),path.basename(config).replace("tsconfig.", "").replace(".json", ".ts")));');
    const result = typescriptEvidence(config(["tsconfig.first.json", "tsconfig.bad.json", "tsconfig.last.json"]), cwd);
    expect(result.projects?.map((item) => item.outcome)).toEqual(["pass", "error", "pass"]);
    expect(result.outcome).toBe("error");
    expect(fs.readFileSync(path.join(cwd, "calls.txt"), "utf8")).toBe("tsconfig.first.json\ntsconfig.bad.json\ntsconfig.last.json\n");
    expect(JSON.stringify(result)).not.toContain("private-stderr");
    expect(result.tool).toMatchObject({ name: "typescript", version: "1.0.0" });
    expect(result.tools?.[0].version).not.toBe("1.0.0");
  });

  test("input fingerprints bind actual imported sources and inherited config bytes", () => {
    fs.writeFileSync(path.join(cwd, "imported.ts"), "export const value = 1;\n");
    populated(cwd, "tsconfig.json", "index.ts", 'export { value } from "./imported";\n');
    writeJson(cwd, "base.json", { compilerOptions: options });
    writeJson(cwd, "tsconfig.json", { extends: "./base.json", files: ["index.ts"] });
    const first = typescriptEvidence(config(), cwd);
    expect(first.projects?.[0].sources.map((item) => item.path)).toEqual(["imported.ts", "index.ts"]);
    fs.writeFileSync(path.join(cwd, "imported.ts"), "export const value = 2;\n");
    const second = typescriptEvidence(config(), cwd);
    expect(second.projects?.[0].inputDigest).not.toBe(first.projects?.[0].inputDigest);
    writeJson(cwd, "base.json", { compilerOptions: { ...options, noUncheckedIndexedAccess: true } });
    expect(typescriptEvidence(config(), cwd).projects?.[0].inputDigest).not.toBe(second.projects?.[0].inputDigest);
  }, 60_000);

  test("fingerprints include actual installed declarations without counting them as project sources", () => {
    const dependency = path.join(cwd, "node_modules/typed"); fs.mkdirSync(dependency, { recursive: true });
    writeJson(dependency, "package.json", { name: "typed", version: "1.0.0", types: "index.d.ts" });
    fs.writeFileSync(path.join(dependency, "index.d.ts"), "export interface Thing { value: number }\n");
    populated(cwd, "tsconfig.json", "index.ts", 'import type { Thing } from "typed"; export const value: Thing = { value: 1 };\n');
    writeJson(cwd, "tsconfig.json", { compilerOptions: { ...options, module: "NodeNext", moduleResolution: "NodeNext" }, files: ["index.ts"] });
    const first = typescriptEvidence(config(), cwd);
    expect(first).toMatchObject({ outcome: "pass", scope: { scanned: 1 } });
    expect(first.projects?.[0].dependencies.map((item) => item.path)).toContain("installed:node_modules/typed/index.d.ts");
    expect(first.projects?.[0].dependencies.map((item) => item.path)).toContain("installed:node_modules/typed/package.json");
    expect(JSON.stringify(first)).not.toContain(cwd);
    fs.writeFileSync(path.join(dependency, "index.d.ts"), "export interface Thing { value: number; extra?: string }\n");
    const second = typescriptEvidence(config(), cwd);
    expect(second.outcome).toBe("pass");
    expect(second.projects?.[0].inputDigest).not.toBe(first.projects?.[0].inputDigest);
  }, 60_000);

  test("changed installed resolution entrypoints cannot masquerade as policy findings", () => {
    const dependency = path.join(cwd, "node_modules/typed"); fs.mkdirSync(dependency, { recursive: true });
    const manifest = { name: "typed", version: "1.0.0", types: "a.d.ts" };
    writeJson(dependency, "package.json", manifest);
    fs.writeFileSync(path.join(dependency, "a.d.ts"), "export interface Thing { value: number }\n");
    fs.writeFileSync(path.join(dependency, "b.d.ts"), "export interface Thing { value: string }\n");
    populated(cwd, "tsconfig.json", "index.ts", 'import type { Thing } from "typed"; export const value: Thing = { value: 1 };\n');
    writeJson(cwd, "tsconfig.json", { compilerOptions: { ...options, module: "NodeNext", moduleResolution: "NodeNext" }, files: ["index.ts"] });
    const first = evaluatePolicy(config(), cwd, { evaluatedAt: at });
    expect(first.checks[0].outcome).toBe("pass");
    writeJson(dependency, "package.json", { ...manifest, types: "./a.d.ts" });
    const sameEntry = evaluatePolicy(config(), cwd, { evaluatedAt: at });
    expect(sameEntry.checks[0].outcome).toBe("pass");
    expect(sameEntry.checks[0].projects?.[0].sources).toEqual(first.checks[0].projects?.[0].sources);
    expect(sameEntry.checks[0].projects?.[0].inputDigest).not.toBe(first.checks[0].projects?.[0].inputDigest);
    expect(() => comparePolicyRuns(first, sameEntry)).toThrow(/same bytes for shared compiler inputs/);
    writeJson(dependency, "package.json", { ...manifest, types: "b.d.ts" });
    const second = evaluatePolicy(config(), cwd, { evaluatedAt: at });
    expect(second.checks[0].outcome).toBe("fail");
    expect(second.source.treeDigest).toBe(first.source.treeDigest);
    expect(second.configDigest).toBe(first.configDigest);
    expect(second.checks[0].projects?.[0].inputDigest).not.toBe(first.checks[0].projects?.[0].inputDigest);
    expect(() => comparePolicyRuns(first, second)).toThrow(/same bytes for shared compiler inputs|same complete input closure/);
  }, 60_000);

  test("unverified diagnostic filenames never cross the evidence boundary", () => {
    populated(cwd, "tsconfig.json", "index.ts");
    const tool = path.join(cwd, "node_modules/typescript"); fs.mkdirSync(tool, { recursive: true });
    writeJson(tool, "package.json", { name: "typescript", version: "1.0.0", bin: { tsc: "cli.cjs" } });
    fs.writeFileSync(path.join(tool, "cli.cjs"), 'console.log(require("node:path").join(process.cwd(),"index.ts"));console.error("unverified-private-path(1,1): error TS2322: private diagnostic text");process.exit(1);');
    const result = typescriptEvidence(config(), cwd);
    expect(result.outcome).toBe("fail");
    expect(result.projects?.[0].diagnostics).toEqual([{ code: "TS2322" }]);
    expect(JSON.stringify(result)).not.toContain("unverified-private-path");
    expect(JSON.stringify(result)).not.toContain("private diagnostic text");
  });

  test.each(["incremental", "composite"])("%s projects do not write or alter repository caches", (mode) => {
    populated(cwd, "tsconfig.json", "index.ts");
    writeJson(cwd, "tsconfig.json", { compilerOptions: { ...options, [mode]: true, tsBuildInfoFile: "existing.tsbuildinfo" }, files: ["index.ts"] });
    fs.writeFileSync(path.join(cwd, "existing.tsbuildinfo"), "preserved-cache");
    const before = fs.readdirSync(cwd).sort().map((file) => [file, fs.readFileSync(path.join(cwd, file), "utf8")]);
    expect(typescriptEvidence(config(), cwd).outcome).toBe("pass");
    expect(fs.readdirSync(cwd).sort().map((file) => [file, fs.readFileSync(path.join(cwd, file), "utf8")])).toEqual(before);
  }, 60_000);

  test("contradictory aggregate pass cannot hide an incomplete project", () => {
    const result = { outcome: "pass" as const, scope: { kind: "repository" as const, targets: ["missing.json"], scanned: 0, unit: "project-files" }, findings: [], projects: [{ project: "missing.json", outcome: "incomplete" as const, scope: { kind: "repository" as const, targets: ["missing.json"], scanned: 0, unit: "files" }, diagnostics: [], configs: [], sources: [], dependencies: [] }] };
    expect(() => validateAdapterResult(result)).toThrow(/despite/);
  });
});
