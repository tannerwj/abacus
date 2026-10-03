import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTodoLine, reportTodos, runTodos, sourceFiles } from "../src/todos.js";

function makeFixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-todos-test-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("todos gate", () => {
  test("parseTodoLine extracts kind and date", () => {
    expect(parseTodoLine("// TODO(2026-12-01): refactor this")).toEqual({ kind: "TODO", date: "2026-12-01" });
    expect(parseTodoLine("// FIXME: 2025-01-15 broken")).toEqual({ kind: "FIXME", date: "2025-01-15" });
    expect(parseTodoLine("// HACK[2026-06-30] workaround")).toEqual({ kind: "HACK", date: "2026-06-30" });
    expect(parseTodoLine("// TODO: no date here")).toEqual({ kind: "TODO", date: null });
    expect(parseTodoLine("const x = 1;")).toBeNull();
  });

  test("sourceFiles finds source files, skips node_modules/dist", () => {
    const dir = makeFixture({
      "src/a.ts": "const x = 1;\n",
      "src/b.js": "const y = 2;\n",
      "node_modules/pkg/index.js": "const z = 3;\n",
      "dist/a.js": "const w = 4;\n",
      "README.md": "# hi\n",
    });
    try {
      const files = sourceFiles(dir);
      expect(files.map((f) => path.relative(dir, f)).sort()).toEqual(["src/a.ts", "src/b.js"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runTodos fails on expired dates, passes on future/undated", () => {
    const dir = makeFixture({
      "src/a.ts": "// TODO(2000-01-01): long overdue\nconst x = 1;\n",
      "src/b.ts": "// TODO(2999-12-31): far future\n// FIXME: no date\nconst y = 2;\n",
    });
    try {
      const result = runTodos(dir);
      expect(result.clean).toBe(false);
      expect(result.expired.length).toBe(1);
      expect(result.expired[0].file).toBe("src/a.ts");
      expect(result.expired[0].date).toBe("2000-01-01");
      expect(result.todos.length).toBe(3);
      expect(reportTodos(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runTodos is clean with no expired dates", () => {
    const dir = makeFixture({
      "src/a.ts": "// TODO(2999-01-01): future\n// TODO: undated\nconst x = 1;\n",
    });
    try {
      const result = runTodos(dir);
      expect(result.clean).toBe(true);
      expect(result.expired).toEqual([]);
      expect(reportTodos(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
