import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreProject } from "./abc.js";
import type { AbacusConfig, CheckGate } from "./config.js";
import { cruiseConfigPath, depcruiseBinPath, runCycles, sourceDir } from "./cycles.js";
import { jscpdBinPath, runDupes } from "./dupes.js";
import { AdapterFailure, digest, finding, type AdapterResult, type Finding } from "./evidence.js";
import { knipBinPath } from "./deadcode.js";
import { enabledMetricKeys, measureRatchet, readSnapshot } from "./ratchet.js";
import { gitleaksBinPath, scanSecretReport } from "./secrets.js";
import { measureBudgets } from "./size.js";
import { runTodos, sourceFiles } from "./todos.js";
import { nodeToolBinPath, runNodeTool, toolMetadata } from "./tool-runner.js";
import { typescriptEvidence } from "./typescript-profile.js";
import { sharedLintIgnores } from "./lint-config.js";

const scope = (kind: AdapterResult["scope"]["kind"], targets: string[], scanned: number, unit = "files") => ({ kind, targets, scanned, unit });
const configs = (cwd: string, names: string[]) => names.filter((name) => fs.existsSync(path.resolve(cwd, name))).map((name) => ({ path: name, digest: digest(fs.readFileSync(path.resolve(cwd, name))) }));
const checked = (result: AdapterResult): AdapterResult => result.scope.scanned === 0 && ["pass", "fail", "waived"].includes(result.outcome) ? { ...result, outcome: "incomplete", notes: [...(result.notes ?? []), "No intended targets were scanned"] } : result;
const resultFor = (findings: Finding[]): AdapterResult["outcome"] => findings.some((item) => item.severity === "error") ? "fail" : "pass";
const astTool = (name: string) => toolMetadata(createRequire(import.meta.url).resolve("typescript"), name);

export function lintEvidence(cwd: string, configPath?: string): AdapterResult {
  const bin = nodeToolBinPath("oxlint", "oxlint", cwd);
  const tsgolint = nodeToolBinPath("oxlint-tsgolint", "tsgolint", cwd);
  const native = createRequire(pathToFileURL(fs.realpathSync(tsgolint))).resolve(`@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${process.platform === "win32" ? ".exe" : ""}`);
  // Native shared configs live under node_modules; CLI globs are project-rooted.
  const ignored = [...new Set(["**/node_modules/**", "**/.git/**", ...(configPath ? sharedLintIgnores(configPath) : [])])];
  const args = ["--type-aware", "--format", "json", ...ignored.flatMap((pattern) => ["--ignore-pattern", pattern]), ...(configPath ? ["--config", configPath] : []), "."];
  const out = runNodeTool(bin, args, cwd, { OXLINT_TSGOLINT_PATH: native });
  if (out.error || ![0, 1].includes(out.status ?? -1)) throw new Error("oxlint failed to execute");
  const raw = JSON.parse(out.stdout) as { diagnostics: Array<{ code: string; filename: string; severity: string; labels?: Array<{ span?: { line?: number } }> }>; number_of_files: number };
  if (!Array.isArray(raw.diagnostics) || !Number.isInteger(raw.number_of_files) || raw.number_of_files < 0) throw new Error("Invalid oxlint report");
  const occurrences = new Map<string, number>();
  const findings = raw.diagnostics.map((item) => {
    if (typeof item.code !== "string" || typeof item.filename !== "string" || !["error", "warning"].includes(item.severity)) throw new Error("Invalid oxlint diagnostic");
    const key = `${item.filename} ${item.code}`;
    const ordinal = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, ordinal);
    return finding(`lint/${item.code}`, `${key} #${ordinal}`, `Lint diagnostic at ${item.filename}:${item.labels?.[0]?.span?.line ?? 0}`, item.severity === "error" ? "error" : "warning");
  });
  if (out.status === 1 && resultFor(findings) === "pass") throw new Error("oxlint failed without error diagnostics");
  return checked({ outcome: resultFor(findings), scope: { ...scope("repository", ["."], raw.number_of_files), excluded: ignored }, findings, tool: toolMetadata(bin, "oxlint"), tools: [toolMetadata(native, "oxlint-tsgolint")], configs: [...configs(cwd, [configPath ?? ".oxlintrc.json", "tsconfig.json"]), { path: "oxlint:execution-options", digest: digest(JSON.stringify({ typeAware: true, ignored })) }] });
}

