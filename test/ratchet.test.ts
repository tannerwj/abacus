import { jsonObject } from "../src/json-values.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { countLines, measureRatchet, reportRatchet } from "../src/ratchet.js";

const fixture = path.join(import.meta.dirname, "fixtures/ratchet");
const src = fs.readFileSync(path.join(fixture, "src/a.ts"), "utf8");
const dirs: string[] = [];

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-ratchet-"));
  dirs.push(dir);
  fs.cpSync(fixture, dir, { recursive: true });
  const config = loadConfig(dir);
  const snapshotFile = path.join(dir, config.ratchet.file);
  const snapshot = Object.fromEntries(measureRatchet(config, dir).map((metric) => [metric.key, metric.value]));
  return { dir, config, snapshotFile, snapshot };
}

describe("ratchet", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("counts code and comment-only lines; strings and trailing comments are code", () => {
    expect(countLines(src)).toEqual({ code: 5, comment: 3 });
    expect(countLines("")).toEqual({ code: 0, comment: 0 });
  });

  test("measures loc, comment ratio and max ABC from config", () => {
    const metrics = Object.fromEntries(measureRatchet(loadConfig(fixture), fixture).map((m) => [m.key, m]));
    expect(metrics["loc src"]).toMatchObject({ value: 5, slack: 0.1 });
    expect(metrics["comments src"]).toMatchObject({ value: 0.6, max: 0.7 });
    expect(metrics.abcMax.value).toBeGreaterThan(0);
  });

  test("normal checks reject missing and deleted snapshots without recreating them", () => {
    const { dir, config, snapshotFile } = project();
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.existsSync(snapshotFile)).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--write"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--update"));
    expect(reportRatchet(config, true, dir)).toBe(true);
    fs.unlinkSync(snapshotFile);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.existsSync(snapshotFile)).toBe(false);
  });

  test.each(["", "{}", "[]", "null", "0", "true", '"baseline"', '{"metrics":{}}', "not json"])("rejects an empty or invalid snapshot without modifying it: %s", (contents) => {
    const { dir, config, snapshotFile } = project();
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
  });

  test.each(["loc src", "comments src", "abcMax"])("rejects a snapshot missing enabled metric %s without modifying it", (key) => {
    const { dir, config, snapshotFile, snapshot } = project();
    delete snapshot[key];
    const contents = JSON.stringify(snapshot);
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(key));
  });

  test("rejects a newly enabled oxlint metric before running oxlint", () => {
    const { dir, config, snapshotFile, snapshot } = project();
    config.ratchet.metrics.oxlintWarnings = true;
    const contents = JSON.stringify(snapshot);
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("oxlintWarnings"));
  });

  test("rejects newly enabled roots missing from the snapshot", () => {
    const { dir, config, snapshotFile, snapshot } = project();
    config.ratchet.metrics.loc?.roots.push("scripts");
    config.ratchet.metrics.comments?.roots.push("scripts");
    const contents = JSON.stringify(snapshot);
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("loc scripts, comments scripts"));
  });

  test.each([null, "5", -1, {}, []].map((value) => ({ value })))("rejects invalid metric values without modifying the snapshot: %j", ({ value }) => {
    const { dir, config, snapshotFile, snapshot } = project();
    const contents = JSON.stringify({ ...snapshot, "loc src": value });
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
  });

  test("rejects nonfinite numbers parsed from JSON without modifying the snapshot", () => {
    const { dir, config, snapshotFile, snapshot } = project();
    const contents = JSON.stringify(snapshot).replace('"loc src":5', '"loc src":1e400');
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
  });

  test.each(["loc src", "comments src", "abcMax"])("enforces a zero baseline for %s without substituting the current measurement", (key) => {
    const { dir, config, snapshotFile, snapshot } = project();
    const contents = JSON.stringify({ ...snapshot, [key]: 0 });
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("over the ratchet"));
  });

  test("rejects configurations with no enabled metrics in check and write modes", () => {
    const { dir, config, snapshotFile } = project();
    config.ratchet.metrics = {};
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(reportRatchet(config, true, dir)).toBe(false);
    expect(fs.existsSync(snapshotFile)).toBe(false);
    config.ratchet.metrics = { loc: { roots: [] }, comments: { roots: [] }, abcMax: false, oxlintWarnings: false };
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(reportRatchet(config, true, dir)).toBe(false);
    expect(fs.existsSync(snapshotFile)).toBe(false);
    fs.writeFileSync(snapshotFile, "{}");
    expect(reportRatchet(config, false, dir)).toBe(false);
    expect(reportRatchet(config, true, dir)).toBe(false);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe("{}");
  });

  test("a complete snapshot passes without modification", () => {
    const { dir, config, snapshotFile, snapshot } = project();
    const contents = JSON.stringify({ ...snapshot, "retired metric": 12 });
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, false, dir)).toBe(true);
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(contents);
  });

  test.each(["{}", '{"loc src":1}', "not json"])("explicit writes replace empty, incomplete or invalid snapshots: %s", (contents) => {
    const { dir, config, snapshotFile, snapshot } = project();
    fs.writeFileSync(snapshotFile, contents);
    expect(reportRatchet(config, true, dir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(snapshotFile, "utf8"))).toEqual(snapshot);
    expect(reportRatchet(config, false, dir)).toBe(true);
  });

  test("explicit writes create the snapshot; growth past slack or fixed max fails; shrink passes", () => {
    const { dir, config, snapshotFile } = project();
    expect(reportRatchet(config, true, dir)).toBe(true);
    const written = jsonObject(fs.readFileSync(snapshotFile, "utf8"));
    expect(written["loc src"]).toBe(5);

    const tooSmall = JSON.stringify({ ...written, "loc src": 4 });
    fs.writeFileSync(snapshotFile, tooSmall);
    expect(reportRatchet(config, false, dir)).toBe(false); // 5 > 4 * 1.1
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(tooSmall);
    fs.writeFileSync(snapshotFile, JSON.stringify(written));
    const strict = { ...config, ratchet: { ...config.ratchet, metrics: { ...config.ratchet.metrics, comments: { roots: ["src"], max: 0.5 } } } };
    expect(reportRatchet(strict, false, dir)).toBe(false); // 0.6 > fixed max 0.5, even with a matching snapshot
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(JSON.stringify(written));
    fs.writeFileSync(snapshotFile, JSON.stringify({ ...written, "loc src": 9 }));
    expect(reportRatchet(config, false, dir)).toBe(true); // shrink: "ratchet down available"
    expect(reportRatchet(config, true, dir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(snapshotFile, "utf8"))["loc src"]).toBe(5);
    expect(reportRatchet(strict, true, dir)).toBe(false); // explicit writes still obey fixed max ceilings
  });
});
