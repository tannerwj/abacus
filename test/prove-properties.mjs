import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, ".."),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus property regressions "));
const vitest = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
const mutants = [
  {
    name: "canonical key ordering",
    file: "src/policy.ts",
    testFile: "test/policy.test.ts",
    test: "canonical JSON is invariant",
    from: ".sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)",
    to: ".sort(() => 0)",
  },
  {
    name: "semantic version string ordering",
    file: "src/policy.ts",
    testFile: "test/policy.test.ts",
    test: "numeric semantic version increments",
    from: "function compareVersions(a: string, b: string): number {",
    to: "function compareVersions(a: string, b: string): number { return a === b ? 0 : a > b ? 1 : -1;",
  },
  {
    name: "exact waiver subject matching",
    file: "src/policy.ts",
    testFile: "test/policy.test.ts",
    test: "exact waivers cannot affect",
    from: "active.get(JSON.stringify([item.ruleId, item.subject]))",
    to: "[...active.values()][0]",
  },
  {
    name: "waivers erasing incomplete scans",
    file: "src/policy.ts",
    testFile: "test/policy.test.ts",
    test: "matching waivers preserve",
    from: "const copy = structuredClone(result);",
    to: 'const copy = structuredClone(result); if (["error", "incomplete", "not-applicable"].includes(copy.outcome)) copy.outcome = "fail";',
  },
];
try {
  fs.cpSync(root, temp, {
    recursive: true,
    filter: (file) => !["node_modules", ".git", "dist"].includes(path.basename(file)),
  });
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(temp, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const mutant of mutants) {
    const file = path.join(temp, mutant.file),
      original = fs.readFileSync(file, "utf8");
    assert.ok(original.includes(mutant.from), `Mutation target missing: ${mutant.name}`);
    fs.writeFileSync(file, original.replace(mutant.from, mutant.to));
    try {
      const result = spawnSync(
        process.execPath,
        [vitest, "run", mutant.testFile, "--testNamePattern", mutant.test, "--maxWorkers=1"],
        { cwd: temp, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status,
        1,
        `Property did not catch ${mutant.name}: ${result.stdout}\n${result.stderr}`,
      );
      assert.match(
        `${result.stdout}${result.stderr}`,
        /1 failed/u,
        `Mutation must fail the assertion, not startup: ${mutant.name}`,
      );
      console.log(`Property catches restored faulty behavior: ${mutant.name}`);
    } finally {
      fs.writeFileSync(file, original);
    }
  }
  console.log("All targeted property regressions were detected in an isolated checkout");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
