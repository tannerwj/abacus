import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pack, unpack } from "@publint/pack";
import { nodeToolBinPath, runNodeTool } from "../src/tool-runner.js";
import { runPackageValidation, type ConsumerMode } from "../src/package-validation.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "profiles");
const repository = path.resolve(fixtures, "..", "..", "..");
const esmModes: ConsumerMode[] = ["node16-esm", "bundler"];
function fixture(name: string): string { return path.join(fixtures, name); }
function temporary(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "abacus-package-test-")); }
function nativeStub(cwd: string, program: string): void {
  const tool = path.join(cwd, "node_modules", "@arethetypeswrong", "cli");
  fs.mkdirSync(tool, { recursive: true });
  fs.writeFileSync(path.join(tool, "package.json"), JSON.stringify({ name: "@arethetypeswrong/cli", version: "0.0.0", bin: { attw: "cli.cjs" } }));
  fs.writeFileSync(path.join(tool, "cli.cjs"), program);
  const modules = path.join(tool, "node_modules", "@arethetypeswrong");
  fs.mkdirSync(modules, { recursive: true });
  const cli = fs.realpathSync(path.join(path.dirname(fixtures), "..", "..", "node_modules", "@arethetypeswrong", "cli"));
  const core = path.resolve(cli, "..", "core");
  fs.symlinkSync(core, path.join(modules, "core"), process.platform === "win32" ? "junction" : "dir");
}

