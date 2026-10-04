import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGates, type GateRunners } from "../src/check.js";
import { CHECK_GATES, SOURCE_GATES, defaults, loadConfig } from "../src/config.js";
import { init } from "../src/init.js";

describe("aggregate gate selection", () => {
  test("preserves the default and exposes every opt-in gate", () => {
    expect(defaults("typescript").check.gates).toEqual(["lint", "abc", "ratchet"]);
    expect(SOURCE_GATES).toEqual(["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos"]);
    expect(SOURCE_GATES).not.toContain("size");
  });

  test("runs every selected gate once and carries failures through", () => {
    const calls: string[] = [];
    const run = (gate: typeof CHECK_GATES[number]) => () => {
      calls.push(gate);
      if (gate === "secrets") throw new Error("tool unavailable");
      return gate !== "cycles";
    };
    const runners: GateRunners = {
      lint: run("lint"), abc: run("abc"), ratchet: run("ratchet"), tsc: run("tsc"),
      deadcode: run("deadcode"), secrets: run("secrets"), cycles: run("cycles"),
      dupes: run("dupes"), todos: run("todos"), size: run("size"),
    };
    expect(runGates([...SOURCE_GATES, "todos"], runners)).toBe(false);
    expect(calls).toEqual(SOURCE_GATES);
    expect(runGates(["todos", "size"], runners)).toBe(true);
  });

  test("loads configured gates and rejects unknown or empty gate lists", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-config-"));
    try {
      const file = path.join(cwd, "abacus.config.json");
      fs.writeFileSync(file, JSON.stringify({ check: { gates: ["tsc", "todos", "tsc"] } }));
      expect(loadConfig(cwd).check.gates).toEqual(["tsc", "todos"]);
      for (const gates of [[], ["typo"], "todos"]) {
        fs.writeFileSync(file, JSON.stringify({ check: { gates } }));
        expect(() => loadConfig(cwd)).toThrow("check.gates");
      }
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe("init gate wiring", () => {
  test("adds aggregate and individual scripts without overwriting existing ones", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-init-"));
    try {
      const file = path.join(cwd, "package.json");
      fs.writeFileSync(file, JSON.stringify({ scripts: { check: "existing-check", test: "existing-test" } }));
      init("typescript", cwd, { all: true });
      expect(loadConfig(cwd).check.gates).toEqual(SOURCE_GATES);
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(pkg.scripts.check).toBe("existing-check");
      expect(pkg.scripts.test).toBe("existing-test");
      for (const gate of ["tsc", "deadcode", "secrets", "cycles", "dupes", "todos"]) expect(pkg.scripts[gate]).toBe(`abacus ${gate}`);
      const before = fs.readFileSync(path.join(cwd, "abacus.config.json"), "utf8");
      init("typescript", cwd);
      expect(fs.readFileSync(path.join(cwd, "abacus.config.json"), "utf8")).toBe(before);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  test("default init explicitly selects the existing core gates", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-init-"));
    try {
      fs.writeFileSync(path.join(cwd, "package.json"), "{}");
      init("typescript", cwd);
      expect(loadConfig(cwd).check.gates).toEqual(["lint", "abc", "ratchet"]);
      expect(JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).scripts.check).toBe("abacus check");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});
