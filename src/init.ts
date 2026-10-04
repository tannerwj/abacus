/**
 * `abacus init --preset <p>` — drop the config files into a repo and wire
 * package.json scripts. Never overwrites an existing file; prints what to do
 * by hand instead.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, defaults, SOURCE_GATES, type Preset } from "./config.js";
import { knipConfig } from "./deadcode.js";

const OXLINT_PRESET: Record<Preset, string> = {
  "typescript": "@tjohnson/abacus/configs/oxlint/typescript.json",
  "cloudflare-worker": "@tjohnson/abacus/configs/oxlint/cloudflare-worker.json",
  "vite-spa": "@tjohnson/abacus/configs/oxlint/vite-spa.json",
  "nextjs": "@tjohnson/abacus/configs/oxlint/nextjs.json"
};
const OXFMT_TEMPLATE = new URL("../configs/oxfmt.jsonc", import.meta.url);
const GITLEAKS_TEMPLATE = new URL("../configs/gitleaks.toml", import.meta.url);
const DEPCRUISE_TEMPLATE = new URL("../configs/dependency-cruiser.cjs", import.meta.url);
const JSCPD_TEMPLATE = new URL("../configs/jscpd.json", import.meta.url);

function writeIfMissing(file: string, content: string): boolean {
  if (fs.existsSync(file)) { console.log(`  skip  ${path.basename(file)} (exists)`); return false; }
  fs.writeFileSync(file, content);
  console.log(`  write ${path.basename(file)}`);
  return true;
}

export function init(preset: Preset, cwd = process.cwd(), options: { all?: boolean } = {}): void {
  if (!["typescript", "cloudflare-worker", "vite-spa", "nextjs"].includes(preset)) throw new Error(`Unknown preset: ${preset}`);
  console.log(`abacus init — preset ${preset}\n`);
  const config = defaults(preset);
  if (options.all) config.check.gates = [...SOURCE_GATES];
  writeIfMissing(path.join(cwd, CONFIG_FILE), `${JSON.stringify({ $schema: "./node_modules/@tjohnson/abacus/configs/abacus.schema.json", ...config }, null, 2)}\n`);
  writeIfMissing(path.join(cwd, ".oxlintrc.json"), `${JSON.stringify({
    $schema: "./node_modules/oxlint/configuration_schema.json",
    extends: [`./node_modules/${OXLINT_PRESET[preset]}`],
    ignorePatterns: ["dist/**", "node_modules/**", ".wrangler/**", ...(preset === "nextjs" ? [".next/**", ".open-next/**"] : [])],
    rules: {},
    overrides: []
  }, null, 2)}\n`);
  writeIfMissing(path.join(cwd, ".oxfmtrc.jsonc"), fs.readFileSync(OXFMT_TEMPLATE, "utf8"));
  writeIfMissing(path.join(cwd, "knip.json"), knipConfig(cwd));
  writeIfMissing(path.join(cwd, ".gitleaks.toml"), fs.readFileSync(GITLEAKS_TEMPLATE, "utf8"));
  writeIfMissing(path.join(cwd, ".dependency-cruiser.cjs"), fs.readFileSync(DEPCRUISE_TEMPLATE, "utf8"));
  writeIfMissing(path.join(cwd, ".jscpd.json"), fs.readFileSync(JSCPD_TEMPLATE, "utf8"));
  const pkgFile = path.join(cwd, "package.json");
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as { scripts?: Record<string, string> };
    pkg.scripts ??= {};
    const wanted: Record<string, string> = { lint: "oxlint --type-aware", fmt: "abacus fmt", abc: "abacus abc", size: "abacus size", ratchet: "abacus ratchet", tsc: "abacus tsc", deadcode: "abacus deadcode", secrets: "abacus secrets", cycles: "abacus cycles", dupes: "abacus dupes", todos: "abacus todos", check: "abacus check" };
    let changed = false;
    for (const [name, cmd] of Object.entries(wanted)) {
      if (pkg.scripts[name]) { console.log(`  keep  scripts.${name} = ${pkg.scripts[name]}`); continue; }
      pkg.scripts[name] = cmd; changed = true; console.log(`  add   scripts.${name} = ${cmd}`);
    }
    if (changed) fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`
Next:
  1. pnpm add -D oxlint oxlint-tsgolint oxfmt   (type-aware lint + formatter)
  2. run \`abacus ratchet --write\` once and commit the baseline; normal checks never create or repair it
  3. use \`abacus check\` in your check script; default gates: lint, abc, ratchet. Opt in to tsc, deadcode, secrets, cycles, dupes, todos with config check.gates or \`abacus check --all\`; \`abacus init --all\` selects them in a new config
  4. run \`pnpm size\` (or \`abacus check --with-size\`) after build; TypeScript strictness advice does not fail the tsc gate
  5. tsconfig paths must be relative ("./src/*") and without baseUrl for tsgolint`);
}
