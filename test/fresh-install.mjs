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
  fs.writeFileSync(path.join(consumer, "src/index.ts"), 'export const message = "hello";\n');
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
  const consumerLock = path.join(consumer, "pnpm-lock.yaml");
  const consumerBefore = fingerprint(consumerLock);
  runPnpm(["install", "--frozen-lockfile", "--store-dir", store], consumer);
  assert.equal(fingerprint(consumerLock), consumerBefore);
  console.log("Fresh frozen install and all packed-consumer gates passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
