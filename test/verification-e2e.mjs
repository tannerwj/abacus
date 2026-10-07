import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyNativeReports } from "./verification-native-e2e.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  cli = path.join(root, "dist/cli.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus verification spaces & "));
const project = path.join(temp, "consumer"),
  producer = path.join(project, "producer.mjs");
let sequence = 0;
const run = (args, status = 0, env = {}) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${args[0]}: ${result.stdout}\n${result.stderr}`);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("private-runner-token"));
  return result.stdout;
};
const writeConfig = (spec) =>
  fs.writeFileSync(
    path.join(project, "abacus.config.json"),
    JSON.stringify({
      roots: ["src"],
      check: { gates: ["abc"] },
      verification: { reports: [spec] },
    }),
  );
const check = (status) =>
  JSON.parse(run(["check", "--json"], status)).checks.find(
    (entry) => entry.gate === "verification",
  );
function record(mode = "pass", overrides = {}, expected = 0) {
  const prefix = path.join(temp, `run-${sequence++}`),
    raw = `${prefix}-raw.json`,
    evidence = `${prefix}-evidence.json`;
  const spec = {
    id: "critical",
    path: evidence,
    format: "contract",
    profile: "behavior",
    required: true,
    enforcement: "block",
    ...overrides,
  };
  writeConfig(spec);
  run(
    [
      "verify",
      "--id",
      spec.id,
      "--profile",
      spec.profile,
      "--format",
      spec.format,
      "--report",
      raw,
      "--evidence",
      evidence,
      ...(spec.environment ? ["--environment", spec.environment] : []),
      ...(mode === "hang" ? ["--timeout", "100"] : []),
      "--",
      process.execPath,
      producer,
      raw,
      mode,
    ],
    expected,
  );
  return { spec, raw, evidence, record: JSON.parse(fs.readFileSync(evidence, "utf8")) };
}

try {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "src/index.ts"), "export const value = 1;\n");
  fs.writeFileSync(
    producer,
    `import fs from "node:fs";
