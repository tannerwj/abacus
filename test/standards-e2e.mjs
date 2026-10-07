import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve(import.meta.dirname, "../dist/cli.js"),
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus standards & "));
const git = (...args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const write = (file, value) => fs.writeFileSync(path.join(cwd, file), JSON.stringify(value));
function run(expected = 0, extra = []) {
  const result = spawnSync(
    process.execPath,
    [cli, "standards", "--base", "master", "--json", ...extra],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
try {
  git("init", "--initial-branch=master");
  git("config", "user.name", "Abacus E2E");
  git("config", "user.email", "abacus-e2e@example.invalid");
  const config = {
    roots: ["src", "scripts"],
    check: { gates: ["abc", "secrets"] },
    abc: { budget: 60 },
    ratchet: { file: "custom-baseline.json", metrics: { abcMax: true } },
    size: { budgets: [{ label: "JS", dir: "dist", match: "js$", max: 100, allowEmpty: false }] },
    policy: { exceptions: [] },
    verification: {
      reports: [
        {
          id: "e2e",
          path: "/tmp/abacus-e2e.json",
          format: "contract",
          profile: "behavior",
          required: true,
          enforcement: "block",
          maxSkipped: 0,
        },
      ],
    },
  };
  write("abacus.config.json", config);
  write("custom-baseline.json", { abcMax: 40 });
  write("package.json", { scripts: { test: "real-e2e", check: "abacus check" } });
  write(".oxlintrc.json", { rules: { complexity: "error" } });
  git("add", ".");
  git("commit", "-m", "Fixture standards baseline");
  assert.equal(run().changes.length, 0);
  config.abc.budget = 70;
  config.check.gates = ["abc"];
  config.roots = ["src"];
  config.size.budgets[0].allowEmpty = true;
  config.verification.reports[0].enforcement = "observe";
  config.policy.exceptions.push({
    id: "temporary-debt",
    ruleId: "lint/rule",
    subject: "src/index.ts",
    owner: "team",
    reason: "Migration",
    expires: "2026-12-01",
  });
  write("abacus.config.json", config);
  write("custom-baseline.json", { abcMax: 50 });
  write(".oxlintrc.json", { rules: { complexity: "off" }, token: "private-policy-value" });
  write("package.json", { scripts: { check: "abacus check" } });
  const report = run(1, ["--fail-on", "weakening"]);
  for (const field of [
    "/abc/budget",
    "/check/gates",
    "/roots",
    "/size/budgets/JS/allowEmpty",
    "/verification/reports/e2e/enforcement",
    "/abcMax",
    "/scripts/test",
    "/policy/exceptions/temporary-debt",
  ])
    assert.ok(
      report.changes.some(
        (change) => change.field === field && change.classification === "weakening",
      ),
      field,
    );
  assert.ok(
    report.changes.some(
      (change) => change.file === ".oxlintrc.json" && change.classification === "review",
    ),
  );
  assert.ok(!JSON.stringify(report).includes("private-policy-value"));
  run(1, ["--fail-on", "any"]);
  config.abc.budget = 50;
  write("abacus.config.json", config);
  assert.ok(
    run().changes.some(
      (change) => change.field === "/abc/budget" && change.classification === "tightening",
    ),
  );
  assert.equal(git("log", "--format=%s"), "Fixture standards baseline");
  console.log(
    "Standards E2E passed: budgets, gates, roots, optional assets, enforcement, custom baselines, scripts and native config review",
  );
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
