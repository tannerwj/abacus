import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THRESHOLD,
  jscpdBinPath,
  reportDupes,
  runDupes,
  sourceDir,
  thresholdFor,
} from "../src/dupes.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "dupes");

describe("dupes gate", () => {
  test("jscpd binary resolves (project-local or bundled)", () => {
    const p = jscpdBinPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(p).toMatch(/jscpd(\.cmd|\.js)?$/);
  });

  test("thresholdFor defaults to 5 and reads .jscpd.json", () => {
    expect(thresholdFor(fixtureDir)).toBe(DEFAULT_THRESHOLD);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-dupes-test-"));
    try {
      expect(thresholdFor(dir)).toBe(DEFAULT_THRESHOLD);
      fs.writeFileSync(path.join(dir, ".jscpd.json"), JSON.stringify({ threshold: 12 }));
      expect(thresholdFor(dir)).toBe(12);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sourceDir prefers src/ when present", () => {
    expect(sourceDir(fixtureDir)).toBe(path.join(fixtureDir, "src"));
  });

  test("runDupes finds the fixture's duplicated block", () => {
    const result = runDupes(fixtureDir);
    // 7 of 14 lines duplicated = 50% > 5% threshold
    expect(result.clean).toBe(false);
    expect(result.percentage).toBeGreaterThan(result.threshold);
    expect(result.clones.length).toBeGreaterThan(0);
    const files = result.clones.flatMap((c) => [c.first.file, c.second.file]).join(" ");
    expect(files).toMatch(/a\.ts/);
    expect(files).toMatch(/b\.ts/);
  }, 60_000);

  test("runDupes is clean when nothing is duplicated", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-dupes-test-"));
    try {
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      fs.writeFileSync(path.join(src, "a.ts"), "export const alpha = 1;\n");
      fs.writeFileSync(path.join(src, "b.ts"), "export const beta = 2;\n");
      const result = runDupes(dir);
      expect(result.clean).toBe(true);
      expect(result.clones).toEqual([]);
      expect(reportDupes(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
