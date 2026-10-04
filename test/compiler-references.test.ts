import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inspectCompilerInputs } from "../src/compiler-inputs.js";
import { defaults } from "../src/config.js";
import { typescriptEvidence } from "../src/typescript-profile.js";
import { runTsc } from "../src/tsc.js";

const options = { strict: true, types: [], skipLibCheck: true };
function writeJson(cwd: string, file: string, value: unknown): void {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
}
function source(cwd: string, file = "index.ts", content = "export const value = 1;\n"): void {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function root(cwd: string, references: unknown, project = "tsconfig.json"): void {
  source(cwd);
  writeJson(cwd, project, { compilerOptions: options, files: ["index.ts"], references });
}
function compilerSentinel(cwd: string): string {
  const marker = path.join(cwd, "compiler-ran.txt");
  writeJson(cwd, "node_modules/typescript/package.json", { name: "typescript", version: "5.9.3", bin: { tsc: "cli.cjs" } });
  fs.writeFileSync(path.join(cwd, "node_modules/typescript/cli.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");console.log(${JSON.stringify(path.join(cwd, "index.ts"))});`);
  return marker;
}
function expectIncompleteBeforeCompiler(cwd: string) {
  const marker = compilerSentinel(cwd);
  const result = runTsc(cwd);
  expect(result).toMatchObject({ clean: false, files: 0, errors: [], sources: [], dependencies: [], incompleteReason: expect.any(String) });
  expect(fs.existsSync(marker)).toBe(false);
  return result;
}
function snapshot(cwd: string): Array<[string, string]> {
  return fs.readdirSync(cwd, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry): [string, string] => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(cwd, file), fs.readFileSync(file, "utf8")];
    }).sort(([a], [b]) => a.localeCompare(b));
}

describe("compiler project reference config closure", () => {
  let directory: string;
  let cwd: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-ts-references-"));
    cwd = path.join(directory, "project");
    fs.mkdirSync(cwd);
  });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  test("the sibling composite-option repro stays incomplete before compiler execution", () => {
    const other = path.join(directory, "other");
    source(other);
    root(cwd, [{ path: "../other" }]);
    for (const composite of [true, false]) {
      writeJson(other, "tsconfig.json", { compilerOptions: { ...options, composite }, files: ["index.ts"] });
      expectIncompleteBeforeCompiler(cwd);
      expect(inspectCompilerInputs(cwd).configs.map((entry) => entry.path)).toEqual([path.join(cwd, "tsconfig.json")]);
    }
  });

  test.each(["config", "directory"])("a reference %s symlink cannot escape the repository", (kind) => {
    const other = path.join(directory, "other");
    source(other);
    writeJson(other, "tsconfig.json", { compilerOptions: { ...options, composite: true }, files: ["index.ts"] });
    if (kind === "config") fs.symlinkSync(path.join(other, "tsconfig.json"), path.join(cwd, "linked.json"));
    else fs.symlinkSync(other, path.join(cwd, "linked"));
    root(cwd, [{ path: kind === "config" ? "./linked.json" : "./linked" }]);
    expect(expectIncompleteBeforeCompiler(cwd).incompleteReason).toMatch(/leave the evaluated project tree/);
  });

  test("fingerprints recursive local references and extends without checking or building their sources", () => {
    root(cwd, [{ path: "./other" }, { path: "./leaf/custom.json" }]);
    writeJson(cwd, "base.json", { compilerOptions: { ...options, strict: false, composite: true } });
    writeJson(cwd, "other/tsconfig.json", { extends: "../base.json", files: ["index.ts"], references: [{ path: "../leaf/custom.json" }] });
    writeJson(cwd, "leaf/custom.json", { extends: "../base.json", files: ["index.ts"] });
    source(cwd, "other/index.ts", 'export const value: number = "not-selected";\n');
    source(cwd, "leaf/index.ts");
    const before = snapshot(cwd);
    const config = defaults("typescript");
    const first = typescriptEvidence(config, cwd);
    expect(first).toMatchObject({ outcome: "pass", scope: { scanned: 1 } });
    expect(first.projects?.[0].sources.map((entry) => entry.path)).toEqual(["index.ts"]);
    expect(first.projects?.[0].configs.map((entry) => entry.path)).toEqual(["base.json", "leaf/custom.json", "other/tsconfig.json", "tsconfig.json"]);
    expect(inspectCompilerInputs(cwd).options.strict).toBe(true);
    expect(snapshot(cwd)).toEqual(before);

    writeJson(cwd, "base.json", { compilerOptions: { ...options, strict: false, composite: true, noUncheckedIndexedAccess: true } });
    const inherited = typescriptEvidence(config, cwd);
    expect(inherited.outcome).toBe("pass");
    expect(inherited.projects?.[0].inputDigest).not.toBe(first.projects?.[0].inputDigest);

    writeJson(cwd, "other/tsconfig.json", { extends: "../base.json", compilerOptions: { composite: false }, files: ["index.ts"], references: [{ path: "../leaf/custom.json" }] });
    const changed = typescriptEvidence(config, cwd);
    expect(changed.outcome).toBe("fail");
    expect(changed.projects?.[0].diagnostics.map((entry) => entry.code)).toContain("TS6306");
    expect(changed.projects?.[0].inputDigest).not.toBe(inherited.projects?.[0].inputDigest);
    expect(snapshot(cwd).map(([file]) => file)).toEqual(before.map(([file]) => file));
  }, 60_000);

  test.each(["reference", "extends", "source", "source-symlink"])("a recursive external %s input is rejected before compiler execution", (kind) => {
    const other = path.join(directory, "outside");
    source(other);
    writeJson(other, "tsconfig.json", { compilerOptions: { ...options, composite: true }, files: ["index.ts"] });
    root(cwd, [{ path: "./local" }]);
    source(cwd, "local/index.ts");
    const child: Record<string, unknown> = { compilerOptions: { ...options, composite: true }, files: ["index.ts"] };
    if (kind === "reference") child.references = [{ path: "../../outside" }];
    if (kind === "extends") child.extends = "../../outside/tsconfig.json";
    if (kind === "source") child.files = ["../../outside/index.ts"];
    if (kind === "source-symlink") {
      fs.rmSync(path.join(cwd, "local/index.ts"));
      fs.symlinkSync(path.join(other, "index.ts"), path.join(cwd, "local/index.ts"));
    }
    writeJson(cwd, "local/tsconfig.json", child);
    const result = expectIncompleteBeforeCompiler(cwd);
    expect([
      "Compiler configuration could not establish complete project inputs",
      "Compiler source or configuration inputs leave the evaluated project tree",
    ]).toContain(result.incompleteReason);
    expect(result.configs.map((entry) => entry.path)).toEqual([path.join(cwd, "tsconfig.json"), path.join(cwd, "local/tsconfig.json")]);
  });

  test.each(["self", "recursive", "symlink"])("a %s reference cycle is rejected before compiler execution", (kind) => {
    if (kind === "self") root(cwd, [{ path: "./tsconfig.json" }]);
    else {
      root(cwd, [{ path: "./local" }]);
      source(cwd, "local/index.ts");
      if (kind === "symlink") fs.symlinkSync(path.join(cwd, "tsconfig.json"), path.join(cwd, "alias.json"));
      writeJson(cwd, "local/tsconfig.json", { compilerOptions: { ...options, composite: true }, files: ["index.ts"], references: [{ path: kind === "symlink" ? "../alias.json" : "../tsconfig.json" }] });
    }
    expect(inspectCompilerInputs(cwd).incompleteReason).toMatch(/reference cycle/);
    expectIncompleteBeforeCompiler(cwd);
  });

  test.each(["missing", "invalid", "malformed-reference", "extends-cycle"])("an unsupported %s referenced config remains visibly incomplete", (kind) => {
    root(cwd, [{ path: "./local" }]);
    source(cwd, "local/index.ts");
    if (kind === "invalid") fs.writeFileSync(path.join(cwd, "local/tsconfig.json"), "{ invalid JSON");
    if (kind === "malformed-reference") writeJson(cwd, "local/tsconfig.json", { compilerOptions: options, files: ["index.ts"], references: [null] });
    if (kind === "extends-cycle") writeJson(cwd, "local/tsconfig.json", { extends: "./tsconfig.json", files: ["index.ts"] });
    expect(expectIncompleteBeforeCompiler(cwd).incompleteReason).toEqual(expect.any(String));
  });

  test("an explicitly selected leaf does not inspect an unselected solution root", () => {
    root(cwd, [{ path: "../outside" }]);
    writeJson(cwd, "selected.json", { compilerOptions: options, files: ["index.ts"] });
    const selected = inspectCompilerInputs(cwd, "selected.json");
    expect(selected.incompleteReason).toBeUndefined();
    expect(selected.configs.map((entry) => entry.path)).toEqual([path.join(cwd, "selected.json")]);
  });
});
