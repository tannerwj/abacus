import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cruiseConfigPath,
  depcruiseBinPath,
  reportCycles,
  runCycles,
  sourceDir,
} from "../src/cycles.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "cycles");

describe("cycles gate", () => {
  test("depcruise binary resolves (project-local or bundled)", () => {
    const p = depcruiseBinPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(p).not.toContain(`${path.sep}.bin${path.sep}`);
  });

  test("cruiseConfigPath prefers the repo config, falls back to bundled", () => {
    // abacus repo itself has no .dependency-cruiser.cjs yet; falls back to template
    const p = cruiseConfigPath(path.join(fixtureDir, "..", ".."));
    expect(p).toMatch(/dependency-cruiser\.cjs$/);
    expect(fs.existsSync(p)).toBe(true);
  });

  test("sourceDir prefers src/ when present", () => {
    expect(sourceDir(fixtureDir)).toBe(path.join(fixtureDir, "src"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-cycles-test-"));
    try {
      expect(sourceDir(dir)).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runCycles finds the fixture's circular dependency", () => {
    const result = runCycles(fixtureDir);
    expect(result.clean).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    const chain = result.violations.map((v) => v.cycle.join(" ")).join(" ");
    expect(chain).toMatch(/a\.ts/);
    expect(chain).toMatch(/b\.ts/);
  }, 60_000);

  test("runs the real project dependency despite pnpm Unix and Windows shims", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus cycles % spaces &-"));
    try {
      fs.cpSync(fixtureDir, dir, { recursive: true });
      const bin = depcruiseBinPath();
      const packageDir = path.dirname(path.dirname(bin));
      const modules = path.join(dir, "node_modules");
      const shims = path.join(modules, ".bin");
      fs.mkdirSync(shims, { recursive: true });
      fs.symlinkSync(packageDir, path.join(modules, "dependency-cruiser"), process.platform === "win32" ? "junction" : "dir");
      fs.writeFileSync(path.join(shims, "depcruise"), "#!/bin/sh\nexit 99\n");
      fs.writeFileSync(path.join(shims, "depcruise.cmd"), "@ECHO OFF\r\nEXIT /B 99\r\n");
      expect(depcruiseBinPath(dir)).toBe(path.join(modules, "dependency-cruiser", "bin", path.basename(bin)));
      const result = runCycles(dir);
      expect(result.clean).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.flatMap((v) => v.cycle).join(" ")).toMatch(/a\.ts/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("runCycles is clean when the cycle is broken", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-cycles-test-"));
    try {
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      fs.writeFileSync(path.join(src, "a.ts"), 'import { b } from "./b.js";\nexport const a = b + 1;\n');
      fs.writeFileSync(path.join(src, "b.ts"), "export const b = 1;\n");
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { moduleResolution: "Bundler" } }),
      );
      const result = runCycles(dir);
      expect(result.clean).toBe(true);
      expect(result.violations).toEqual([]);
      expect(reportCycles(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("runCycles reports cycles despite unresolved imports (warns, doesn't throw)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-cycles-test-"));
    try {
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      // a <-> b cycle, plus c importing a non-existent module (unresolved)
      fs.writeFileSync(path.join(src, "a.ts"), 'import { b } from "./b.js";\nexport const a = b + 1;\n');
      fs.writeFileSync(path.join(src, "b.ts"), 'import { a } from "./a.js";\nexport const b = a + 1;\n');
      fs.writeFileSync(path.join(src, "c.ts"), 'import { x } from "./does-not-exist.js";\nexport const c = x;\n');
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { moduleResolution: "Bundler" } }),
      );
      const result = runCycles(dir);
      // The cycle is still found; unresolved imports are counted, not fatal.
      expect(result.clean).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.unresolved).toBeGreaterThan(0);
      expect(result.violations.flatMap((v) => v.cycle).join(" ")).toMatch(/a\.ts/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
