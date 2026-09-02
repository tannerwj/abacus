#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { reportAbc } from "./abc.js";
import { loadConfig, type Preset } from "./config.js";
import { init } from "./init.js";
import { reportSize } from "./size.js";

const [command = "help", ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

const HELP = `abacus — quality gates for TypeScript projects

  abacus init [--preset typescript|cloudflare-worker|vite-spa]   write abacus.config.json + .oxlintrc.json, add scripts
  abacus abc [--top N]                                           ABC scores per function vs budget (exit 1 if over)
  abacus size                                                    gzip bundle budgets (run after build)
  abacus lint [paths…]                                           oxlint --type-aware with the repo's .oxlintrc.json
  abacus check                                                   lint + abc (add size after your build step)
`;

function run(): number {
  switch (command) {
    case "init": { init((flag("--preset") ?? "typescript") as Preset); return 0; }
    case "abc": return reportAbc(loadConfig(), Number(flag("--top") ?? 10)) ? 0 : 1;
    case "size": return reportSize(loadConfig()) ? 0 : 1;
    case "lint": return spawnSync("oxlint", ["--type-aware", ...(rest.length ? rest : ["."])], { stdio: "inherit" }).status ?? 1;
    case "check": {
      const lint = spawnSync("oxlint", ["--type-aware", "."], { stdio: "inherit" }).status ?? 1;
      const abc = reportAbc(loadConfig(), Number(flag("--top") ?? 10)) ? 0 : 1;
      return lint || abc;
    }
    default: console.log(HELP); return command === "help" ? 0 : 2;
  }
}

process.exit(run());
