#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { reportAbc } from "./abc.js";
import { loadConfig } from "./config.js";
import { reportDeadcode } from "./deadcode.js";
import { init } from "./init.js";
import { localBin, reportRatchet } from "./ratchet.js";
import { reportSize } from "./size.js";
const [command = "help", ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const HELP = `abacus — quality gates for TypeScript projects

  abacus init [--preset typescript|cloudflare-worker|vite-spa|nextjs]   write abacus.config.json, .oxlintrc.json, .oxfmtrc.jsonc; add scripts
  abacus abc [--top N]                                                  ABC scores per function vs budget (exit 1 if over)
  abacus size                                                           gzip bundle budgets (run after build)
  abacus ratchet [--write]                                              LOC / comment ratio / max ABC / oxlint count vs snapshot (exit 1 if grown)
  abacus lint [paths…]                                                  oxlint --type-aware with the repo's .oxlintrc.json
  abacus fmt [--check] [paths…]                                         oxfmt (write by default) with the repo's .oxfmtrc.jsonc
  abacus deadcode                                                       unused exports/files/types/deps via knip (exit 1 if found)
  abacus check                                                          lint + abc + ratchet (add size after your build step)
`;
const sh = (bin, args) => spawnSync(localBin(bin), args, { stdio: "inherit" }).status ?? 1;
const top = () => Number(flag("--top") ?? 10);
const COMMANDS = {
    init: () => { init((flag("--preset") ?? "typescript")); return 0; },
    abc: () => (reportAbc(loadConfig(), top()) ? 0 : 1),
    size: () => (reportSize(loadConfig()) ? 0 : 1),
    ratchet: () => (reportRatchet(loadConfig(), rest.includes("--write")) ? 0 : 1),
    lint: () => sh("oxlint", ["--type-aware", ...(rest.length ? rest : ["."])]),
    fmt: () => sh("oxfmt", rest.length ? rest : ["."]),
    deadcode: () => (reportDeadcode(process.cwd()) ? 0 : 1),
    check: () => { const lint = sh("oxlint", ["--type-aware", "."]); const abc = reportAbc(loadConfig(), top()) ? 0 : 1; const ratchet = reportRatchet(loadConfig(), false) ? 0 : 1; return lint || abc || ratchet; },
    help: () => { console.log(HELP); return 0; }
};
const run = COMMANDS[command] ?? (() => { console.log(HELP); return 2; });
process.exit(run());