const [out, mode] = process.argv.slice(2);
console.log("private-runner-token");
if (mode === "hang") { setInterval(() => {}, 1000); }
else if (mode !== "missing") {
  const status = mode === "fail" ? "failed" : mode === "skip" ? "skipped" : "passed";
  let value = { schemaVersion: 1, cases: [{ id: "authorization/other-owner-denied", status }, { id: "resilience/replay-after-commit", status }, { id: "latency-p95", status: mode === "skip-measurement" ? "skipped" : "passed", measurement: { value: 150, unit: "ms", samples: mode === "few-samples" ? 1 : 100 } }] };
  if (mode === "flaky") value.flaky = 1;
  if (mode === "audit-vulnerable") value = { advisories: { "42": { github_advisory_id: "GHSA-2345-6789-cfgh", severity: "high" }, "43": { github_advisory_id: "GHSA-cfgh-2345-6789", severity: "low" } }, metadata: { dependencies: 10, devDependencies: 0, optionalDependencies: 0, vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 0 } } };
  if (mode === "audit-error") value = { error: { message: "Registry unavailable: private-runner-token" } };
  fs.writeFileSync(out, mode === "malformed" ? "{}" : JSON.stringify(value));
  if (mode === "mutate") fs.writeFileSync("src/index.ts", "export const value = 2;\\n");
  if (mode === "fail") process.exitCode = 1;
}
`,
  );

  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(["init", "--preset", "typescript"]);
  const initialized = JSON.parse(fs.readFileSync(path.join(project, "abacus.config.json"), "utf8"));
  assert.deepEqual(initialized.ratchet.metrics, { oxlintWarnings: true, abcMax: true });
  assert.ok(!initialized.exclude.includes("/components/ui/"));
  fs.writeFileSync(path.join(project, "abacus.config.json"), "{}");
  fs.writeFileSync(
    path.join(project, "abacus.ratchet.json"),
    JSON.stringify({ abcMax: 0, oxlintWarnings: 0 }),
  );
  const legacy = spawnSync(process.execPath, [cli, "ratchet"], { cwd: project, encoding: "utf8" });
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /missing enabled metrics: loc src, comments src/u);

  const dangling = path.join(temp, "dangling-report.json"),
    target = path.join(project, "must-not-be-created.json");
  fs.symlinkSync(target, dangling);
  run(
    [
      "verify",
      "--id",
      "critical",
      "--profile",
      "behavior",
      "--format",
      "contract",
      "--report",
      dangling,
      "--evidence",
      path.join(temp, "dangling-envelope.json"),
      "--",
      process.execPath,
      producer,
      dangling,
      "pass",
    ],
    2,
  );
  assert.equal(fs.existsSync(target), false);

  const passed = record();
  assert.equal(check(0).outcome, "pass");
  assert.equal(passed.record.summary.total, 3);
  assert.match(passed.record.command.executableDigest, /^[a-f0-9]{64}$/);
  run(
    [
      "verify",
      "--id",
      "critical",
      "--profile",
      "behavior",
      "--format",
      "contract",
      "--report",
      passed.raw,
      "--evidence",
      passed.evidence,
      "--",
      process.execPath,
      producer,
      passed.raw,
      "pass",
    ],
    2,
  );

  record("fail", { enforcement: "observe" }, 1);
  assert.equal(check(0).outcome, "fail");
  record("missing", { enforcement: "observe" }, 1);
  assert.equal(check(1).outcome, "error");
  record("malformed", {}, 1);
  assert.equal(check(1).outcome, "error");
  const timeout = record("hang", { enforcement: "observe" }, 1);
  assert.ok(timeout.record.issues.includes("execution-timeout"));
  assert.equal(check(1).outcome, "error");
  record("skip");
  assert.equal(check(1).outcome, "fail");
  record("flaky");
  assert.equal(check(1).metrics.flaky, 1);

  record("pass", {
    profile: "authorization",
    environment: "isolated",
    assertions: ["authorization/other-owner-denied"],
  });
  assert.equal(check(0).outcome, "pass");
  record("pass", {
    profile: "resilience",
    environment: "isolated",
    assertions: ["resilience/replay-after-commit"],
  });
  assert.equal(check(0).outcome, "pass");
  record("pass", {
    profile: "authorization",
    environment: "isolated",
    assertions: ["authorization/missing-assertion"],
    enforcement: "observe",
  });
  assert.equal(check(1).outcome, "incomplete");
  record("pass", {
    profile: "performance",
    environment: "isolated",
    budgets: [{ id: "latency-p95", unit: "ms", max: 100, minSamples: 30 }],
  });
  assert.ok(check(1).findings.some((item) => item.ruleId === "verification/budget"));
  record("few-samples", {
    profile: "performance",
    environment: "isolated",
    budgets: [{ id: "latency-p95", unit: "ms", max: 200, minSamples: 30 }],
    enforcement: "observe",
  });
  assert.equal(check(1).outcome, "incomplete");
  record("skip-measurement", {
    profile: "performance",
    environment: "isolated",
    maxSkipped: 1,
    budgets: [{ id: "latency-p95", unit: "ms", max: 200, minSamples: 30 }],
  });
  assert.equal(check(1).outcome, "incomplete");
  record(
    "audit-vulnerable",
    { profile: "dependencies", format: "pnpm-audit", enforcement: "observe" },
    1,
  );
  const vulnerable = check(0);
  assert.deepEqual(
    vulnerable.findings
      .filter((item) => item.ruleId === "verification/advisory")
      .map((item) => item.subject),
    ["GHSA-2345-6789-cfgh", "GHSA-cfgh-2345-6789"],
  );
  record(
    "audit-error",
    { profile: "dependencies", format: "pnpm-audit", enforcement: "observe" },
    1,
  );
  assert.equal(check(1).outcome, "error");

  const tampered = record();
  fs.appendFileSync(tampered.raw, " ");
  assert.equal(check(1).outcome, "incomplete");
  const cached = record();
  cached.record.summary.total = 4;
  fs.writeFileSync(cached.evidence, JSON.stringify(cached.record));
  assert.equal(check(1).outcome, "incomplete");
  const stale = record();
  const future = new Date(Date.parse(stale.record.finishedAt) + 25 * 3_600_000).toISOString();
  assert.equal(
    JSON.parse(run(["check", "--json", "--at", future], 1)).checks.at(-1).outcome,
    "incomplete",
  );
  record("mutate", {}, 1);
  assert.equal(check(1).outcome, "incomplete");

  verifyNativeReports({ root, temp, project, writeConfig, run, check });

  fs.writeFileSync(
    path.join(project, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { moduleResolution: "Bundler" } }),
  );
  fs.writeFileSync(
    path.join(project, "src/a.ts"),
    'import { b } from "./b.js"; export const a = b + 1;',
  );
  fs.writeFileSync(
    path.join(project, "src/b.ts"),
    'import { a } from "./a.js"; export const b = a + 1;',
  );
  fs.writeFileSync(
    path.join(project, "src/c.ts"),
    'import { missing } from "./missing.js"; export const c = missing;',
  );
  fs.writeFileSync(
    path.join(project, "abacus.config.json"),
    JSON.stringify({ check: { gates: ["cycles"] } }),
  );
  const graph = JSON.parse(run(["check", "--json"], 1)).checks[0];
  assert.equal(graph.outcome, "fail");
  assert.equal(graph.coverage.status, "incomplete");
  assert.equal(graph.blocking, true);
  assert.ok(graph.findings.length > 0);
  const policyFile = path.join(project, "coverage-policy.json");
  fs.writeFileSync(
    policyFile,
    JSON.stringify({
      schemaVersion: 1,
      name: "coverage-regression",
      version: "1.0.0",
      compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 },
      checks: [
        {
          id: "cycles",
          gate: "cycles",
          required: true,
          enforcement: "observe",
          severity: "error",
          rationale: "Coverage cannot be waived",
        },
      ],
    }),
  );
  const policy = {
    pack: {
      path: "coverage-policy.json",
      version: "1.0.0",
      digest: run(["policy-digest", "--path", policyFile]).trim(),
    },
    exceptions: graph.findings.map((item, index) => ({
      id: `cycle-${index}`,
      ruleId: item.ruleId,
      subject: item.subject,
      owner: "E2E",
      reason: "Prove coverage remains blocking",
      expires: "2099-12-31",
    })),
  };
  fs.writeFileSync(
    path.join(project, "abacus.config.json"),
    JSON.stringify({ check: { gates: ["cycles"] }, policy }),
  );
  const waived = JSON.parse(run(["check", "--json"], 1)).checks[0];
  assert.equal(waived.outcome, "waived");
  assert.equal(waived.counts.active, 0);
  assert.equal(waived.blocking, true);
  assert.equal(waived.coverage.status, "incomplete");
  fs.writeFileSync(path.join(project, "src/a.ts"), "export const a = 1;");
  const unresolved = JSON.parse(run(["check", "--json"], 1)).checks[0];
  assert.equal(unresolved.outcome, "pass");
  assert.equal(unresolved.blocking, true);
  assert.equal(unresolved.coverage.status, "incomplete");
  run(["cycles"], 1);
  console.log(
    "Verification E2E passed: real Vitest/Playwright/audit, HTTP, source/report binding, failures, skips, retries, timeouts, profiles, budgets and incomplete graph findings",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
