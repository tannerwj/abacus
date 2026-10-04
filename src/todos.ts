/**
 * `abacus todos` — expired TODO gate.
 *
 * Scans source files for TODO/FIXME/HACK/XXX comments with dates
 * (TODO(2026-12-01), TODO: 2026-12-01, FIXME[2026-12-01], …) and exits 1
 * when any date is in the past. Undated TODOs are reported but never fail —
 * the gate is about promises with deadlines, not about having a todo list.
 */
import fs from "node:fs";
import path from "node:path";

export interface Todo {
  file: string;
  line: number;
  kind: string;
  text: string;
  date: string | null;
  expired: boolean;
}

export interface TodosResult {
  clean: boolean;
  todos: Todo[];
  expired: Todo[];
}

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b\s*[(:[]?\s*(\d{4}-\d{2}-\d{2})?/i;
const DATE_PATTERN = /(\d{4})-(\d{2})-(\d{2})/;

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
]);

/** Source files to scan: src/ when present, else the cwd (excluding node_modules). Exported for tests. */
export function sourceFiles(cwd = process.cwd()): string[] {
  const roots: string[] = [];
  const src = path.join(cwd, "src");
  roots.push(fs.existsSync(src) && fs.statSync(src).isDirectory() ? src : cwd);

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return files.sort();
}

/** Parse a single line for a TODO comment. Returns null when no TODO found. Exported for tests. */
export function parseTodoLine(line: string): { kind: string; date: string | null } | null {
  const m = TODO_PATTERN.exec(line);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  // Look for a date anywhere after the TODO marker on this line.
  const dateMatch = DATE_PATTERN.exec(line.slice(m.index));
  return { kind, date: dateMatch ? dateMatch[0] : null };
}

function isExpired(dateStr: string, evaluatedAt: string): boolean {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const today = new Date(evaluatedAt);
  if (!Number.isFinite(today.getTime())) throw new Error("Invalid evaluation time");
  today.setUTCHours(0, 0, 0, 0);
  return date < today;
}

export function runTodos(cwd = process.cwd(), evaluatedAt = new Date().toISOString()): TodosResult {
  const todos: Todo[] = [];
  for (const file of sourceFiles(cwd)) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      const parsed = parseTodoLine(line);
      if (!parsed) return;
      const expired = parsed.date ? isExpired(parsed.date, evaluatedAt) : false;
      todos.push({
        file: path.relative(cwd, file),
        line: i + 1,
        kind: parsed.kind,
        text: line.trim().slice(0, 120),
        date: parsed.date,
        expired,
      });
    });
  }
  const expired = todos.filter((t) => t.expired);
  return { clean: expired.length === 0, todos, expired };
}

/** Human-readable report. Returns true when no TODO is past its date. */
export function reportTodos(cwd = process.cwd()): boolean {
  const result = runTodos(cwd);
  if (result.clean) {
    const dated = result.todos.filter((t) => t.date).length;
    console.log(`Todos — ${result.todos.length} todo${result.todos.length === 1 ? "" : "s"} (${dated} dated), none expired.\n`);
    return true;
  }
  console.log(`Todos — ${result.expired.length} expired todo${result.expired.length === 1 ? "" : "s"}:\n`);
  for (const t of result.expired) {
    console.log(`  ${t.file}:${t.line} [${t.date}] ${t.text}`);
  }
  console.log("\nResolve it, or move the date — a deadline that passes silently is a lie.\n");
  return false;
}
