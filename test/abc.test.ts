import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { reportAbc, scoreProject, scoreSource } from "../src/abc.js";
import { defaults } from "../src/config.js";

const config = { abc: { budget: 60, allow: {} } };

const pickScores = (scores: ReturnType<typeof scoreSource>) => scores.map(({ name, a, b, c, score }) => ({ name, a, b, c, score }));

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

  test.each(["accessors.ts", "accessors.js"])("counts class and object getter/setter bodies in %s", (file) => {
    const src = `
      class Model {
        get value() {
          const value = read();
          if (value > 0) return value;
          return fallback();
        }
        set value(value) {
          this.current = normalize(value);
        }
      }
      const model = {
        get label() { return readLabel(); },
        set label(value) { storeLabel(value); }
      };`;
    expect(scoreSource(file, src, config)).toMatchObject([
      { name: "get value", a: 1, b: 2, c: 3 },
      { name: "set value", a: 1, b: 1, c: 0 },
      { name: "get label", a: 0, b: 1, c: 0 },
      { name: "set label", a: 0, b: 1, c: 0 }
    ]);
  });

  test("scores nested accessors and callbacks separately from enclosing functions", () => {
    const src = `
      function outer() {
        const model = {
          get value() {
            const read = () => nestedRead();
            return read();
          },
          set value(value) { this.current = normalize(value); }
        };
        return consume(model);
      }`;
    expect(scoreSource("nested.ts", src, config)).toMatchObject([
      { name: "outer", a: 1, b: 1, c: 0 },
      { name: "get value", a: 1, b: 1, c: 0 },
      { name: "read", a: 0, b: 1, c: 0 },
      { name: "set value", a: 1, b: 1, c: 0 }
    ]);
  });

  test("getter and setter allow entries are independently addressable", () => {
    const scores = scoreSource("src/model.ts", `class Model {
      get value() { return read(); }
      set value(value) { write(value); }
    }`, { abc: { budget: 1, allow: { "src/model.ts get value": { max: 5, why: "reviewed getter" } } } });
    expect(scores.map(({ name, budget }) => ({ name, budget }))).toEqual([
      { name: "get value", budget: 5 },
      { name: "set value", budget: 1 }
    ]);
  });

  test.each(["class", "object"])("fails the project gate for an over-budget %s accessor", (kind) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-accessor-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fs.mkdirSync(path.join(dir, "src"));
      const accessors = "get value() { return first(second(third())); } set value(value) { first(value); second(value); third(value); }";
      fs.writeFileSync(path.join(dir, "src/model.ts"), kind === "class" ? `class Model { ${accessors} }` : `const model = { ${accessors.replace("} set", "}, set")} };`);
      const strict = defaults("typescript");
      strict.abc.budget = 2;
      expect(reportAbc(strict, 10, dir)).toBe(false);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("2 function(s) over budget"));
      expect(log.mock.calls.flat().join("\n")).toContain("get value");
      expect(log.mock.calls.flat().join("\n")).toContain("set value");
    } finally {
      log.mockRestore();
      error.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(["js", "mjs", "cjs"])("scores .%s with the same semantics as the TypeScript twin", (ext) => {
    const tsSrc = `
      export function outer(x: number) {
        let a = 1;
        a += x;
        const b = f(a);
        if (a > 2 && b) {
          return g();
        }
        const inner = () => h(1) || h(2);
        return inner();
      }`;
    const jsSrc = `
      export function outer(x) {
        let a = 1;
        a += x;
        const b = f(a);
        if (a > 2 && b) {
          return g();
        }
        const inner = () => h(1) || h(2);
        return inner();
      }`;
    expect(pickScores(scoreSource(`x.${ext}`, jsSrc, config))).toEqual(pickScores(scoreSource("x.ts", tsSrc, config)));
    expect(pickScores(scoreSource(`x.${ext}`, jsSrc, config))).toMatchObject([{ name: "outer", a: 4, b: 3, c: 4 }, { name: "inner", a: 0, b: 2, c: 1 }]);
  });

  test("scores CommonJS shapes in .cjs files", () => {
    const src = `
      const { read } = require("./store");
      function load(id) {
        const row = read(id);
        if (!row) return null;
        return row;
      }
      module.exports = { load };`;
    const scores = scoreSource("store.cjs", src, config);
    const load = scores.find((s) => s.name === "load");
    expect(load).toMatchObject({ a: 1, b: 1, c: 3 });
    expect(scores).toHaveLength(1);
  });

  test("project discovery scores .js, .mjs and .cjs files alongside TypeScript", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-js-discovery-"));
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src/esm.js"), "export function fromJs() { return go(); }");
      fs.writeFileSync(path.join(dir, "src/mod.mjs"), "export function fromMjs() { return go(); }");
      fs.writeFileSync(path.join(dir, "src/cjs.cjs"), "function fromCjs() { return go(); }\nmodule.exports = { fromCjs };");
      fs.writeFileSync(path.join(dir, "src/ts.ts"), "export function fromTs() { return go(); }");
      const { scores, files } = scoreProject(defaults("typescript"), dir);
      expect(files).toBe(4);
      expect(scores.map((s) => s.name).sort()).toEqual(["fromCjs", "fromJs", "fromMjs", "fromTs"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails the project gate for an over-budget JavaScript function", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-js-gate-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src/big.js"), "export function big() { return a(b(c(d(e(f(g(h()))))))); }");
      const strict = defaults("typescript");
      strict.abc.budget = 3;
      expect(reportAbc(strict, 10, dir)).toBe(false);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("1 function(s) over budget"));
      expect(log.mock.calls.flat().join("\n")).toContain("big");
    } finally {
      log.mockRestore();
      error.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("presets carry sensible defaults", () => {
    expect(defaults("typescript").size.budgets).toEqual([]);
    expect(defaults("cloudflare-worker").size.worker?.max).toBe(400 * 1024);
    expect(defaults("vite-spa").size.budgets.map((b) => b.label)).toHaveLength(3);
  });
});
