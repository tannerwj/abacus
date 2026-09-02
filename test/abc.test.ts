import { describe, expect, test } from "vitest";
import { scoreSource } from "../src/abc.js";
import { defaults } from "../src/config.js";

const config = { abc: { budget: 60, allow: {} } };

describe("ABC scoring", () => {
  test("counts assignments, calls and conditions per function; nested functions scored separately", () => {
    const src = `
      export function outer(x: number) {
        let a = 1;           // A
        a += x;              // A
        const b = f(a);      // A + B
        if (a > 2 && b) {    // C (if) + C (>) + C (&&)
          return g();        // B + C (early return)
        }
        const inner = () => h(1) || h(2);  // A (const) — inner scored separately
        return inner();      // B (final return not counted as condition)
      }`;
    const scores = scoreSource("x.ts", src, config);
    const outer = scores.find((s) => s.name === "outer");
    expect(outer).toMatchObject({ a: 4, b: 3, c: 4 });
    expect(outer?.score).toBe(Math.round(Math.hypot(4, 3, 4)));
    const inner = scores.find((s) => s.name === "inner");
    expect(inner).toMatchObject({ a: 0, b: 2, c: 1 });
  });

  test("allow map raises the budget for one named function", () => {
    const src = "export function big() { return a(b(c(d(e(f(g(h())))))))); }";
    const strict = scoreSource("src/x.ts", src, { abc: { budget: 3, allow: {} } })[0];
    expect(strict.score).toBeGreaterThan(strict.budget);
    const allowed = scoreSource("src/x.ts", src, { abc: { budget: 3, allow: { "src/x.ts big": { max: 50, why: "test" } } } })[0];
    expect(allowed.budget).toBe(50);
  });

  test("presets carry sensible defaults", () => {
    expect(defaults("typescript").size.budgets).toEqual([]);
    expect(defaults("cloudflare-worker").size.worker?.max).toBe(400 * 1024);
    expect(defaults("vite-spa").size.budgets.map((b) => b.label)).toHaveLength(3);
  });
});
