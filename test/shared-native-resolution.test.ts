import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { computePolicyPackDigest, type PolicyPack } from "../src/policy.js";

let cwd: string;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-shared-resolution-")); fs.mkdirSync(path.join(cwd, "src")); fs.writeFileSync(path.join(cwd, "src/index.ts"), "export const x = 1;"); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

test.each(["tsConfig", "webpackConfig", "babelConfig"])("rejects cwd-relative shared %s inputs instead of claiming unused companions are pinned", (key) => {
  const root = path.join(cwd, "node_modules/review-policy"); fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "policy.json"), config = path.join(root, "native.cjs");
  const companion = key === "tsConfig" ? "tsconfig.json" : `${key}.cjs`;
  fs.writeFileSync(path.join(root, companion), key === "tsConfig" ? '{"compilerOptions":{"strict":true}}' : "module.exports = {};");
  fs.writeFileSync(config, `module.exports = { forbidden: [{ name: "no-cycles", severity: "error", from: {}, to: { circular: true } }], options: { ${key}: { fileName: "./${companion}" } } };`);
  const pack: PolicyPack = { schemaVersion: 1, name: "review-policy", version: "1.0.0", compatibility: { adapterVersion: 1, evidenceSchemaVersion: 1 }, checks: [{ id: "architecture", gate: "architecture", required: true, enforcement: "block", severity: "error", rationale: "The declared native artifact must execute", nativeConfig: "native.cjs", parameters: { architecture: { targets: ["src"] } } }], nativeFiles: [companion] };
  fs.writeFileSync(file, JSON.stringify(pack));
  expect(() => computePolicyPackDigest(file)).toThrow(/shared native resolution-file inputs are unsupported/);
  fs.writeFileSync(path.join(cwd, companion), key === "tsConfig" ? '{"compilerOptions":{"strict":false}}' : "module.exports = { decoy: true };");
  expect(() => computePolicyPackDigest(file)).toThrow(/shared native resolution-file inputs are unsupported/);
});
