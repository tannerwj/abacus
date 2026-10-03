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