describe("packed library profile", () => {
  test("the real packed Abacus root API has Node16 ESM types and runnable exports", async () => {
    const cwd = temporary();
    const previousCache = process.env.npm_config_cache;
    const previousOffline = process.env.npm_config_offline;
    try {
      process.env.npm_config_cache = path.join(cwd, "npm-cache");
      process.env.npm_config_offline = "true";
      const tarball = await pack(repository, { packageManager: "npm", ignoreScripts: true, destination: cwd });
      const { files, rootDir } = await unpack(fs.readFileSync(tarball));
      const pkg = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8"));
      const consumer = path.join(cwd, "consumer");
      const modules = path.join(consumer, "node_modules");
      for (const file of files) {
        const target = path.join(modules, pkg.name, file.name.slice(rootDir.length + 1));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.data);
      }
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
        const installed = path.join(repository, "node_modules", name);
        if (!fs.existsSync(installed)) continue;
        const target = path.join(modules, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(fs.realpathSync(installed), target, process.platform === "win32" ? "junction" : "dir");
      }
      fs.writeFileSync(path.join(consumer, "consumer.mts"), 'import { runArchitecture, runPackageValidation, type PackageValidationOptions } from "@tjohnson/abacus"; const options: PackageValidationOptions = { modes: ["node16-esm"] }; void [runArchitecture, runPackageValidation, options];');
      const config = path.join(consumer, "tsconfig.json");
      fs.writeFileSync(config, JSON.stringify({ compilerOptions: { target: "ES2022", module: "Node16", moduleResolution: "Node16", strict: true, noEmit: true, types: [] }, files: ["consumer.mts"] }));
      expect(runNodeTool(nodeToolBinPath("typescript", "tsc", repository), ["--project", config, "--pretty", "false"], consumer).status).toBe(0);
      const runtime = path.join(consumer, "consumer.mjs");
      fs.writeFileSync(runtime, 'const pkg = await import("@tjohnson/abacus"); if (typeof pkg.runArchitecture !== "function" || typeof pkg.runPackageValidation !== "function") throw new Error("missing exports"); console.log("root loaded");');
      const execution = runNodeTool(runtime, [], consumer);
      expect(execution.status).toBe(0);
      expect(execution.stdout.trim()).toBe("root loaded");
    } finally {
      if (previousCache === undefined) delete process.env.npm_config_cache;
      else process.env.npm_config_cache = previousCache;
      if (previousOffline === undefined) delete process.env.npm_config_offline;
      else process.env.npm_config_offline = previousOffline;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  test("the full Abacus package honestly reports its wildcard asset profile gap", () => {
    const result = runPackageValidation(repository, { modes: esmModes });
    expect(result.outcome).toBe("incomplete");
    expect(result.scope.scanned).toBeGreaterThan(0);
    expect(result.findings.some((item) => item.ruleId === "package/incomplete" && item.message.includes("wildcard"))).toBe(true);
  }, 60_000);

  test("real packed ESM-only consumers pass without a CJS promise", () => {
    const result = runPackageValidation(fixture("package-esm-good"), { modes: esmModes });
    expect(result.outcome).toBe("pass");
    expect(result.scope.scanned).toBe(3);
    expect(result.metrics).toMatchObject({ entrypoints: 1, consumerChecks: 2, runtimeChecks: 1 });
    expect(result.tools?.map((tool) => tool.name)).toEqual(["publint", "@arethetypeswrong/cli", "typescript", "npm", "@publint/pack", "@arethetypeswrong/core", "attw-typescript"]);
    expect(result.tools?.every((tool) => /^\d/.test(tool.version) && /^[a-f0-9]{64}$/.test(tool.digest ?? ""))).toBe(true);
    expect(result.configs?.map((config) => config.path)).toContain("package-validation#packed-artifact");
  }, 60_000);

  test("real dual-mode artifact passes all three declared consumers", () => {
    const result = runPackageValidation(fixture("package-dual-good"), { modes: ["node16-esm", "node16-cjs", "bundler"] });
    expect(result.outcome).toBe("pass");
    expect(result.metrics).toMatchObject({ entrypoints: 1, consumerChecks: 3, runtimeChecks: 2 });
  }, 60_000);

  test.each(["package-missing-types", "package-missing-build", "package-bad-declaration"])("real broken declaration/build fixture fails: %s", (name) => {
    const result = runPackageValidation(fixture(name), { modes: esmModes });
    expect(result.outcome).toBe("fail");
    expect(result.findings.some((item) => item.ruleId.startsWith("package/publint/") || item.ruleId.startsWith("package/attw/") || item.ruleId === "package/declarations-missing")).toBe(true);
  }, 60_000);

  test("packed runtime smoke catches an import absent from the tarball", () => {
    const result = runPackageValidation(fixture("package-bad-runtime"), { modes: esmModes });
    expect(result.outcome).toBe("fail");
    expect(result.findings.map((item) => item.ruleId)).toContain("package/consumer/node16-esm/runtime");
  }, 60_000);

  test("a declared CJS promise fails for an import-only package", () => {
    const result = runPackageValidation(fixture("package-esm-good"), { modes: ["node16-cjs"] });
    expect(result.outcome).toBe("fail");
    expect(result.findings.some((item) => item.ruleId.startsWith("package/attw/") || item.ruleId.startsWith("package/consumer/node16-cjs/"))).toBe(true);
  }, 60_000);

  test("consumer evidence covers every exact exported subpath", () => {
    const cwd = temporary();
    try {
      fs.cpSync(fixture("package-esm-good"), cwd, { recursive: true });
      const manifest = path.join(cwd, "package.json");
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      pkg.exports["./extra"] = pkg.exports["."];
      fs.writeFileSync(manifest, JSON.stringify(pkg));
      const result = runPackageValidation(cwd, { modes: esmModes });
      expect(result.outcome).toBe("pass");
      expect(result.metrics?.entrypoints).toBe(2);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 60_000);

  test("a runtime process exit cannot be reported as a completed consumer", () => {
    const cwd = temporary();
    try {
      fs.cpSync(fixture("package-esm-good"), cwd, { recursive: true });
      fs.writeFileSync(path.join(cwd, "dist", "index.js"), "process.exit(0);");
      expect(runPackageValidation(cwd, { modes: ["node16-esm"] }).outcome).toBe("incomplete");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 60_000);

  test("missing input, missing support contract, and malformed manifest never pass", () => {
    const cwd = temporary();
    try {
      expect(runPackageValidation(cwd, { modes: esmModes }).outcome).toBe("incomplete");
      expect(runPackageValidation(fixture("package-esm-good")).outcome).toBe("incomplete");
      expect(runPackageValidation(fixture("package-esm-good"), { modes: [] }).outcome).toBe("incomplete");
      fs.writeFileSync(path.join(cwd, "package.json"), "invalid");
      expect(runPackageValidation(cwd, { modes: esmModes }).outcome).toBe("error");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  test("pack lifecycle scripts are disabled and native local ignores cannot hide promised CJS", () => {
    const cwd = temporary();
    try {
      fs.cpSync(fixture("package-esm-good"), cwd, { recursive: true });
      const manifest = path.join(cwd, "package.json");
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      pkg.scripts = { prepare: "node -e \"require('fs').writeFileSync('lifecycle-ran','yes')\"" };
      fs.writeFileSync(manifest, JSON.stringify(pkg));
      fs.writeFileSync(path.join(cwd, ".attw.json"), JSON.stringify({ ignoreRules: ["no-resolution", "cjs-resolves-to-esm"] }));
      expect(runPackageValidation(cwd, { modes: ["node16-cjs"] }).outcome).toBe("fail");
      expect(fs.existsSync(path.join(cwd, "lifecycle-ran"))).toBe(false);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 60_000);

  test.each(["process.stdout.write('malformed');", "process.stdout.write('{}');", "process.stderr.write('private-native-output'); process.exit(3);"])("native failures never pass or leak raw output: %s", (program) => {
    const cwd = temporary();
    try {
      fs.cpSync(fixture("package-esm-good"), cwd, { recursive: true });
      nativeStub(cwd, program);
      const result = runPackageValidation(cwd, { modes: esmModes });
      expect(result.outcome).toBe("error");
      expect(JSON.stringify(result)).not.toContain("private-native-output");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }, 60_000);
});
