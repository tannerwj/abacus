import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitleaksBinPath, reportSecrets, scanSecrets } from "../src/secrets.js";

const FAKE_STRIPE_KEY = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-secrets-test-"));
  fs.writeFileSync(path.join(dir, "config.js"), `const key = "${FAKE_STRIPE_KEY}";\n`);
  fs.writeFileSync(path.join(dir, "clean.js"), `const ok = "hello";\n`);
  return dir;
}

describe("secrets gate", () => {
  test("bundled gitleaks binary resolves", () => {
    expect(gitleaksBinPath()).toMatch(/gitleaks(\.exe)?$/);
  });

  test("scanSecrets finds the fake key and never returns its value", () => {
    const dir = makeFixture();
    try {
      const findings = scanSecrets(dir);
      expect(findings.length).toBeGreaterThan(0);
      const stripe = findings.find((f) => f.rule.includes("stripe"));
      expect(stripe).toMatchObject({ file: "config.js", line: 1 });
      // the secret value itself must never leak through our API
      const dumped = JSON.stringify(findings);
      expect(dumped).not.toContain(FAKE_STRIPE_KEY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scanSecrets is clean when there are no secrets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-secrets-test-"));
    try {
      fs.writeFileSync(path.join(dir, "clean.js"), `const ok = "hello";\n`);
      expect(scanSecrets(dir)).toEqual([]);
      expect(reportSecrets(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reportSecrets returns false when findings exist", () => {
    const dir = makeFixture();
    try {
      expect(reportSecrets(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
