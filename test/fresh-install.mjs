/** Cold frozen install, full repository check, then a packed-package consumer. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-fresh-install-"));
const checkout = path.join(temp, "checkout");
const consumer = path.join(temp, "consumer with spaces");
const store = path.join(temp, "store");
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(temp, "data"),
  XDG_CACHE_HOME: path.join(temp, "cache"),
  XDG_STATE_HOME: path.join(temp, "state"),
};
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !path.basename(pnpmCli).startsWith("pnpm")) {
  fs.rmSync(temp, { recursive: true, force: true });
  throw new Error("Run this integration test with pnpm test:install so pnpm's JavaScript CLI is available");
}
const fingerprint = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function run(bin, args, cwd, expected = 0) {
  const result = spawnSync(bin, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== expected) {
    throw new Error(`${bin} ${args.join(" ")} exited ${result.status}, expected ${expected}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

// Invoking pnpm's JS CLI directly also works on Windows, where .cmd is a shell shim.
const runPnpm = (args, cwd) => run(process.execPath, [pnpmCli, ...args], cwd);

function verifyLargePackedJson(cli) {
  const fixture = path.join(temp, "large JSON consumer with spaces");
  const sourceFile = path.join("src", "expired-pipe-output.ts");
  const findingCount = 5000;
  const finalDate = "1999-12-31";
  fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "abacus.config.json"), JSON.stringify({ roots: ["src"], check: { gates: ["todos"] } }));
  fs.writeFileSync(path.join(fixture, sourceFile), Array.from({ length: findingCount }, (_, index) =>
    `// TODO(${index === findingCount - 1 ? finalDate : "2000-01-01"}): packed-json-finding-${index + 1}\n`
  ).join(""));

  for (const [name, version, enforcement] of [["old", "1.0.0", "block"], ["new", "1.1.0", "observe"]]) {
    const packFile = path.join(fixture, `${name}-policy.json`);
    fs.writeFileSync(packFile, JSON.stringify({
      schemaVersion: 1, name: "packed-output-regression", version,
      compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, nativeFiles: [],
      checks: [{ id: "expired-todos", gate: "todos", required: true, enforcement, severity: "error", rationale: "Exercise complete packed CLI output" }],
    }));
    const digest = run(process.execPath, [cli, "policy-digest", "--path", packFile], fixture).trim();
    fs.writeFileSync(path.join(fixture, `${name}-pin.json`), JSON.stringify({ path: packFile, version, digest }));
  }

  const readLargeJson = (args, expected) => {
    // Keep real pipes: redirecting stdout to a file would hide premature process.exit.
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: fixture, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, `${args[0]} must finish normally`);
    assert.equal(result.status, expected, `${args[0]} must preserve its exit code`);
    assert.equal(result.stderr, "", `${args[0]} must keep stderr empty`);
    const json = JSON.parse(result.stdout);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") > 512 * 1024, `${args[0]} must exercise more than 512 KiB of normalized JSON`);
    return json;
  };
  const assertAllFindings = (evidence, id, enforcement, blocking) => {
    assert.equal(evidence.checks.length, 1);
    const [check] = evidence.checks;
    assert.equal(check.id, id);
    assert.equal(check.gate, "todos");
    assert.equal(check.outcome, "fail");
    assert.equal(check.enforcement, enforcement);
    assert.equal(check.blocking, blocking);
    assert.equal(check.scope.scanned, 1);
    assert.deepEqual(check.counts, { findings: findingCount, waived: 0, active: findingCount });
    assert.equal(check.metrics.dated, findingCount);
    assert.equal(check.metrics.undated, 0);
    assert.equal(check.findings.length, findingCount);
    assert.deepEqual(check.findings.map((finding) => finding.subject), Array.from({ length: findingCount }, (_, index) => `${sourceFile}:${index + 1} TODO`));
    assert.ok(check.findings.every((finding, index) => finding.ruleId === "todos/expired" && finding.severity === "error"
      && finding.message === `Deadline ${index === findingCount - 1 ? finalDate : "2000-01-01"} expired`));
    // Comment text is intentionally omitted from normalized evidence; the last line/date is its marker.
    assert.equal(check.findings.at(-1).subject, `${sourceFile}:${findingCount} TODO`);
    assert.equal(check.findings.at(-1).message, `Deadline ${finalDate} expired`);
  };

  const evidence = readLargeJson(["check", "--json", "--at", "2026-01-01T00:00:00.000Z"], 1);
  assert.equal(evidence.clean, false);
  assertAllFindings(evidence, "todos", "block", true);
  const upgrade = readLargeJson(["preview", "--from", "old-pin.json", "--to", "new-pin.json", "--json", "--at", "2026-01-01T00:00:00.000Z"], 0);
  assert.equal(upgrade.preview.cleanBefore, false);
  assert.equal(upgrade.preview.cleanAfter, true);
  assert.equal(upgrade.before.clean, false);
  assert.equal(upgrade.after.clean, true);
  assertAllFindings(upgrade.before, "expired-todos", "block", true);
  assertAllFindings(upgrade.after, "expired-todos", "observe", false);
  assert.equal(upgrade.before.source.treeDigest, upgrade.after.source.treeDigest);
  assert.equal(upgrade.before.evaluatedAt, upgrade.after.evaluatedAt);
  assert.equal(upgrade.preview.enforcementChanges.length, 1);
  assert.deepEqual(upgrade.preview.addedFindings, []);
  assert.deepEqual(upgrade.preview.resolvedFindings, []);
  assert.deepEqual(upgrade.preview.newBlockers, []);
}

try {
  fs.cpSync(root, checkout, { recursive: true, filter: (file) => !["node_modules", ".git"].includes(path.basename(file)) });
  const lock = path.join(checkout, "pnpm-lock.yaml");
  const before = fingerprint(lock);
  console.log("Fresh checkout: frozen install into an empty node_modules and store");
  runPnpm(["install", "--frozen-lockfile", "--store-dir", store], checkout);
  assert.equal(fingerprint(lock), before, "frozen install must not change the lockfile");
  console.log("Fresh checkout: build, typecheck, every regression test, and every configured gate");
  runPnpm(["check:all"], checkout);

  const artifacts = path.join(temp, "artifacts");
  fs.mkdirSync(artifacts);
  runPnpm(["pack", "--pack-destination", artifacts], checkout);
  const archive = path.join(artifacts, fs.readdirSync(artifacts).find((name) => name.endsWith(".tgz")));
  fs.mkdirSync(path.join(consumer, "src"), { recursive: true });
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({
    name: "abacus-integration-consumer", private: true, type: "module", exports: "./src/index.ts",
    devDependencies: {
      "@tjohnson/abacus": `file:${archive}`,
      oxlint: "1.82.0", "oxlint-tsgolint": "7.0.2001", oxfmt: "0.67.0",
    },
  }, null, 2));
  fs.writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), 'allowBuilds:\n  esbuild: true\n  "@b12k/gitleaks": true\n  "@tjohnson/abacus": false\n');
  // Qualifies for jscpd's native minimum file/token scope, rather than a zero-target scan.
  fs.writeFileSync(path.join(consumer, "src/index.ts"), `export function describeInbox(name: string, count: number): string {
  const recipient = name.trim();
  const total = Math.max(0, count);
  const noun = total === 1 ? "message" : "messages";
  const greeting = recipient.length > 0 ? recipient : "friend";
  const prefix = "Hello " + greeting;
  const countLabel = total.toString();
  const summary = countLabel + " " + noun;
  return prefix + ", you have " + summary;
}
`);
  fs.writeFileSync(path.join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [] },
    include: ["src/**/*.ts"],
  }));
  console.log("Packed consumer: install, init --all, explicit baseline, and full post-build check");
  runPnpm(["install", "--store-dir", store], consumer);
  const cli = path.join(consumer, "node_modules/@tjohnson/abacus/dist/cli.js");
  run(process.execPath, [cli, "init", "--all"], consumer);
  const baseline = path.join(consumer, "abacus.ratchet.json");
  run(process.execPath, [cli, "ratchet"], consumer, 1);
  assert.equal(fs.existsSync(baseline), false, "normal check cannot create a baseline");
  run(process.execPath, [cli, "ratchet", "--write"], consumer);
  const configFile = path.join(consumer, "abacus.config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  fs.mkdirSync(path.join(consumer, "dist"));
  fs.writeFileSync(path.join(consumer, "dist/app.js"), 'console.log("hello");\n');
  config.size.budgets = [{ label: "built JS", dir: "dist", match: "\\.js$", max: 1024 }];
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const output = run(process.execPath, [cli, "check", "--all", "--with-size"], consumer);
  for (const gate of ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos", "size"]) {
    assert.ok(output.includes(`Checking ${gate}…`), `${gate} must run in the packed consumer`);
  }
  const evidence = JSON.parse(run(process.execPath, [cli, "check", "--all", "--with-size", "--json"], consumer));
  assert.equal(evidence.clean, true);
  assert.equal(evidence.checks.length, 10);
  assert.ok(evidence.checks.every((check) => check.outcome === "pass" && check.scope.scanned > 0));
  assert.match(evidence.source.treeDigest, /^[a-f0-9]{64}$/);
  assert.match(evidence.configDigest, /^[a-f0-9]{64}$/);
  console.log("Packed consumer: pinned shared-policy upgrade preview on identical inputs");
  for (const [name, version] of [["advisory", "1.0.0"], ["advisory-next", "1.1.0"]]) {
    const packFile = path.join(consumer, "node_modules/@tjohnson/abacus/configs/policy-packs", name, "policy.json");
    const digest = run(process.execPath, [cli, "policy-digest", "--path", packFile], consumer).trim();
    fs.writeFileSync(path.join(consumer, `${name}-pin.json`), JSON.stringify({ path: packFile, version, digest }));
  }
  const upgrade = JSON.parse(run(process.execPath, [cli, "preview", "--from", "advisory-pin.json", "--to", "advisory-next-pin.json", "--json"], consumer));
  assert.equal(upgrade.before.source.treeDigest, upgrade.after.source.treeDigest);
  assert.equal(upgrade.before.evaluatedAt, upgrade.after.evaluatedAt);
  assert.equal(upgrade.preview.cleanBefore, true);
  assert.equal(upgrade.preview.cleanAfter, true);
  assert.ok(upgrade.preview.thresholdChanges.length > 0);
  assert.ok(upgrade.preview.enforcementChanges.length > 0);
  console.log("Packed consumer: complete large failing check and successful preview JSON through pipes");
  verifyLargePackedJson(cli);
  const consumerLock = path.join(consumer, "pnpm-lock.yaml");
  const consumerBefore = fingerprint(consumerLock);
  runPnpm(["install", "--frozen-lockfile", "--store-dir", store], consumer);
  assert.equal(fingerprint(consumerLock), consumerBefore);
  console.log("Fresh frozen install, packed-consumer gates/evidence, and policy upgrade preview passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
