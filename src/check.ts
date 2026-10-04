import { SOURCE_GATES, validateCheckGates, type AbacusConfig, type CheckGate } from "./config.js";
import { evaluatePolicy, printEvidence } from "./policy-runner.js";

export type GateRunners = Record<CheckGate, () => boolean>;

/** Compatibility helper for callers supplying their own boolean gates. */
export function runGates(gates: CheckGate[], runners: GateRunners): boolean {
  let clean = true;
  for (const gate of validateCheckGates(gates)) {
    console.log(`\nChecking ${gate}…`);
    try {
      if (!runners[gate]()) clean = false;
    } catch (error) {
      console.error(`${gate} failed: ${error instanceof Error ? error.message : String(error)}`);
      clean = false;
    }
  }
  return clean;
}

export function reportCheck(config: AbacusConfig, gates = config.check.gates, cwd = process.cwd(), _top = 10): boolean {
  const selected = validateCheckGates(gates);
  const skipped = SOURCE_GATES.filter((gate) => !selected.includes(gate));
  if (!config.policy && skipped.length) console.log(`Gates not selected: ${skipped.join(", ")}. Opt in with check.gates or abacus check --all.`);
  if (!selected.includes("size")) console.log("Size is a post-build gate: abacus size or abacus check --with-size after building.");
  const result = evaluatePolicy(config, cwd, { gates: selected });
  printEvidence(result);
  return result.clean;
}
