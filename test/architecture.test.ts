import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArchitecture } from "../src/architecture.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "profiles");
const options = { targets: ["src", "test"] };
function temporary(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "abacus-architecture-")); }
function nativeStub(cwd: string, program: string): void {
  const tool = path.join(cwd, "node_modules", "dependency-cruiser");
  fs.mkdirSync(tool, { recursive: true });
  fs.writeFileSync(path.join(tool, "package.json"), JSON.stringify({ name: "dependency-cruiser", version: "0.0.0", bin: { depcruise: "cli.cjs" } }));
  fs.writeFileSync(path.join(tool, "cli.cjs"), program);
}

describe("architecture profile", () => {
  test("real full graph passes explicit domain, server/browser, public-entry and test rules", () => {
    const result = runArchitecture(path.join(fixtures, "architecture-good"), options);
    expect(result.outcome).toBe("pass");
    expect(result.scope.scanned).toBe(9);
    expect(result.metrics?.dependencies).toBe(6);
    expect(result.tool).toMatchObject({ name: "dependency-cruiser", version: expect.stringMatching(/^\d/) });
    expect(result.tool?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.configs).toHaveLength(3);
    expect(result.configs?.every((config) => /^[a-f0-9]{64}$/.test(config.digest))).toBe(true);
  }, 30_000);

  test("reports every native forbidden boundary, not only cycles", () => {
    const result = runArchitecture(path.join(fixtures, "architecture-bad"), options);
    expect(result.outcome).toBe("fail");
    expect(result.scope.scanned).toBe(9);
    expect(result.findings.map((item) => item.ruleId).sort()).toEqual([
      "architecture/browser-no-server", "architecture/domain-no-infrastructure",
      "architecture/production-no-tests", "architecture/public-entry-only",
    ]);
    expect(result.findings.every((item) => item.subject.includes(" -> "))).toBe(true);
  }, 30_000);

  test("does not substitute a bundled cycle config for missing architecture", () => {
    const cwd = temporary();
    try {
      fs.mkdirSync(path.join(cwd, "src"));
      fs.writeFileSync(path.join(cwd, "src", "index.ts"), "export const value = 1;");
      expect(runArchitecture(cwd).outcome).toBe("incomplete");
      expect(runArchitecture(cwd, { targets: [] }).outcome).toBe("incomplete");
      expect(runArchitecture(cwd, { targets: ["missing"] }).outcome).toBe("incomplete");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  test("architecture roots and native resolution configs cannot escape the input tree", () => {
    const cwd = temporary();
    const sibling = temporary();
    try {
      fs.writeFileSync(path.join(cwd, ".dependency-cruiser.cjs"), "module.exports={forbidden:[{name:'no-cycle',severity:'error',from:{},to:{circular:true}}]};");
      fs.writeFileSync(path.join(sibling, "index.ts"), "export const value=1;");
      expect(runArchitecture(cwd, { targets: [sibling] }).outcome).toBe("incomplete");
      fs.symlinkSync(sibling, path.join(cwd, "linked-source"), process.platform === "win32" ? "junction" : "dir");
      expect(runArchitecture(cwd, { targets: ["linked-source"] }).outcome).toBe("incomplete");
      fs.mkdirSync(path.join(cwd, "src"));
      fs.writeFileSync(path.join(cwd, "src", "index.ts"), "export const value=1;");
      fs.writeFileSync(path.join(sibling, "tsconfig.json"), '{"compilerOptions":{"moduleResolution":"Bundler"}}');
      fs.writeFileSync(path.join(cwd, ".dependency-cruiser.cjs"), `module.exports={forbidden:[{name:'no-cycle',severity:'error',from:{},to:{circular:true}}],options:{tsConfig:{fileName:${JSON.stringify(path.join(sibling, "tsconfig.json"))}}}};`);
      expect(runArchitecture(cwd, { targets: ["src"] }).outcome).toBe("incomplete");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  }, 30_000);

  test("explicit config works; zero modules and empty native rules never pass", () => {
    const cwd = temporary();
    try {
      fs.mkdirSync(path.join(cwd, "src"));
      fs.writeFileSync(path.join(cwd, "policy.cjs"), "module.exports={forbidden:[{name:'no-cycle',severity:'error',from:{},to:{circular:true}}]};");
      expect(runArchitecture(cwd, { configPath: "policy.cjs", targets: ["src"] }).outcome).toBe("incomplete");
      fs.writeFileSync(path.join(cwd, "src", "index.js"), "exports.value=1;");
      fs.writeFileSync(path.join(cwd, "policy.cjs"), "module.exports={forbidden:[]};");
      expect(runArchitecture(cwd, { configPath: "policy.cjs", targets: ["src"] }).outcome).toBe("incomplete");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 30_000);

  test("unresolved graph imports make coverage incomplete", () => {
    const cwd = temporary();
    try {
      fs.cpSync(path.join(fixtures, "architecture-good"), path.join(cwd, "project"), { recursive: true });
      fs.copyFileSync(path.join(fixtures, "architecture-config.cjs"), path.join(cwd, "architecture-config.cjs"));
      fs.writeFileSync(path.join(cwd, "project", "src", "browser", "view.ts"), 'import "./missing.js";');
      expect(runArchitecture(path.join(cwd, "project"), options).outcome).toBe("incomplete");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 30_000);

  test("effective config digest captures imported native rule changes", () => {
    const cwd = temporary();
    try {
      const project = path.join(cwd, "project");
      fs.cpSync(path.join(fixtures, "architecture-good"), project, { recursive: true });
      const imported = path.join(cwd, "architecture-config.cjs");
      fs.copyFileSync(path.join(fixtures, "architecture-config.cjs"), imported);
      const before = runArchitecture(project, options);
      fs.writeFileSync(imported, fs.readFileSync(imported, "utf8").replace("domain-no-infrastructure", "domain-layer-boundary"));
      const after = runArchitecture(project, options);
      expect(before.configs?.[0].digest).toBe(after.configs?.[0].digest);
      expect(before.configs?.[1].digest).not.toBe(after.configs?.[1].digest);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 30_000);

  test.each([
    { advisedExitCode: 1, outcome: "error" },
    { advisedExitCode: 0, environment: { issues: [{ name: "missing-typescript-transpiler" }] }, outcome: "incomplete" },
    { advisedExitCode: 0, optionsUsed: { focus: "src/index.ts" }, outcome: "incomplete" },
  ])("native count, environment, or partial-view problems never pass: $outcome", (entry) => {
    const cwd = temporary();
    try {
      fs.copyFileSync(path.join(fixtures, "architecture-config.cjs"), path.join(cwd, ".dependency-cruiser.cjs"));
      const report = { modules: [{ source: "index.ts", dependencies: [] }], summary: {
        violations: [], ruleSetUsed: { forbidden: [{ name: "native-rule", severity: "error" }] }, optionsUsed: entry.optionsUsed ?? {},
        totalCruised: 1, totalDependenciesCruised: 0, advisedExitCode: entry.advisedExitCode, environment: entry.environment,
      } };
      nativeStub(cwd, `process.stdout.write(${JSON.stringify(JSON.stringify(report))});`);
      expect(runArchitecture(cwd).outcome).toBe(entry.outcome);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  test.each(["process.stdout.write('not-json');", "process.stdout.write('{}');", "process.exit(2);"])("tool failure never passes: %s", (program) => {
    const cwd = temporary();
    try {
      fs.copyFileSync(path.join(fixtures, "architecture-config.cjs"), path.join(cwd, ".dependency-cruiser.cjs"));
      nativeStub(cwd, program);
      expect(runArchitecture(cwd).outcome).toBe("error");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});