function abcEvidence(config: AbacusConfig, cwd: string): AdapterResult {
  const measured = scoreProject(config, cwd);
  const occurrences = new Map<string, number>();
  const findings = measured.scores.flatMap((item) => {
    const key = `${item.file} ${item.name}`;
    const ordinal = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, ordinal);
    if (item.score <= item.budget) return [];
    return [finding("abc/budget", `${key} #${ordinal}`, `ABC ${item.score} exceeds budget ${item.budget}`)];
  });
  return checked({ outcome: resultFor(findings), scope: { ...scope("repository", config.roots, measured.files), excluded: config.exclude }, findings, metrics: { functions: measured.scores.length, maximum: measured.scores[0]?.score ?? 0 }, tool: astTool("typescript/abc-ast-v1") });
}

function ratchetEvidence(config: AbacusConfig, cwd: string): AdapterResult {
  if (config.ratchet.metrics.abcMax && scoreProject(config, cwd).files === 0) return { outcome: "incomplete", scope: scope("repository", config.roots, 0), findings: [], notes: ["ABC ratchet has no source targets"] };
  const raw = readSnapshot(path.join(cwd, config.ratchet.file), enabledMetricKeys(config));
  if (typeof raw === "string") throw new AdapterFailure(raw === "is missing" ? "missing-baseline" : "invalid-baseline");
  const measured = measureRatchet(config, cwd);
  if (!measured.length) throw new Error("No ratchet metrics enabled");
  const findings = measured.flatMap((item) => {
    const previous = raw[item.key];
    if (typeof previous !== "number" || !Number.isFinite(previous) || previous < 0) throw new Error("Ratchet snapshot omits or invalidates an enabled metric");
    const maximum = Math.min(previous * (1 + item.slack), item.max ?? Infinity);
    return item.value > maximum ? [finding("ratchet/ceiling", item.key, `Metric ${item.value} exceeds ceiling ${maximum}`)] : [];
  });
  // Each source-based metric must have targets, even if another metric is populated.
  for (const root of [...(config.ratchet.metrics.loc?.roots ?? []), ...(config.ratchet.metrics.comments?.roots ?? [])]) {
    if (!fs.existsSync(path.join(cwd, root)) || !sourceFiles(path.join(cwd, root)).length) return { outcome: "incomplete", scope: scope("repository", [root], 0), findings, notes: ["A ratchet root has no source targets"] };
  }
  return { outcome: resultFor(findings), scope: scope("repository", config.roots, measured.length, "metrics"), findings, metrics: Object.fromEntries(measured.map((item) => [item.key, item.value])), configs: configs(cwd, [config.ratchet.file, ".oxlintrc.json"]), tool: astTool("typescript/ratchet-v1"), tools: config.ratchet.metrics.oxlintWarnings ? [toolMetadata(nodeToolBinPath("oxlint", "oxlint", cwd), "oxlint")] : [] };
}

