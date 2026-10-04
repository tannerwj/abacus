import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaults } from "../src/config.js";
import { evaluatePolicy } from "../src/policy-runner.js";
import { runSourceAdapter } from "../src/source-adapters.js";

const at = "2026-10-04T07:00:00.000Z";
function fakeTool(cwd: string, name: string, command: string, source: string): void {
  const root = path.join(cwd, "node_modules", name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", bin: { [command]: "cli.cjs" } }));
  fs.writeFileSync(path.join(root, "cli.cjs"), source);
}

describe("native adapter contract failures", () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-adapter-")); fs.mkdirSync(path.join(cwd, "src")); fs.writeFileSync(path.join(cwd, "src/index.ts"), "export const value = 1;\n"); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  test.each(["{}", '{"diagnostics":[],"number_of_files":1}', '{"diagnostics":[],"number_of_files":0}'])("never blesses invalid/error/empty Oxlint output %s", (output) => {
    const status = output.includes('"number_of_files":1') ? 1 : 0;
    fakeTool(cwd, "oxlint", "oxlint", `process.stdout.write(${JSON.stringify(output)});process.exit(${status});`);
    const config = defaults("typescript"); config.check.gates = ["lint"];
    const run = evaluatePolicy(config, cwd, { evaluatedAt: at });
    expect(run.clean).toBe(false);
    expect(["error", "incomplete"]).toContain(run.checks[0].outcome);
  });

  test("records resolved tool metadata for a real valid adapter protocol", () => {
    fakeTool(cwd, "oxlint", "oxlint", 'console.log(JSON.stringify({diagnostics:[],number_of_files:1}));');
    const result = runSourceAdapter("lint", defaults("typescript"), cwd, at);
    expect(result).toMatchObject({ outcome: "pass", tool: { name: "oxlint", version: "1.0.0" }, scope: { scanned: 1 } });
    expect(result.tool?.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([0, 2])("rejects malformed graph JSON and unexpected tool status %s", (status) => {
    fakeTool(cwd, "dependency-cruiser", "depcruise", `console.log(JSON.stringify({}));process.exit(${status});`);
    const config = defaults("typescript"); config.check.gates = ["cycles"];
    const run = evaluatePolicy(config, cwd, { evaluatedAt: at });
    expect(run.checks[0]).toMatchObject({ outcome: "error", blocking: true });
  });

  test("rejects jscpd reports with absent statistics", () => {
    fakeTool(cwd, "jscpd", "jscpd", 'const fs=require("node:fs");const path=require("node:path");const out=process.argv[process.argv.indexOf("--output")+1];fs.writeFileSync(path.join(out,"jscpd-report.json"),JSON.stringify({duplicates:[]}));');
    const config = defaults("typescript"); config.check.gates = ["dupes"];
    const run = evaluatePolicy(config, cwd, { evaluatedAt: at });
    expect(run.checks[0]).toMatchObject({ outcome: "error", blocking: true });
  });

  test("required gitleaks scan of an empty directory is incomplete", () => {
    fs.rmSync(path.join(cwd, "src"), { recursive: true });
    const config = defaults("typescript"); config.check.gates = ["secrets"];
    const run = evaluatePolicy(config, cwd, { evaluatedAt: at });
    expect(run.clean).toBe(false);
    expect(run.checks[0]).toMatchObject({ outcome: "incomplete", scope: { scanned: 0, unit: "bytes" } });
  });
  test("malformed module entries cannot masquerade as graph coverage", () => {
    fakeTool(cwd, "dependency-cruiser", "depcruise", 'console.log(JSON.stringify({modules:[null],summary:{violations:[]}}));');
    const config = defaults("typescript"); config.check.gates = ["cycles"];
    expect(evaluatePolicy(config, cwd).checks[0]).toMatchObject({ outcome: "error", blocking: true });
  });

  test("real shared native lint config stays project-scoped and records its type-aware engine", () => {
    fs.writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", types: [] }, include: ["src/**/*.ts"] }));
    const pack = path.join(cwd, "node_modules/shared-policy/native"); fs.mkdirSync(pack, { recursive: true });
    const native = path.join(pack, "oxlint.json"); fs.writeFileSync(native, JSON.stringify({ categories: { correctness: "error" }, ignorePatterns: ["node_modules/**"] }));
    fs.mkdirSync(path.join(cwd, "node_modules/decoy")); fs.writeFileSync(path.join(cwd, "node_modules/decoy/bad.ts"), "debugger;\n");
    const result = runSourceAdapter("lint", defaults("typescript"), cwd, at, native);
    expect(result).toMatchObject({ outcome: "pass", scope: { scanned: 1, excluded: ["**/node_modules/**", "**/.git/**", "node_modules/**"] } });
    expect(result.tools).toEqual([expect.objectContaining({ name: "oxlint-tsgolint", version: "7.0.2001", digest: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  }, 60_000);

  test("shared native relative override selectors fail visibly instead of silently missing source", () => {
    const file = path.join(cwd, "shared.json");
    fs.writeFileSync(file, JSON.stringify({ overrides: [{ files: ["src/**"], rules: { "no-debugger": "error" } }] }));
    expect(() => runSourceAdapter("lint", defaults("typescript"), cwd, at, file)).toThrow(/directory-relative overrides/);
  });

});
