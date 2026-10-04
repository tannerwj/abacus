#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { reportAbc } from "./abc.js";
import { loadConfig, SOURCE_GATES } from "./config.js";
import { reportCheck } from "./check.js";
import { reportDeadcode } from "./deadcode.js";
import { reportSecrets } from "./secrets.js";
import { reportTypeScriptProfile } from "./typescript-profile.js";
import { reportCycles } from "./cycles.js";
import { reportDupes } from "./dupes.js";
import { reportTodos } from "./todos.js";
import { init } from "./init.js";
import { localBin, reportRatchet } from "./ratchet.js";
import { reportSize } from "./size.js";
import { computePolicyPackDigest, resolvePolicyPack } from "./policy.js";
import { evaluatePolicy, printEvidence } from "./policy-runner.js";
import { comparePolicyRuns } from "./preview.js";
const [command = "help", ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const HELP = `abacus — quality gates for TypeScript projects

  abacus init [--preset typescript|cloudflare-worker|vite-spa|nextjs] [--all]   write configs and scripts; --all selects every source gate
  abacus abc [--top N]                                                  ABC scores per function vs budget (exit 1 if over)
  abacus size                                                           gzip bundle budgets (run after build)
  abacus ratchet [--write|--update]                                     check committed baseline; explicit flags write/update it
  abacus lint [paths…]                                                  oxlint --type-aware with the repo's .oxlintrc.json
  abacus fmt [--check] [paths…]                                         oxfmt (write by default) with the repo's .oxfmtrc.jsonc
  abacus deadcode                                                       unused exports/files/types/deps via knip (exit 1 if found)
  abacus secrets                                                        leaked credentials via gitleaks (exit 1 if found)
  abacus tsc                                                            tsc --noEmit zero-error gate + strictness audit
  abacus cycles                                                         circular imports via dependency-cruiser (exit 1 if found)
  abacus dupes                                                          copy-paste duplication via jscpd (exit 1 over threshold)
  abacus todos                                                          expired dated TODOs (exit 1 if any past due)
  abacus check [--all] [--with-size]                                    configured check.gates (default lint + abc + ratchet); --all runs every source gate
  abacus check [--json] [--evidence FILE] [--at ISO]                      normalized outcomes, counts and provenance; no baseline changes
  abacus policy-digest --path PACK.json                                 digest a local policy pack and its declared native configs
  abacus preview --from OLD-PIN.json --to NEW-PIN.json [--json]           evaluate two pinned policies against the same unchanged tree
`;
const sh = (bin, args) => spawnSync(localBin(bin), args, { stdio: "inherit" }).status ?? 1;
const top = () => Number(flag("--top") ?? 10);
const readPin = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const COMMANDS = {
    init: () => { init((flag("--preset") ?? "typescript"), process.cwd(), { all: rest.includes("--all") }); return 0; },
    abc: () => (reportAbc(loadConfig(), top()) ? 0 : 1),
    size: () => (reportSize(loadConfig()) ? 0 : 1),
    ratchet: () => (reportRatchet(loadConfig(), rest.includes("--write") || rest.includes("--update")) ? 0 : 1),
    lint: () => sh("oxlint", ["--type-aware", ...(rest.length ? rest : ["."])]),
    fmt: () => sh("oxfmt", rest.length ? rest : ["."]),
    deadcode: () => (reportDeadcode(process.cwd()) ? 0 : 1),
    secrets: () => (reportSecrets(process.cwd()) ? 0 : 1),
    tsc: () => (reportTypeScriptProfile(loadConfig(), process.cwd()) ? 0 : 1),
    cycles: () => (reportCycles(process.cwd()) ? 0 : 1),
    dupes: () => (reportDupes(process.cwd()) ? 0 : 1),
    todos: () => (reportTodos(process.cwd()) ? 0 : 1),
    check: () => {
        const config = loadConfig();
        const gates = rest.includes("--all") ? [...SOURCE_GATES] : [...config.check.gates];
        if (rest.includes("--with-size"))
            gates.push("size");
        if (!config.policy && !rest.includes("--json") && !flag("--evidence") && !flag("--at"))
            return reportCheck(config, gates, process.cwd(), top()) ? 0 : 1;
        const result = evaluatePolicy(config, process.cwd(), { gates, includeRepositoryGates: rest.includes("--all") || rest.includes("--with-size"), evaluatedAt: flag("--at") });
        const json = `${JSON.stringify(result, null, 2)}\n`;
        const evidenceFile = flag("--evidence");
        if (evidenceFile)
            fs.writeFileSync(evidenceFile, json, { flag: "wx" });
        if (rest.includes("--json"))
            process.stdout.write(json);
        else
            printEvidence(result);
        return result.clean ? 0 : 1;
    },
    "policy-digest": () => {
        const file = flag("--path");
        if (!file)
            throw new Error("policy-digest requires --path PACK.json");
        console.log(computePolicyPackDigest(file));
        return 0;
    },
    preview: () => {
        const from = flag("--from"), to = flag("--to");
        if (!from || !to)
            throw new Error("preview requires --from OLD-PIN.json --to NEW-PIN.json");
        const beforePolicy = resolvePolicyPack(readPin(from)), afterPolicy = resolvePolicyPack(readPin(to));
        const config = loadConfig();
        const evaluatedAt = flag("--at") ?? new Date().toISOString();
        const before = evaluatePolicy(config, process.cwd(), { policy: beforePolicy, evaluatedAt });
        const after = evaluatePolicy(config, process.cwd(), { policy: afterPolicy, evaluatedAt });
        const preview = comparePolicyRuns(before, after, { beforePack: beforePolicy.pack, afterPack: afterPolicy.pack, exceptions: config.policy?.exceptions });
        if (rest.includes("--json"))
            console.log(JSON.stringify({ preview, before, after }, null, 2));
        else {
            console.log(`${preview.from.name}@${preview.from.version} → ${preview.to.name}@${preview.to.version}`);
            console.log(`${preview.ruleChanges.length} changed rules, ${preview.thresholdChanges.length} parameter changes, ${preview.nativeConfigChanges.length} native-config changes, ${preview.enforcementChanges.length} enforcement changes`);
            console.log(`${preview.addedFindings.length} added findings, ${preview.resolvedFindings.length} resolved findings, ${preview.newBlockers.length} new blockers, ${preview.affectedExceptions.length} affected exceptions`);
            for (const blocker of preview.newBlockers)
                console.log(`  ${blocker.checkId}: ${blocker.outcome}`);
        }
        return after.clean ? 0 : 1;
    },
    help: () => { console.log(HELP); return 0; }
};
const run = COMMANDS[command] ?? (() => { console.log(HELP); return 2; });
try {
    process.exit(run());
}
catch (error) {
    console.error(`Abacus configuration or execution error: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(2);
}
