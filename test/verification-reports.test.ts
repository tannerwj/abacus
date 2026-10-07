import { describe, expect, test } from "vitest";
import { parseVerificationReport } from "../src/verification-reports.js";

const vitest = {
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numFailedTestSuites: 0,
  testResults: [
    {
      name: "test/auth.test.ts",
      status: "passed",
      assertionResults: [{ fullName: "rejects another tenant", status: "passed" }],
    },
  ],
};
const playwright = {
  errors: [],
  stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [
    {
      specs: [
        {
          id: "test-1",
          tests: [
            {
              projectName: "chromium",
              status: "expected",
              expectedStatus: "passed",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        },
      ],
    },
  ],
};

describe("verification report parsers", () => {
  test("Vitest counts come from actual assertions and agree with the summary", () => {
    expect(parseVerificationReport("vitest", vitest)).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
    });
    expect(() => parseVerificationReport("vitest", { ...vitest, numTotalTests: 2 })).toThrow(
      "summary disagrees",
    );
  });
  test("suite setup failures cannot disappear behind passing assertion counts", () => {
    expect(
      parseVerificationReport("vitest", { ...vitest, success: false, numFailedTestSuites: 1 }),
    ).toMatchObject({ errors: 1 });
  });
  test("unknown assertion status cannot masquerade as a skipped test", () => {
    const value = structuredClone(vitest);
    value.testResults[0].assertionResults[0].status = "mystery";
    expect(() => parseVerificationReport("vitest", value)).toThrow("assertion status");
  });
  test("Playwright expected failures count as skipped coverage rather than successful behavior", () => {
    const value = structuredClone(playwright);
    value.suites[0].specs[0].tests[0].expectedStatus = "failed";
    value.suites[0].specs[0].tests[0].results[0].status = "failed";
    expect(parseVerificationReport("playwright", value)).toMatchObject({ passed: 0, skipped: 1 });
  });
  test("Playwright retains flaky and timeout attempts even when a retry passed", () => {
    const value = structuredClone(playwright);
    value.stats.expected = 0;
    value.stats.flaky = 1;
    value.suites[0].specs[0].tests[0].status = "flaky";
    value.suites[0].specs[0].tests[0].results.unshift({ status: "timedOut", retry: 0 });
    value.suites[0].specs[0].tests[0].results[1].retry = 1;
    expect(parseVerificationReport("playwright", value)).toMatchObject({
      total: 1,
      passed: 1,
      flaky: 1,
      timedOut: 1,
    });
  });
  test("Playwright missing results and summary mismatches are rejected", () => {
    const value = structuredClone(playwright);
    value.suites[0].specs[0].tests[0].results = [];
    expect(() => parseVerificationReport("playwright", value)).toThrow("no results");
    expect(() =>
      parseVerificationReport("playwright", {
        ...playwright,
        stats: { ...playwright.stats, expected: 2 },
      }),
    ).toThrow("summary disagrees");
  });
  test("contract measurements preserve units and sample counts", () => {
    const result = parseVerificationReport("contract", {
      schemaVersion: 1,
      cases: [
        {
          id: "latency-p95",
          status: "passed",
          measurement: { value: 150, unit: "ms", samples: 100 },
        },
      ],
    });
    expect(result.measurements).toEqual({
      "latency-p95": { value: 150, unit: "ms", samples: 100 },
    });
  });
  test.each([
    {},
    {
      schemaVersion: 1,
      cases: [{ id: "x", status: "passed", measurement: { value: -1, unit: "ms", samples: 1 } }],
    },
    {
      schemaVersion: 1,
      cases: [
        { id: "x", status: "passed" },
        { id: "x", status: "passed" },
      ],
    },
    {
      schemaVersion: 1,
      cases: [{ id: "x", status: "passed", measurement: { value: 1, unit: "ms", samples: 0 } }],
    },
  ])("malformed contract report fails visibly: %j", (value) => {
    expect(() => parseVerificationReport("contract", value)).toThrow(
      /Unsupported contract schema|Invalid measurement|duplicate contract case/u,
    );
  });
  test("dependency audit requires an actual inventory and preserves vulnerability counts", () => {
    expect(
      parseVerificationReport("pnpm-audit", {
        advisories: {},
        metadata: {
          dependencies: 12,
          devDependencies: 4,
          optionalDependencies: 0,
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
        },
      }),
    ).toMatchObject({ total: 16, passed: 16, failed: 0 });
    expect(() =>
      parseVerificationReport("pnpm-audit", { error: { message: "registry unavailable" } }),
    ).toThrow("audit unavailable");
  });
  test("names, raw errors and tokens stay out of normalized evidence", () => {
    const value = structuredClone(vitest);
    value.testResults[0].assertionResults[0].fullName = "secret-test-token";
    expect(JSON.stringify(parseVerificationReport("vitest", value))).not.toContain(
      "secret-test-token",
    );
  });
  test("dependency advisory identities survive normalization and contradictory totals fail", () => {
    const value = {
      advisories: { "42": { github_advisory_id: "GHSA-2345-6789-cfgh", severity: "high" } },
      metadata: {
        dependencies: 12,
        devDependencies: 4,
        optionalDependencies: 0,
        totalDependencies: 13,
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
      },
    };
    expect(parseVerificationReport("pnpm-audit", value)).toMatchObject({
      total: 13,
      failed: 1,
      cases: [{ id: "GHSA-2345-6789-cfgh", status: "failed" }],
    });
    expect(() => parseVerificationReport("pnpm-audit", { ...value, advisories: {} })).toThrow(
      "summary disagrees",
    );
  });
});
