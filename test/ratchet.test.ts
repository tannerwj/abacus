import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { countLines, measureRatchet, reportRatchet } from "../src/ratchet.js";

const fixture = path.join(import.meta.dirname, "fixtures/ratchet");
const src = fs.readFileSync(path.join(fixture, "src/a.ts"), "utf8");

describe("ratchet", () => {
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

  test("first run writes the snapshot; growth past slack or fixed max fails; shrink passes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-ratchet-"));
    fs.cpSync(fixture, dir, { recursive: true });
    const config = loadConfig(dir);
    const snapshotFile = path.join(dir, "abacus.ratchet.json");
    expect(reportRatchet(config, false, dir)).toBe(true);
    const written = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<string, number>;
    expect(written["loc src"]).toBe(5);

    fs.writeFileSync(snapshotFile, JSON.stringify({ ...written, "loc src": 4 }));
    expect(reportRatchet(config, false, dir)).toBe(false); // 5 > 4 * 1.1
    fs.writeFileSync(snapshotFile, JSON.stringify(written));
    const strict = { ...config, ratchet: { ...config.ratchet, metrics: { ...config.ratchet.metrics, comments: { roots: ["src"], max: 0.5 } } } };
    expect(reportRatchet(strict, false, dir)).toBe(false); // 0.6 > fixed max 0.5, even with a matching snapshot
    fs.writeFileSync(snapshotFile, JSON.stringify({ ...written, "loc src": 9 }));
    expect(reportRatchet(config, false, dir)).toBe(true); // shrink: "ratchet down available"
    expect(reportRatchet(config, true, dir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(snapshotFile, "utf8"))["loc src"]).toBe(5);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
