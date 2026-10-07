import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [output] = process.argv.slice(2),
  pnpmCli = process.env.npm_execpath;
if (!output || fs.existsSync(output)) throw new Error("Audit requires a new report path");
const direct = pnpmCli && path.basename(pnpmCli).startsWith("pnpm");
const result = spawnSync(
  direct ? process.execPath : "pnpm",
  [...(direct ? [pnpmCli] : []), "audit", "--json"],
  { encoding: "utf8", shell: false, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
);
if (result.error || result.signal || !result.stdout)
  throw new Error("Dependency audit did not produce a report");
JSON.parse(result.stdout);
fs.writeFileSync(output, result.stdout, { flag: "wx" });
process.exitCode = result.status ?? 2;
