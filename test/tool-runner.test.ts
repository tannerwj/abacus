import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { nodeToolBinPath, runNodeTool } from "../src/tool-runner.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abacus tools % spaces &-"));
  tempDirs.push(dir);
  return dir;
}

function installTool(root: string, bin: string | Record<string, string>): string {
  const dir = path.join(root, "node_modules", "test-tool");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "test-tool",
    main: "library.cjs",
    exports: { ".": { import: "./library.cjs" } },
    bin,
  }));
  return dir;
}

function writeCli(dir: string, filename: string): string {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n");
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Node tool runner", () => {
  test("uses the project's declared command, ignoring Unix and Windows shims and main", () => {
    const root = tempDir();
    const project = path.join(root, "project");
    const bundled = path.join(root, "abacus");
    const projectTool = installTool(project, { "test-tool": "cli.cjs", other: "other.cjs" });
    const cli = writeCli(projectTool, "cli.cjs");
    writeCli(projectTool, "other.cjs");
    fs.writeFileSync(path.join(projectTool, "library.cjs"), "throw new Error('not the CLI');\n");
    const bundledTool = installTool(bundled, { "test-tool": "bundled.cjs" });
    writeCli(bundledTool, "bundled.cjs");
    const shimDir = path.join(project, "node_modules", ".bin");
    fs.mkdirSync(shimDir);
    fs.writeFileSync(path.join(shimDir, "test-tool"), "#!/bin/sh\nexit 99\n");
    fs.writeFileSync(path.join(shimDir, "test-tool.cmd"), "@ECHO OFF\r\nEXIT /B 99\r\n");
    const moduleUrl = pathToFileURL(path.join(bundled, "dist", "tool-runner.js")).href;
    const bin = nodeToolBinPath("test-tool", "test-tool", project, moduleUrl);
    expect(bin).toBe(cli);
    expect(runNodeTool(bin, [], project).status).toBe(0);
  });

  test("finds a workspace installation from a nested project", () => {
    const root = tempDir();
    const tool = installTool(root, { "test-tool": "cli.cjs" });
    const cli = writeCli(tool, "cli.cjs");
    const cwd = path.join(root, "packages", "app", "src");
    fs.mkdirSync(cwd, { recursive: true });
    expect(nodeToolBinPath("test-tool", "test-tool", cwd)).toBe(cli);
  });

  test("resolves a bundled package's string bin through encoded module URLs", () => {
    const root = tempDir();
    const project = path.join(root, "project");
    fs.mkdirSync(project);
    const bundled = path.join(root, "abacus with % spaces");
    const cli = writeCli(installTool(bundled, "cli.cjs"), "cli.cjs");
    const moduleUrl = pathToFileURL(path.join(bundled, "dist", "tool-runner.js")).href;
    expect(nodeToolBinPath("test-tool", "test-tool", project, moduleUrl)).toBe(cli);
  });

  test("runs paths and arguments containing spaces and shell syntax literally", () => {
    const dir = tempDir();
    const bin = writeCli(dir, "cli % spaces &.cjs");
    const marker = path.join(dir, "injected");
    const args = ["two words", `$(touch '${marker}')`, `; touch '${marker}'`, "& echo unexpected", "%PATH%", '"quoted"'];
    const out = runNodeTool(bin, args, dir);
    expect(out.error).toBeUndefined();
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ args, cwd: fs.realpathSync(dir) });
    expect(fs.existsSync(marker)).toBe(false);
  });

  test("fails if the installed package does not declare the requested command", () => {
    const root = tempDir();
    installTool(root, { other: "other.cjs" });
    expect(() => nodeToolBinPath("test-tool", "test-tool", root)).toThrow("no test-tool bin entry");
  });

  test("fails if the declared CLI is absent", () => {
    const root = tempDir();
    installTool(root, "missing.cjs");
    expect(() => nodeToolBinPath("test-tool", "test-tool", root)).toThrow("test-tool bin not found");
  });

  test("fails if neither the project nor Abacus has the package", () => {
    const root = tempDir();
    const moduleUrl = pathToFileURL(path.join(root, "dist", "tool-runner.js")).href;
    expect(() => nodeToolBinPath("abacus-missing-tool", "missing", root, moduleUrl)).toThrow("no missing found");
  });
});
