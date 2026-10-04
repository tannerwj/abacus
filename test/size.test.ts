import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defaults, type AbacusConfig, type SizeBudget } from "../src/config.js";
import { gzipSize, measureBudgets, reportSize } from "../src/size.js";

describe("size budgets", () => {
  let dir: string;
  let config: AbacusConfig;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-size-"));
    fs.mkdirSync(path.join(dir, "assets"));
    config = defaults("typescript");
    config.size.budgets = [{ label: "JavaScript", dir: "assets", match: "\\.js$", max: 1024 }];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each([undefined, "sum", "largest"] as const)("fails a zero-file match with mode %s by default", (mode) => {
    config.size.budgets[0].mode = mode;
    fs.writeFileSync(path.join(dir, "assets/styles.css"), "body {}");
    fs.mkdirSync(path.join(dir, "assets/not-a-file.js"));
    expect(measureBudgets(config, dir)).toEqual([
      expect.objectContaining({ label: "JavaScript", actual: 0, max: 1024, ok: false, error: expect.stringContaining("No files matching") })
    ]);
    expect(reportSize(config, dir)).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("assets"));
  });

  test.each(["sum", "largest"] as const)("permits an explicitly optional empty budget with mode %s", (mode) => {
    config.size.budgets[0].mode = mode;
    config.size.budgets[0].allowEmpty = true;
    expect(measureBudgets(config, dir)).toEqual([{ label: "JavaScript", actual: 0, max: 1024, ok: true }]);
    expect(reportSize(config, dir)).toBe(true);
  });

  test("an optional budget does not allow another budget to be empty", () => {
    config.size.budgets.push({ label: "CSS", dir: "assets", match: "\\.css$", max: 1024, allowEmpty: true });
    expect(measureBudgets(config, dir).map(({ ok }) => ok)).toEqual([false, true]);
    expect(reportSize(config, dir)).toBe(false);
  });

  test.each(["sum", "largest"] as const)("still enforces populated %s budgets when allowEmpty is true", (mode) => {
    fs.writeFileSync(path.join(dir, "assets/first.js"), "console.log('first');");
    fs.writeFileSync(path.join(dir, "assets/second.js"), "console.log('second');".repeat(20));
    fs.writeFileSync(path.join(dir, "assets/styles.css"), "body {}");
    const sizes = ["first.js", "second.js"].map((name) => gzipSize(path.join(dir, "assets", name)));
    const actual = mode === "largest" ? Math.max(...sizes) : sizes.reduce((sum, size) => sum + size, 0);
    const budget: SizeBudget = { ...config.size.budgets[0], mode, allowEmpty: true, max: actual };
    config.size.budgets = [budget];
    expect(measureBudgets(config, dir)).toEqual([{ label: "JavaScript", actual, max: actual, ok: true }]);
    expect(reportSize(config, dir)).toBe(true);
    budget.max = actual - 1;
    expect(measureBudgets(config, dir)).toEqual([{ label: "JavaScript", actual, max: actual - 1, ok: false }]);
    expect(reportSize(config, dir)).toBe(false);
  });

  test("allowEmpty does not excuse a missing build directory", () => {
    config.size.budgets[0].allowEmpty = true;
    fs.rmSync(path.join(dir, "assets"), { recursive: true });
    expect(() => measureBudgets(config, dir)).toThrow("JavaScript: assets missing — build first");
  });

  test.skipIf(process.platform === "win32")("counts symlinked files even when an empty budget is allowed", () => {
    const target = path.join(dir, "actual.js");
    fs.writeFileSync(target, "console.log('symlinked asset');");
    fs.symlinkSync(target, path.join(dir, "assets/app.js"));
    const actual = gzipSize(target);
    for (const mode of ["sum", "largest"] as const) {
      config.size.budgets[0] = { ...config.size.budgets[0], mode, allowEmpty: true, max: 1 };
      expect(measureBudgets(config, dir)).toEqual([{ label: "JavaScript", actual, max: 1, ok: false }]);
      expect(reportSize(config, dir)).toBe(false);
    }
  });

  test.skipIf(process.platform === "win32")("does not count symlinks targeting directories as assets", () => {
    fs.mkdirSync(path.join(dir, "target"));
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "assets/directory.js"));
    expect(measureBudgets(config, dir)[0].ok).toBe(false);
    config.size.budgets[0].allowEmpty = true;
    expect(measureBudgets(config, dir)[0]).toEqual({ label: "JavaScript", actual: 0, max: 1024, ok: true });
  });
});
