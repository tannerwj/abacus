import { describe, expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectKnipEntry,
  knipBinPath,
  knipConfig,
  parseKnipJson,
  runKnip,
} from "../src/deadcode.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "deadcode");

describe("deadcode gate", () => {
  test("bundled knip binary resolves", () => {
    expect(knipBinPath()).toMatch(/knip\.js$/);
  });

  test("parseKnipJson flattens the JSON report into sorted issues", () => {
    const json = JSON.stringify({
      issues: [
        {
          file: "src/util.ts",
          exports: [{ name: "dead", line: 2, pos: 30 }],
          types: [{ name: "UnusedType", line: 3, pos: 60 }],
          files: [],
        },
        { file: "src/orphan.ts", files: [{ name: "src/orphan.ts" }], exports: [] },
      ],
    });
    const report = parseKnipJson(`some preamble\n${json}`);
    expect(report.issues).toHaveLength(3);
    expect(report.counts).toMatchObject({ exports: 1, types: 1, files: 1 });
    // sorted by type, then file, then line
    expect(report.issues.map((i) => i.name)).toEqual(["dead", "src/orphan.ts", "UnusedType"]);
    expect(report.issues[0]).toMatchObject({ type: "exports", file: "src/util.ts", line: 2 });
  });

  test("parseKnipJson handles a clean report", () => {
    const report = parseKnipJson(JSON.stringify({ issues: [] }));
    expect(report.issues).toEqual([]);
    expect(report.counts).toEqual({});
  });

  test("detectKnipEntry reads package.json main plus src/index.ts", () => {
    const entry = detectKnipEntry(fixtureDir);
    expect(entry).toContain("src/index.ts");
    expect(new Set(entry).size).toBe(entry.length); // deduped
  });

  test("knipConfig emits valid JSON with the research-backed defaults", () => {
    const config = JSON.parse(knipConfig(fixtureDir)) as { entry: string[]; ignoreExportsUsedInFile: boolean };
    expect(config.entry).toContain("src/index.ts");
    expect(config.ignoreExportsUsedInFile).toBe(true);
  });

  test("runKnip finds the fixture's dead export, dead type, and orphan file", () => {
    const report = runKnip(fixtureDir);
    const names = report.issues.map((i) => `${i.type}:${i.name}`);
    expect(names).toContain("exports:dead");
    expect(names).toContain("types:UnusedType");
    expect(names).toContain("files:src/orphan.ts");
    // the used export is not flagged
    expect(names).not.toContain("exports:used");
  }, 60_000);
});
