import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computePolicyPackDigest } from "../src/policy.js";

const count = 5000;
const cli = path.resolve("dist/cli.js");
const at = "2026-10-04T09:50:00Z";
function pinned(cwd: string, name: string, enforcement: "block" | "observe"): string {
  const pack = `${name}.json`, pin = `${name}-pin.json`;
  fs.writeFileSync(path.join(cwd, pack), JSON.stringify({ schemaVersion: 1, name: "pipe-output", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "todos", gate: "todos", required: true, enforcement, severity: "warning", rationale: "Verify complete piped evidence" }] }));
  fs.writeFileSync(path.join(cwd, pin), JSON.stringify({ path: pack, version: "1.0.0", digest: computePolicyPackDigest(path.join(cwd, pack)) }));
  return pin;
}
function piped(cwd: string, args: string[], expected: number): string {
  const result = spawnSync(process.execPath, [cli, ...args, "--at", at], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(expected);
  expect(result.stderr).toBe("");
  expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(512 * 1024);
  expect(result.stdout.endsWith("}\n")).toBe(true);
  return result.stdout;
}

describe("CLI pipe lifecycle", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-cli-output-"));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src/index.ts"), Array.from({ length: count }, (_, index) => `// TODO(2000-01-01) pipe fixture ${index + 1}`).join("\n") + "\n");
    fs.writeFileSync(path.join(cwd, "abacus.config.json"), JSON.stringify({ check: { gates: ["todos"] } }));
  });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  test("failed check drains every JSON finding before its nonzero exit", () => {
    const result = JSON.parse(piped(cwd, ["check", "--json"], 1));
    expect(result.clean).toBe(false);
    expect(result.checks[0].outcome).toBe("fail");
    expect(result.checks[0].findings).toHaveLength(count);
    expect(result.checks[0].counts.active).toBe(count);
    expect(result.checks[0].findings.at(-1).subject).toContain(`:${count}`);
  });

  test("successful advisory preview drains both full evidence manifests", () => {
    const from = pinned(cwd, "blocking", "block"), to = pinned(cwd, "advisory", "observe");
    const result = JSON.parse(piped(cwd, ["preview", "--from", from, "--to", to, "--json"], 0));
    expect(result.preview.cleanBefore).toBe(false);
    expect(result.preview.cleanAfter).toBe(true);
    expect(result.before.checks[0].findings).toHaveLength(count);
    expect(result.after.checks[0].findings).toHaveLength(count);
    expect(result.after.checks[0].findings.at(-1).subject).toContain(`:${count}`);
  });
});
