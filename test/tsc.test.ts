import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRICTNESS_FLAGS,
  effectiveOptions,
  reportTsc,
  runTsc,
  tscBinPath,
} from "../src/tsc.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tsc");

describe("tsc gate", () => {
  test("tsc binary resolves (project-local or bundled)", () => {
    expect(tscBinPath()).toMatch(/tsc(\.cmd)?$/);
  });

  test("effectiveOptions resolves the fixture tsconfig", () => {
    const { options, configPath } = effectiveOptions(fixtureDir);
    expect(configPath).toMatch(/tsconfig\.json$/);
    expect(options["strict"]).toBe(true);
    expect(options["noUncheckedIndexedAccess"]).toBeUndefined();
  });

  test("effectiveOptions handles a missing tsconfig", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-tsc-test-"));
    try {
      const { options, configPath } = effectiveOptions(dir);
      expect(configPath).toBeUndefined();
      expect(options).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("STRICTNESS_FLAGS covers the research-backed set", () => {
    const flags = STRICTNESS_FLAGS.map((f) => f.flag);
    for (const expected of ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "noImplicitOverride", "noUnusedLocals"]) {
      expect(flags).toContain(expected);
    }
  });

  test("runTsc flags the fixture's type error", () => {
    const result = runTsc(fixtureDir);
    expect(result.clean).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join("\n")).toMatch(/error TS2322/);
  }, 60_000);

  test("runTsc is clean when the broken file is removed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-tsc-test-"));
    try {
      fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
        include: ["clean.ts"],
      }));
      fs.writeFileSync(path.join(dir, "clean.ts"), "export const x: number = 1;\n");
      const result = runTsc(dir);
      expect(result.clean).toBe(true);
      expect(result.errors).toEqual([]);
      expect(reportTsc(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

test("tsc runs the declared project CLI rather than platform .bin shims", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-tsc-shims-"));
  try {
    const root = path.join(cwd, "node_modules/typescript");
    const shims = path.join(cwd, "node_modules/.bin");
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(shims);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "typescript", version: "5.9.3", bin: { tsc: "tsc" } }));
    fs.writeFileSync(path.join(root, "tsc"), `console.log(${JSON.stringify(path.join(cwd, "index.ts"))});`);
    fs.writeFileSync(path.join(shims, "tsc"), "#!/bin/sh\nexit 99\n");
    fs.writeFileSync(path.join(shims, "tsc.cmd"), "@ECHO OFF\r\nEXIT /B 99\r\n");
    fs.writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ files: ["index.ts"] }));
    fs.writeFileSync(path.join(cwd, "index.ts"), "export const x = 1;");
    expect(tscBinPath(cwd)).toBe(path.join(root, "tsc"));
    expect(runTsc(cwd)).toMatchObject({ clean: true, files: 1 });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});


test("incremental compiler checks keep build info out of the source tree", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-tsc-incremental-"));
  try {
    fs.writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { incremental: true, strict: true, types: [] }, files: ["index.ts"] }));
    fs.writeFileSync(path.join(cwd, "index.ts"), "export const value = 1;");
    expect(runTsc(cwd).clean).toBe(true);
    expect(fs.existsSync(path.join(cwd, "tsconfig.tsbuildinfo"))).toBe(false);
    fs.writeFileSync(path.join(cwd, "index.ts"), "export const value = 2;");
    expect(runTsc(cwd).clean).toBe(true);
    expect(fs.existsSync(path.join(cwd, "tsconfig.tsbuildinfo"))).toBe(false);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}, 60_000);
