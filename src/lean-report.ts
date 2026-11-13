import { leanAdapterDigest } from "./lean-adapter.js";
import { canonicalPolicyJson } from "./canonical-json.js";
import { arrayValue, stringValue } from "./json-values.js";
import {
  LEAN_TOOLCHAIN,
  leanConfigurationDigest,
  leanFields,
  leanHash,
  leanName,
  leanPath,
  leanTools,
  leanUnique,
  type LeanConfig,
  type LeanTarget,
} from "./lean-config.js";
import { leanInputs, type LeanInput } from "./lean-inputs.js";
import type { VerificationSummary } from "./verification-reports.js";

const STANDARD_AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);
export interface LeanCheckedTarget extends LeanTarget {
  axioms: string[];
  checked: true;
  rechecked: true;
}
export interface LeanReport {
  schemaVersion: 1;
  kind: "lean";
  claim: "model";
  configurationDigest: string;
  adapterDigest: string;
  toolchain: typeof LEAN_TOOLCHAIN;
  toolchainDigest: string;
  tools: LeanConfig["tools"];
  inputs: LeanInput[];
  targets: LeanCheckedTarget[];
}
function checkedTarget(value: unknown): LeanCheckedTarget {
  const raw = leanFields(value, ["module", "name", "typeDigest", "axioms", "checked", "rechecked"]);
  const axioms = arrayValue(raw.axioms).map(stringValue);
  leanUnique(axioms);
  if (raw.checked !== true || raw.rechecked !== true)
    throw new Error("Lean checking is incomplete");
  if (axioms.some((axiom) => !STANDARD_AXIOMS.has(axiom)))
    throw new Error("Lean theorem depends on an unsupported axiom");
  return {
    module: leanName(raw.module),
    name: leanName(raw.name),
    typeDigest: leanHash(raw.typeDigest),
    axioms,
    checked: true,
    rechecked: true,
  };
}
export function parseLeanReport(value: unknown): LeanReport {
  const raw = leanFields(value, [
    "schemaVersion",
    "kind",
    "claim",
    "configurationDigest",
    "adapterDigest",
    "toolchain",
    "toolchainDigest",
    "tools",
    "inputs",
    "targets",
  ]);
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "lean" ||
    raw.claim !== "model" ||
    raw.toolchain !== LEAN_TOOLCHAIN
  )
    throw new Error("Unsupported Lean report identity or assurance claim");
  const inputs = arrayValue(raw.inputs).map((item) => {
    const input = leanFields(item, ["path", "digest"]);
    return { path: leanPath(input.path), digest: leanHash(input.digest) };
  });
  const targets = arrayValue(raw.targets).map(checkedTarget);
  if (!inputs.length || !targets.length) throw new Error("Empty Lean evidence");
  leanUnique(inputs.map((input) => input.path));
  leanUnique(targets.map((target) => target.name));
  return {
    schemaVersion: 1,
    kind: "lean",
    claim: "model",
    configurationDigest: leanHash(raw.configurationDigest),
    adapterDigest: leanHash(raw.adapterDigest),
    toolchain: LEAN_TOOLCHAIN,
    toolchainDigest: leanHash(raw.toolchainDigest),
    tools: leanTools(raw.tools),
    inputs,
    targets,
  };
}
export function leanSummary(value: unknown): VerificationSummary {
  const report = parseLeanReport(value);
  return {
    total: report.targets.length,
    passed: report.targets.length,
    failed: 0,
    skipped: 0,
    flaky: 0,
    timedOut: 0,
    errors: 0,
    cases: report.targets.map((target) => ({ id: target.name, status: "passed" })),
    measurements: {},
    limitations: [
      "Lean proves the registered formal model; it does not establish that the specification expresses approved intent or that the TypeScript implementation refines it",
      "Evidence trusts the explicit runner and artifact storage; hashes bind inputs but are not a signed attestation or a hostile-proof defense",
      "Only pinned Lean standard-library projects and standard logical axioms are supported; arbitrary dependencies and native-evaluation assumptions are rejected",
    ],
  };
}
function equivalent(a: unknown, b: unknown): boolean {
  return canonicalPolicyJson(a) === canonicalPolicyJson(b);
}
export function validateLeanEvidence(value: unknown, config: LeanConfig, cwd: string): void {
  const report = parseLeanReport(value);
  if (
    report.adapterDigest !== leanAdapterDigest() ||
    report.toolchainDigest !== config.toolchainDigest ||
    report.configurationDigest !== leanConfigurationDigest(config) ||
    !equivalent(report.tools, config.tools)
  )
    throw new Error("Lean configuration or tool identity changed");
  const targets = report.targets.map(({ module, name, typeDigest }) => ({
    module,
    name,
    typeDigest,
  }));
  if (!equivalent(targets, config.targets)) throw new Error("Lean theorem registration changed");
  if (!equivalent(report.inputs, leanInputs(config, cwd)))
    throw new Error("Lean specification or proof inputs changed");
}
