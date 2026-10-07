import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "@playwright/test";

export function verifyNativeReports({ root, temp, project, writeConfig, run, check }) {
  const vitestRaw = path.join(temp, "vitest-raw.json"),
    vitestEvidence = path.join(temp, "vitest-evidence.json");
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  fs.writeFileSync(
    path.join(project, "auth.test.ts"),
    'import { test, expect } from "vitest"; test("real native runner executes", () => expect(2 + 2).toBe(4));\n',
  );
  writeConfig({
    id: "native-vitest",
    path: vitestEvidence,
    format: "vitest",
    profile: "behavior",
    required: true,
    enforcement: "block",
  });
  const vitest = path.join(
    path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  run([
    "verify",
    "--id",
    "native-vitest",
    "--profile",
    "behavior",
    "--format",
    "vitest",
    "--report",
    vitestRaw,
    "--evidence",
    vitestEvidence,
    "--",
    process.execPath,
    vitest,
    "run",
    "--root",
    project,
    "--reporter=json",
    "--outputFile",
    vitestRaw,
    "--maxWorkers=1",
  ]);
  assert.equal(check(0).metrics.passed, 1);
  fs.writeFileSync(
    path.join(project, "auth.test.ts"),
    'import { test, expect } from "vitest"; test("real regression fails", () => expect(2 + 2).toBe(5));\n',
  );
  const failedRaw = path.join(temp, "vitest-fail-raw.json"),
    failedEvidence = path.join(temp, "vitest-fail-evidence.json");
  writeConfig({
    id: "native-vitest",
    path: failedEvidence,
    format: "vitest",
    profile: "behavior",
    required: true,
    enforcement: "block",
  });
  run(
    [
      "verify",
      "--id",
      "native-vitest",
      "--profile",
      "behavior",
      "--format",
      "vitest",
      "--report",
      failedRaw,
      "--evidence",
      failedEvidence,
      "--",
      process.execPath,
      vitest,
      "run",
      "--root",
      project,
      "--reporter=json",
      "--outputFile",
      failedRaw,
      "--maxWorkers=1",
    ],
    1,
  );
  assert.equal(check(1).metrics.failed, 1);

  fs.writeFileSync(
    path.join(project, "playwright.config.mjs"),
    `export default ${JSON.stringify(defineConfig({ testMatch: "api.spec.ts", retries: 1, workers: 1, outputDir: path.join(temp, "playwright-artifacts") }))};`,
  );
  const playwright = path.join(
    path.dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json")),
    "cli.js",
  );
  function nativePlaywright(name, source, expected = 0) {
    const raw = path.join(temp, `${name}-raw.json`),
      evidence = path.join(temp, `${name}-evidence.json`);
    fs.writeFileSync(path.join(project, "api.spec.ts"), source);
    writeConfig({
      id: "native-playwright",
      path: evidence,
      format: "playwright",
      profile: "behavior",
      required: true,
      enforcement: "block",
    });
    run(
      [
        "verify",
        "--id",
        "native-playwright",
        "--profile",
        "behavior",
        "--format",
        "playwright",
        "--report",
        raw,
        "--evidence",
        evidence,
        "--",
        process.execPath,
        playwright,
        "test",
        "--reporter=json",
      ],
      expected,
      { PLAYWRIGHT_JSON_OUTPUT_NAME: raw, ABACUS_RETRY_FILE: path.join(temp, "retry-counter") },
    );
  }
  nativePlaywright(
    "http",
    `import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
test("actual HTTP response", async ({ request }) => {
  const server = createServer((req, res) => { res.writeHead(200); res.end("verified"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { const response = await request.get("http://127.0.0.1:" + server.address().port); expect(await response.text()).toBe("verified"); }
  finally { await new Promise(resolve => server.close(resolve)); }
});`,
  );
  assert.equal(check(0).metrics.passed, 1);
  nativePlaywright(
    "expected-failure",
    'import { test, expect } from "@playwright/test"; test("expected failure", () => { test.fail(); expect(1).toBe(2); });',
  );
  assert.equal(check(1).metrics.skipped, 1);
  nativePlaywright(
    "flaky",
    'import { test, expect } from "@playwright/test"; import fs from "node:fs"; test("retry is visible", () => { const file = process.env.ABACUS_RETRY_FILE; const exists = fs.existsSync(file); fs.writeFileSync(file, "attempted"); expect(exists).toBe(true); });',
  );
  assert.equal(check(1).metrics.flaky, 1);
  nativePlaywright(
    "timed-out",
    'import { test } from "@playwright/test"; test("timeout stays visible", async () => { test.setTimeout(100); await new Promise(() => {}); });',
    1,
  );
  assert.equal(check(1).metrics.timedOut, 2);

  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    fs.copyFileSync(path.join(root, file), path.join(project, file));
  fs.copyFileSync(
    path.join(root, "docs/examples/audit.mjs"),
    path.join(project, "audit-runner.mjs"),
  );
  const auditRaw = path.join(temp, "native-audit-raw.json"),
    auditEvidence = path.join(temp, "native-audit-evidence.json");
  writeConfig({
    id: "native-audit",
    path: auditEvidence,
    format: "pnpm-audit",
    profile: "dependencies",
    required: true,
    enforcement: "block",
  });
  run([
    "verify",
    "--id",
    "native-audit",
    "--profile",
    "dependencies",
    "--format",
    "pnpm-audit",
    "--report",
    auditRaw,
    "--evidence",
    auditEvidence,
    "--",
    process.execPath,
    path.join(project, "audit-runner.mjs"),
    auditRaw,
  ]);
  const audited = check(0);
  assert.equal(audited.metrics.failed, 0);
  assert.ok(audited.scope.scanned > 0);
}