function deadcodeEvidence(cwd: string, configPath?: string): AdapterResult {
  const reporter = fileURLToPath(new URL(`./knip-reporter${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url));
  const bin = knipBinPath();
  const out = runNodeTool(bin, ["--reporter", reporter, ...(configPath ? ["--config", configPath] : [])], cwd);
  if (out.error || ![0, 1].includes(out.status ?? -1)) throw new Error("knip failed to execute");
  const raw = JSON.parse(out.stdout) as { processed: number; hasConfigLoadErrors: boolean; findings: Array<{ type: string; file: string; name: string; severity?: string }> };
  if (!Array.isArray(raw.findings) || !Number.isInteger(raw.processed) || raw.processed < 0 || typeof raw.hasConfigLoadErrors !== "boolean") throw new Error("Invalid knip report");
  if (raw.hasConfigLoadErrors) throw new Error("knip configuration load failed");
  const findings = raw.findings.map((item) => finding(`deadcode/${item.type}`, `${item.file} ${item.name}`, `Unused or unresolved ${item.type}`, item.severity === "warn" ? "warning" : "error"));
  if (out.status === 1 && findings.length === 0) throw new Error("knip failed without findings");
  return checked({ outcome: resultFor(findings), scope: scope("repository", ["package.json", "knip entries/project"], raw.processed), findings, configs: configs(cwd, [configPath ?? "knip.json", "package.json"]), tool: toolMetadata(bin, "knip") });
}

function secretEvidence(cwd: string, configPath?: string): AdapterResult {
  const measured = scanSecretReport(cwd, configPath);
  const findings = measured.findings.map((item) => finding(`secrets/${item.rule}`, `${item.file}:${item.line}`, `Potential credential (${item.rule})`));
  return checked({ outcome: resultFor(findings), scope: scope("repository", ["working tree, gitleaks ignore rules"], measured.bytes, "bytes"), findings, configs: configs(cwd, [configPath ?? ".gitleaks.toml", ".gitignore"]), tool: toolMetadata(gitleaksBinPath(), "gitleaks-wrapper") });
}

function cycleEvidence(cwd: string, configPath?: string): AdapterResult {
  const measured = runCycles(cwd, configPath);
  const notes = measured.unresolved > 0 ? [`${measured.unresolved} import${measured.unresolved === 1 ? "" : "s"} could not be resolved; cycle coverage may be incomplete`] : [];
  return checked({ outcome: measured.clean ? "pass" : "fail", scope: scope("graph", [path.relative(cwd, sourceDir(cwd)) || "."], measured.files, "modules"), findings: measured.violations.map((item) => finding(`cycles/${item.rule}`, `${item.from} -> ${item.to}`, "Circular or forbidden dependency", item.severity === "error" ? "error" : item.severity === "warn" ? "warning" : "info")), notes, tool: toolMetadata(depcruiseBinPath(cwd), "dependency-cruiser"), configs: configs(cwd, [configPath ?? cruiseConfigPath(cwd)]) });
}

function dupeEvidence(cwd: string, configPath?: string): AdapterResult {
  const measured = runDupes(cwd, configPath);
  return checked({ outcome: measured.clean ? "pass" : "fail", scope: scope("repository", [path.relative(cwd, sourceDir(cwd)) || "."], measured.files), findings: measured.clean ? [] : measured.clones.map((item) => finding("dupes/threshold", `${item.first.file}:${item.first.start} -> ${item.second.file}:${item.second.start}`, `Duplication ${measured.percentage}% exceeds ${measured.threshold}%`)), metrics: { percentage: measured.percentage, threshold: measured.threshold, clones: measured.clones.length }, tool: toolMetadata(jscpdBinPath(cwd), "jscpd"), configs: configs(cwd, [configPath ?? ".jscpd.json"]) });
}

function todoEvidence(cwd: string, evaluatedAt: string): AdapterResult {
  const measured = runTodos(cwd, evaluatedAt);
  const findings = measured.expired.map((item) => finding("todos/expired", `${item.file}:${item.line} ${item.kind}`, `Deadline ${item.date} expired`));
  return checked({ outcome: measured.clean ? "pass" : "fail", scope: scope("repository", [path.relative(cwd, sourceDir(cwd)) || "."], sourceFiles(cwd).length), findings, metrics: { dated: measured.todos.filter((item) => item.date).length, undated: measured.todos.filter((item) => !item.date).length } });
}

function sizeEvidence(config: AbacusConfig, cwd: string): AdapterResult {
  const measured = measureBudgets(config, cwd);
  const findings = measured.filter((item) => !item.ok).map((item) => finding("size/budget", item.label, item.error ? "Build assets missing" : `Gzip bytes ${item.actual} exceed ${item.max}`));
  return { outcome: !measured.length ? "not-applicable" : measured.some((item) => item.error) ? "incomplete" : resultFor(findings), scope: scope("built-assets", config.size.budgets.map((item) => item.dir), measured.reduce((count, item) => count + item.files, 0)), findings, metrics: Object.fromEntries(measured.map((item) => [item.label, item.actual])), notes: !measured.length ? ["No size budgets configured"] : [], ...(config.size.worker ? { tool: toolMetadata(nodeToolBinPath("wrangler", "wrangler", cwd), "wrangler") } : {}) };
}

export function runSourceAdapter(gate: CheckGate, config: AbacusConfig, cwd: string, evaluatedAt: string, nativeConfig?: string): AdapterResult {
  if (nativeConfig && !["lint", "deadcode", "secrets", "cycles", "dupes"].includes(gate)) throw new Error(`Pack nativeConfig for ${gate} is unsupported; use repository config`);
  const runners: Record<CheckGate, () => AdapterResult> = {
    lint: () => lintEvidence(cwd, nativeConfig), abc: () => abcEvidence(config, cwd), ratchet: () => ratchetEvidence(config, cwd), tsc: () => typescriptEvidence(config, cwd), deadcode: () => deadcodeEvidence(cwd, nativeConfig), secrets: () => secretEvidence(cwd, nativeConfig), cycles: () => cycleEvidence(cwd, nativeConfig), dupes: () => dupeEvidence(cwd, nativeConfig), todos: () => todoEvidence(cwd, evaluatedAt), size: () => sizeEvidence(config, cwd),
  };
  return runners[gate]();
}
