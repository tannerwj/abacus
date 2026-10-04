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

  test("root-anchored allowlists use the target cwd and reject nested copies", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-secrets-exact-path-"));
    try {
      expect(dir).not.toBe(process.cwd());
      fs.writeFileSync(path.join(dir, ".gitleaks.toml"), String.raw`[extend]
useDefault = true

[[allowlists]]
condition = "AND"
paths = ['''^test/secrets\.test\.ts$''']
regexTarget = "secret"
regexes = ['''^${FAKE_STRIPE_KEY}$''']
`);
      fs.mkdirSync(path.join(dir, "test"));
      const fixture = `const fake = "${FAKE_STRIPE_KEY}";\n`;
      fs.writeFileSync(path.join(dir, "test/secrets.test.ts"), fixture);
      expect(scanSecrets(dir)).toEqual([]);

      fs.mkdirSync(path.join(dir, "other/test"), { recursive: true });
      fs.writeFileSync(path.join(dir, "other/test/secrets.test.ts"), fixture);
      const findings = scanSecrets(dir);
      expect(findings.map((finding) => finding.file)).toEqual([
        "other/test/secrets.test.ts",
      ]);
      expect(findings[0]).toMatchObject({ line: 1, rule: "stripe-access-token" });
      expect(JSON.stringify(findings)).not.toContain(FAKE_STRIPE_KEY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repository allowlist exempts only the fake key in its exact test file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-secrets-allowlist-"));
    try {
      fs.copyFileSync(new URL("../.gitleaks.toml", import.meta.url), path.join(dir, ".gitleaks.toml"));
      fs.mkdirSync(path.join(dir, "test"));
      fs.writeFileSync(path.join(dir, "test/secrets.test.ts"), `const fake = "${FAKE_STRIPE_KEY}";\n`);
      expect(scanSecrets(dir)).toEqual([]);
      fs.writeFileSync(path.join(dir, "other.js"), `const unexpected = "${FAKE_STRIPE_KEY}";\n`);
      fs.mkdirSync(path.join(dir, "other/test"), { recursive: true });
      fs.writeFileSync(path.join(dir, "other/test/secrets.test.ts"), `const fake = "${FAKE_STRIPE_KEY}";\n`);
      const findings = scanSecrets(dir);
      expect(findings.map((finding) => finding.file).sort()).toEqual([
        "other.js",
        "other/test/secrets.test.ts",
      ].sort());
      expect(JSON.stringify(findings)).not.toContain(FAKE_STRIPE_KEY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
