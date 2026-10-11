import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { digest } from "../dist/evidence.js";
import { canonicalPolicyJson } from "../dist/canonical-json.js";
import { digestToolchain } from "../dist/lean-runner.js";
import { LEAN_TOOLCHAIN } from "../dist/lean-config.js";

const root = path.resolve(import.meta.dirname, ".."),
  toolchain = process.env.ABACUS_LEAN_TOOLCHAIN,
  toolsOnly = process.argv.includes("--tools-only");
assert.ok(toolchain, "Set ABACUS_LEAN_TOOLCHAIN to the reviewed Lean 4.34.1 distribution");
const bin = path.join(fs.realpathSync(toolchain), "bin"),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-lean-native-")),
  project = path.join(temp, "project"),
  fixtures = path.join(temp, "trusted-fixtures"),
  env = { PATH: `${bin}:/usr/bin:/bin`, HOME: temp, LANG: "C.UTF-8" },
  cli = path.join(root, "dist/cli.js"),
  audit = path.join(root, "configs/lean/Audit.lean");
function run(command, args, cwd = fixtures, extra = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
    ...extra,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
function success(command, args, cwd = fixtures, extra = {}) {
  const result = run(command, args, cwd, extra);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function auditTheorem(module, name) {
  return JSON.parse(
    success(path.join(bin, "lean"), [
      "--run",
      audit,
      path.join(fixtures, ".lake/build/lib/lean"),
      module,
      name,
    ]),
  );
}
function cliRun(args, expected) {
  const result = run(process.execPath, [cli, ...args], project);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
  return result;
}
try {
  fs.cpSync(path.join(root, "test/fixtures/lean"), fixtures, { recursive: true });
  assert.match(success(path.join(bin, "lean"), ["--version"]), /^Lean \(version 4\.34\.1,/u);
  success(path.join(bin, "lake"), [
    "build",
    "+Good",
    "+Sorry",
    "+Custom",
    "+Native",
    "+Changed",
    "+Classical",
    "+Unchecked",
  ]);
  success(path.join(bin, "leanchecker"), ["--fresh", "Good"], fixtures, {
    env: { ...env, LEAN_PATH: path.join(fixtures, ".lake/build/lib/lean") },
  });
  const unchecked = run(path.join(bin, "leanchecker"), ["--fresh", "Unchecked"], fixtures, {
    env: { ...env, LEAN_PATH: path.join(fixtures, ".lake/build/lib/lean") },
  });
  assert.notEqual(unchecked.status, 0);
  assert.match(unchecked.stderr, /declaration type mismatch/u);
  console.log("Fresh kernel replay rejected a proof deliberately accepted with debug.skipKernelTC");
  const good = auditTheorem("Good", "Good.addZero");
  assert.deepEqual(good.axioms, []);
  const goodDigest = digest(canonicalPolicyJson(good.type));
  assert.equal(goodDigest, "f5948842decc4ba8991bf0ff24cfcc0e98a35748630912a59379b30e5aab7a40");
  const changed = auditTheorem("Changed", "Changed.addZero");
  assert.notEqual(digest(canonicalPolicyJson(changed.type)), goodDigest);
  const classical = auditTheorem("Classical", "ClassicalFixture.doubleNegation");
  assert.ok(classical.axioms.length > 0);
  assert.ok(
    classical.axioms.every((axiom) =>
      ["propext", "Classical.choice", "Quot.sound"].includes(axiom),
    ),
  );
  console.log(
    `Native Lean build, fresh kernel replay and audit passed; Good.addZero type digest ${goodDigest}`,
  );
  assert.deepEqual(auditTheorem("Sorry", "Sorry.transitive").axioms, ["sorryAx"]);
  assert.deepEqual(auditTheorem("Custom", "Custom.transitive").axioms, ["Custom.unsupported"]);
  assert.ok(
    auditTheorem("Native", "Native.nativeProof").axioms.some((axiom) => axiom.includes("_native")),
  );
  assert.notEqual(run(path.join(bin, "lake"), ["build", "+Broken"]).status, 0);
  assert.notEqual(
    run(path.join(bin, "lean"), [
      "--run",
      audit,
      path.join(fixtures, ".lake/build/lib/lean"),
      "Good",
      "Good.missing",
    ]).status,
    0,
  );
  assert.notEqual(
    run(path.join(bin, "lean"), [
      "--run",
      audit,
      path.join(fixtures, ".lake/build/lib/lean"),
      "Good",
      "Nat.add_zero",
    ]).status,
    0,
  );
  console.log(
    "Native fixtures detected transitive sorry, custom/native axioms, invalid proof, missing target and wrong declaring module",
  );
  if (!toolsOnly) {
    fs.mkdirSync(project);
    fs.mkdirSync(path.join(project, "src"));
    fs.writeFileSync(path.join(project, "src/index.ts"), "export const fixture = 1;\n");
    fs.cpSync(path.join(root, "test/fixtures/lean"), path.join(project, "proofs"), {
      recursive: true,
    });
    const tools = Object.fromEntries(
      ["lean", "lake", "leanchecker"].map((name) => [
        name,
        digest(fs.readFileSync(path.join(bin, name))),
      ]),
    );
    const lean = {
      project: "proofs",
      specifications: ["proofs/SPECIFICATION.md"],
      toolchain: LEAN_TOOLCHAIN,
      toolchainDigest: digestToolchain(toolchain),
      tools,
      targets: [{ module: "Good", name: "Good.addZero", typeDigest: goodDigest }],
    };
    const report = path.join(temp, "proof-report.json"),
      evidence = path.join(temp, "proof-evidence.json");
    fs.writeFileSync(
      path.join(project, "abacus.config.json"),
      JSON.stringify({
        check: { gates: ["abc"] },
        roots: ["src"],
        verification: {
          reports: [
            {
              id: "lean-model",
              path: evidence,
              format: "lean",
              profile: "formal",
              required: true,
              enforcement: "block",
              environment: "isolated",
              lean,
            },
          ],
        },
      }),
    );
    cliRun(
      [
        "verify",
        "--id",
        "lean-model",
        "--profile",
        "formal",
        "--format",
        "lean",
        "--report",
        report,
        "--evidence",
        evidence,
        "--timeout",
        "900000",
        "--",
        process.execPath,
        cli,
        "lean",
        "--id",
        "lean-model",
        "--report",
        report,
        "--toolchain-dir",
        toolchain,
        "--timeout",
        "600000",
      ],
      0,
    );
    assert.equal(JSON.parse(fs.readFileSync(evidence, "utf8")).issues.length, 0);
    assert.equal(JSON.parse(cliRun(["check", "--json"], 0).stdout).clean, true);
    const configurationPath = path.join(project, "abacus.config.json");
    const configuration = fs.readFileSync(configurationPath, "utf8");
    for (const [module, name] of [
      ["Sorry", "Sorry.transitive"],
      ["Custom", "Custom.transitive"],
      ["Native", "Native.nativeProof"],
      ["Unchecked", "Unchecked.falseProof"],
      ["Changed", "Changed.addZero"],
    ]) {
      const value = JSON.parse(configuration),
        target = auditTheorem(module, name);
      value.verification.reports[0].lean.targets = [
        {
          module,
          name,
          typeDigest: module === "Changed" ? goodDigest : digest(canonicalPolicyJson(target.type)),
        },
      ];
      fs.writeFileSync(configurationPath, JSON.stringify(value));
      const rejectedReport = path.join(temp, `${module}-rejected.json`);
      const rejected = cliRun(
        [
          "lean",
          "--id",
          "lean-model",
          "--report",
          rejectedReport,
          "--toolchain-dir",
          toolchain,
          "--timeout",
          "600000",
        ],
        2,
      );
      assert.match(
        rejected.stderr,
        module === "Unchecked"
          ? /declaration type mismatch/u
          : module === "Changed"
            ? /theorem type changed/u
            : /forbidden axioms/u,
      );
      assert.equal(fs.existsSync(rejectedReport), false);
    }
    fs.writeFileSync(configurationPath, configuration);
    console.log(
      "Shipped isolated runner rejected transitive sorry, custom/native assumptions, unchecked proof and changed theorem type",
    );
    fs.appendFileSync(path.join(project, "proofs/Good.lean"), "\n");
    assert.equal(JSON.parse(cliRun(["check", "--json"], 1).stdout).clean, false);
    console.log(
      "Shipped CLI generated/imported real isolated Lean evidence and rejected stale source",
    );
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
