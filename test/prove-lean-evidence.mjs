import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, ".."),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-lean-mutations-"));
const mutations = [
  { name: "accepting sorryAx", from: '"Quot.sound"]', to: '"Quot.sound", "sorryAx"]' },
  {
    name: "ignoring registered theorem types",
    from: "if (!equivalent(targets, config.targets))",
    to: "if (false)",
  },
];
try {
  fs.cpSync(path.join(root, "dist"), path.join(temp, "dist"), { recursive: true });
  fs.cpSync(path.join(root, "configs"), path.join(temp, "configs"), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(temp, "package.json"));
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(temp, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const file = path.join(temp, "dist/lean-report.js"),
    original = fs.readFileSync(file, "utf8");
  for (const mutation of mutations) {
    assert.ok(original.includes(mutation.from), `Missing mutation target: ${mutation.name}`);
    fs.writeFileSync(file, original.replace(mutation.from, mutation.to));
    try {
      const result = spawnSync(process.execPath, [path.join(root, "test/lean-evidence-e2e.mjs")], {
        cwd: root,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ABACUS_TEST_CLI: path.join(temp, "dist/cli.js") },
      });
      assert.ifError(result.error);
      assert.equal(
        result.status,
        1,
        `CLI regression did not reject ${mutation.name}: ${result.stdout}\n${result.stderr}`,
      );
      assert.match(result.stderr, /AssertionError/u);
      assert.match(result.stderr, /0 !== 1/u);
      console.log(`Lean CLI regression catches restored faulty behavior: ${mutation.name}`);
    } finally {
      fs.writeFileSync(file, original);
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
