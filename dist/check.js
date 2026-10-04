import { spawnSync } from "node:child_process";
import { reportAbc } from "./abc.js";
import { SOURCE_GATES, validateCheckGates } from "./config.js";
import { reportCycles } from "./cycles.js";
import { reportDeadcode } from "./deadcode.js";
import { reportDupes } from "./dupes.js";
import { localBin, reportRatchet } from "./ratchet.js";
import { reportSecrets } from "./secrets.js";
import { reportSize } from "./size.js";
import { reportTodos } from "./todos.js";
import { reportTsc } from "./tsc.js";
/** Run every selected gate, including after a failure, to show the whole result. */
export function runGates(gates, runners) {
    let clean = true;
    for (const gate of validateCheckGates(gates)) {
        console.log(`\nChecking ${gate}…`);
        try {
            if (!runners[gate]())
                clean = false;
        }
        catch (error) {
            console.error(`${gate} failed: ${error instanceof Error ? error.message : String(error)}`);
            clean = false;
        }
    }
    return clean;
}
export function reportCheck(config, gates = config.check.gates, cwd = process.cwd(), top = 10) {
    const selected = validateCheckGates(gates);
    const skipped = SOURCE_GATES.filter((gate) => !selected.includes(gate));
    if (skipped.length)
        console.log(`Gates not selected: ${skipped.join(", ")}. Opt in with check.gates or abacus check --all.`);
    if (!selected.includes("size"))
        console.log("Size is a post-build gate: abacus size or abacus check --with-size after building.");
    return runGates(selected, {
        lint: () => spawnSync(localBin("oxlint", cwd), ["--type-aware", "."], { cwd, stdio: "inherit" }).status === 0,
        abc: () => reportAbc(config, top, cwd),
        ratchet: () => reportRatchet(config, false, cwd),
        tsc: () => reportTsc(cwd),
        deadcode: () => reportDeadcode(cwd),
        secrets: () => reportSecrets(cwd),
        cycles: () => reportCycles(cwd),
        dupes: () => reportDupes(cwd),
        todos: () => reportTodos(cwd),
        size: () => reportSize(config, cwd),
    });
}
