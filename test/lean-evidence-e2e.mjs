import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { digest } from "../dist/evidence.js";
import { leanConfigurationDigest, LEAN_TOOLCHAIN } from "../dist/lean-config.js";
import { leanInputs } from "../dist/lean-inputs.js";
import { parseVerificationReport } from "../dist/verification-reports.js";

const root = path.resolve(import.meta.dirname, ".."),
  cli = process.env.ABACUS_TEST_CLI ?? path.join(root, "dist/cli.js");
const { leanAdapterDigest } = await import(
  pathToFileURL(path.join(path.dirname(cli), "lean-adapter.js"))
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-lean-evidence-")),
  project = path.join(temp, "consumer");
const hash = "1".repeat(64),
  otherHash = "2".repeat(64);
const lean = {
  project: "proofs",
  specifications: ["docs/contract.md"],
  toolchain: LEAN_TOOLCHAIN,
  toolchainDigest: hash,
  tools: { lean: hash, lake: hash, leanchecker: hash },
  targets: [{ module: "Model", name: "Model.identity", typeDigest: hash }],
};
let sequence = 0;
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  fs.writeFileSync(path.join(project, file), text);
};
const run = (args, expected = 0) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const check = (expected = 0, json = true) => {
  const result = run(["check", ...(json ? ["--json"] : [])], expected);
  return json ? JSON.parse(result).checks.find((item) => item.gate === "verification") : result;
};
function makeReport() {
  return {
    schemaVersion: 1,
    kind: "lean",
    claim: "model",
    configurationDigest: leanConfigurationDigest(lean),
    adapterDigest: leanAdapterDigest(),
    toolchain: lean.toolchain,
    toolchainDigest: lean.toolchainDigest,
    tools: lean.tools,
    inputs: leanInputs(lean, project),
    targets: lean.targets.map((target) => ({
      ...target,
      axioms: ["propext"],
      checked: true,
      rechecked: true,
    })),
  };
}
function record(change = () => {}, expected = 0, mode = "normal") {
  const prefix = path.join(temp, String(sequence++)),
    report = `${prefix}-report.json`,
    evidence = `${prefix}-evidence.json`;
  const spec = {
    id: "formal-model",
    path: evidence,
    format: "lean",
    profile: "formal",
    required: true,
    enforcement: "warn",
    environment: "isolated",
    lean,
  };
  write(
    "abacus.config.json",
    JSON.stringify({
      roots: ["src"],
      check: { gates: ["abc"] },
      provenance: { exclude: ["^docs/", "^proofs/", "^abacus.config.json$"] },
      verification: { reports: [spec] },
    }),
  );
  const value = makeReport();
  change(value);
  const input = `${prefix}-input.json`;
  fs.writeFileSync(input, JSON.stringify(value));
  run(
    [
      "verify",
      "--id",
      spec.id,
      "--profile",
      "formal",
      "--format",
      "lean",
      "--report",
      report,
      "--evidence",
      evidence,
      ...(mode === "hang" ? ["--timeout", "100"] : []),
      "--",
      process.execPath,
      "producer.mjs",
      input,
      report,
      mode,
    ],
    expected,
  );
  return { report, evidence, spec };
}
function incomplete() {
  assert.notEqual(check(1).coverage.status, "complete");
  check(1, false);
}
try {
  write("src/index.ts", "export const value = 1;\n");
  write(
    "proofs/Model.lean",
    "namespace Model\ntheorem identity (n : Nat) : n = n := rfl\nend Model\n",
  );
  write("proofs/lean-toolchain", `${LEAN_TOOLCHAIN}\n`);
  write("proofs/lakefile.toml", 'name = "Model"\n[[lean_lib]]\nname = "Model"\n');
  write(
    "proofs/lake-manifest.json",
    '{"version":"1.1.0","packagesDir":".lake/packages","packages":[],"name":"Model","lakeDir":".lake"}\n',
  );
  write("docs/contract.md", "Fixture model identity; not application behavior.\n");
  write(
    "producer.mjs",
    'import fs from "node:fs"; const [input, output, mode] = process.argv.slice(2); if (mode === "hang") setInterval(() => {}, 1000); else if (mode !== "missing") { fs.copyFileSync(input, output); if (mode === "exit") process.exitCode = 1; }\n',
  );
  record();
  assert.equal(check().outcome, "pass");
  check(0, false);
  for (const axiom of ["sorryAx", "Untrusted.assumption", "Lean.trustCompiler", "_native.test"]) {
    record((value) => value.targets[0].axioms.push(axiom), 1);
    incomplete();
  }
  for (const change of [
    (value) => {
      value.targets = [];
    },
    (value) => {
      value.inputs = [];
    },
    (value) => {
      value.targets[0].rechecked = false;
    },
    (value) => {
      value.targets[0].checked = false;
    },
    (value) => {
      value.claim = "implementation";
    },
    (value) => {
      value.toolchain = "leanprover/lean4:nightly";
    },
    (value) => {
      value.unrecognized = true;
    },
  ]) {
    record(change, 1);
    incomplete();
  }
  for (const change of [
    (value) => {
      value.targets[0].name = "Model.missing";
    },
    (value) => {
      value.targets[0].typeDigest = otherHash;
    },
    (value) => {
      value.targets.push({ ...value.targets[0], name: "Model.extra" });
    },
    (value) => {
      value.configurationDigest = otherHash;
    },
    (value) => {
      value.adapterDigest = otherHash;
    },
    (value) => {
      value.toolchainDigest = otherHash;
    },
    (value) => {
      value.tools.lean = otherHash;
    },
    (value) => {
      value.inputs[0].digest = otherHash;
    },
  ]) {
    record(change);
    incomplete();
    lean.tools.lean = hash;
  }
  record(() => {}, 1, "hang");
  incomplete();
  record(() => {}, 1, "missing");
  incomplete();
  record(() => {}, 1, "exit");
  incomplete();
  let saved = record();
  fs.unlinkSync(saved.evidence);
  incomplete();
  saved = record();
  const envelope = JSON.parse(fs.readFileSync(saved.evidence));
  envelope.startedAt = "2000-01-01T00:00:00.000Z";
  envelope.finishedAt = envelope.startedAt;
  fs.writeFileSync(saved.evidence, JSON.stringify(envelope));
  incomplete();
  record();
  write("docs/contract.md", "Changed independently excluded specification.\n");
  incomplete();
  record();
  write("proofs/Model.lean", "namespace Model\ntheorem identity : True := True.intro\nend Model\n");
  incomplete();
  record();
  const config = JSON.parse(fs.readFileSync(path.join(project, "abacus.config.json")));
  config.verification.reports[0].lean.targets[0].typeDigest = otherHash;
  write("abacus.config.json", JSON.stringify(config));
  incomplete();
  config.verification.reports[0].lean.targets = [];
  write("abacus.config.json", JSON.stringify(config));
  run(["check", "--json"], 2);
  saved = record();
  const tampered = JSON.parse(fs.readFileSync(saved.report));
  tampered.targets[0].typeDigest = otherHash;
  fs.writeFileSync(saved.report, JSON.stringify(tampered));
  const rebound = JSON.parse(fs.readFileSync(saved.evidence));
  rebound.report.digest = digest(fs.readFileSync(saved.report));
  rebound.summary = parseVerificationReport("lean", tampered);
  fs.writeFileSync(saved.evidence, JSON.stringify(rebound));
  incomplete();
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.test"],
    ["add", "."],
    ["commit", "-qm", "Fixture baseline"],
  ]) {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  write("docs/contract.md", "Reviewer must reconsider this changed definition of intent.\n");
  write("proofs/Model.lean", "namespace Model\ntheorem identity : 1 = 1 := rfl\nend Model\n");
  const standardsConfig = JSON.parse(fs.readFileSync(path.join(project, "abacus.config.json")));
  standardsConfig.verification.reports[0].lean.targets[0].typeDigest = otherHash;
  write("abacus.config.json", JSON.stringify(standardsConfig));
  const standards = JSON.parse(run(["standards", "--base", "HEAD", "--json"]));
  assert.ok(
    standards.changes.some(
      (change) => change.file === "docs/contract.md" && change.classification === "review",
    ),
  );
  assert.ok(
    standards.changes.some(
      (change) => change.file === "proofs/Model.lean" && change.classification === "review",
    ),
  );
  assert.ok(
    standards.changes.some(
      (change) => change.field.endsWith("/targets") && change.classification === "weakening",
    ),
  );
  console.log(
    "Lean adapter CLI evidence: pass, target/type/config/tool/input binding, stale/missing/empty/timeout/unsupported evidence, axiom rejection, advisory fail-closed, plain check",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
