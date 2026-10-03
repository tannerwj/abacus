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
    expect(p).toMatch(/depcruise(\.cmd|\.mjs)?$/);
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
});
