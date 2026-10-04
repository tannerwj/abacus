import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { type AdapterResult, digest, finding } from "./evidence.js";
import { nodeToolBinPath, runNodeTool, toolMetadata } from "./tool-runner.js";

export type ConsumerMode = "node16-esm" | "node16-cjs" | "bundler";
export interface PackageValidationOptions {
  /** Explicit support contract. ESM-only packages need not promise CommonJS. */
  modes?: ConsumerMode[];
  publintLevel?: "suggestion" | "warning" | "error";
  attwProfile?: "strict" | "node16" | "esm-only";
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Runs asynchronous official publint/pack APIs in an isolated Node process so
// the public adapter remains synchronous like the existing native gates.
function packWorker(publintBin: string, cwd: string, temporary: string, level: string): string {
  const require = createRequire(pathToFileURL(fs.realpathSync(publintBin)));
  const source = `
import fs from "node:fs";
import path from "node:path";
import { publint } from ${JSON.stringify(pathToFileURL(require.resolve("publint")).href)};
import { pack, unpack } from ${JSON.stringify(pathToFileURL(require.resolve("@publint/pack")).href)};
const cwd = ${JSON.stringify(cwd)};
const temporary = ${JSON.stringify(temporary)};
process.env.npm_config_cache = path.join(temporary, "npm-cache");
process.env.npm_config_offline = "true";
const tarball = await pack(cwd, { packageManager: "npm", ignoreScripts: true, destination: temporary });
if (!path.resolve(tarball).startsWith(temporary + path.sep)) throw new Error("unexpected packed destination");
const bytes = fs.readFileSync(tarball);
const unpacked = await unpack(bytes);
const lint = await publint({ pack: { tarball: bytes }, level: ${JSON.stringify(level)} });
const pkg = lint.pkg;
if (typeof pkg.name !== "string" || !/^(?:@[a-z0-9_.-]+\\/)?[a-z0-9_.-]+$/i.test(pkg.name)
  || pkg.name.split("/").some(part => part === "." || part === "..")) throw new Error("invalid package name");
const consumer = path.join(temporary, "consumer");
const packageDir = path.join(consumer, "node_modules", pkg.name);
for (const file of unpacked.files) {
  const prefix = unpacked.rootDir + "/";
  if (!file.name.startsWith(prefix)) throw new Error("inconsistent tarball root");
  const relative = file.name.slice(prefix.length);
  const target = path.resolve(packageDir, relative);
  if (!relative || !target.startsWith(packageDir + path.sep)) throw new Error("unsafe tarball path");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.data);
}
const messages = lint.messages.map(message => ({ code: message.code, path: message.path, type: message.type }));
process.stdout.write(JSON.stringify({ tarball, consumer, pkg, messages, files: unpacked.files.length }));
`;
  const worker = path.join(temporary, "pack-and-publint.mjs");
  fs.writeFileSync(worker, source);
  return worker;
}

/** Link only already-installed declared dependencies; never install consumers. */
function linkDependencies(cwd: string, consumer: string, pkg: Record<string, unknown>): void {
  const dependencies = new Set<string>();
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (object(pkg[key])) for (const name of Object.keys(pkg[key])) dependencies.add(name);
  }
  for (const name of dependencies) {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) || name.split("/").some((part) => part === "." || part === "..")) continue;
    let location = path.resolve(cwd);
    for (;;) {
      const candidate = path.join(location, "node_modules", name);
      if (fs.existsSync(candidate)) {
        const destination = path.join(consumer, "node_modules", name);
        if (!fs.existsSync(destination)) {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.symlinkSync(fs.realpathSync(candidate), destination, process.platform === "win32" ? "junction" : "dir");
        }
        break;
      }
      const parent = path.dirname(location);
      if (parent === location) break;
      location = parent;
    }
  }
}

function installedExecutable(command: string): string {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? `${command}.cmd` : command);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  throw new Error(`No ${command} executable`);
}

interface PackageSettings {
  modes: ConsumerMode[];
  publintLevel: "suggestion" | "warning" | "error";
  attwProfile: "strict" | "node16" | "esm-only";
}
interface PackageManifest extends Record<string, unknown> { name: string; version: string }
interface PackedReceipt {
  tarball: string;
  consumer: string;
  pkg: PackageManifest;
  files: number;
  messages: Array<{ code: string; path: string[]; type: "suggestion" | "warning" | "error" }>;
}
interface UntypedAnalysis { packageName: string; packageVersion: string; types: false }
interface TypeAnalysis {
  packageName: string;
  packageVersion: string;
  types: { kind: "included" };
  problems: Array<Record<string, unknown>>;
  entrypoints: Record<string, {
    isWildcard?: boolean;
    resolutions: Record<ConsumerMode, { visibleProblems: number[] }>;
  }>;
}
class InspectionError extends Error {
  constructor(readonly outcome: "incomplete" | "error", message: string) { super(message); }
}
function settings(options: PackageValidationOptions): PackageSettings {
  const modes = options.modes;
  if (!Array.isArray(modes) || modes.length === 0 || new Set(modes).size !== modes.length
    || modes.some((mode) => !["node16-esm", "node16-cjs", "bundler"].includes(mode))) {
    throw new InspectionError("incomplete", "Package validation requires explicitly declared, nonempty supported consumer modes.");
  }
  const publintLevel = options.publintLevel ?? "warning";
  const attwProfile = options.attwProfile ?? (modes.includes("node16-cjs") ? "node16" : "esm-only");
  if (!["suggestion", "warning", "error"].includes(publintLevel) || !["strict", "node16", "esm-only"].includes(attwProfile)) {
    throw new InspectionError("error", "Package validation options are invalid.");
  }
  return { modes, publintLevel, attwProfile };
}
function packageInput(manifest: string): PackageManifest {
  if (!fs.existsSync(manifest)) throw new InspectionError("incomplete", "No package.json input is available for package validation.");
  const pkg: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (!validManifest(pkg)) {
    throw new InspectionError("incomplete", "Package validation requires a named, versioned package manifest.");
  }
  return pkg;
}
function dependentMetadata(bin: string, packageName: string, name = packageName) {
  const require = createRequire(pathToFileURL(fs.realpathSync(bin)));
  return toolMetadata(require.resolve(packageName), name);
}
function toolProvenance(cwd: string, result: AdapterResult): { publintBin: string; attwBin: string; tscBin: string } {
  const publintBin = nodeToolBinPath("publint", "publint", cwd);
  const attwBin = nodeToolBinPath("@arethetypeswrong/cli", "attw", cwd);
  const tscBin = nodeToolBinPath("typescript", "tsc", cwd);
  const require = createRequire(pathToFileURL(fs.realpathSync(publintBin)));
  result.tools = [toolMetadata(require.resolve("publint"), "publint"), toolMetadata(attwBin, "@arethetypeswrong/cli"),
    toolMetadata(tscBin, "typescript"), toolMetadata(installedExecutable("npm"), "npm"), toolMetadata(require.resolve("@publint/pack"), "@publint/pack")];
  const attwRequire = createRequire(pathToFileURL(fs.realpathSync(attwBin)));
  try {
    const core = attwRequire.resolve("@arethetypeswrong/core");
    result.tools.push(toolMetadata(core, "@arethetypeswrong/core"), dependentMetadata(core, "typescript", "attw-typescript"));
  } catch {
    throw new InspectionError("error", "Are the Types Wrong analyzer dependencies are unavailable.");
  }
  result.tool = result.tools[0];
  return { publintBin, attwBin, tscBin };
}
function validManifest(value: unknown): value is PackageManifest {
  return object(value) && typeof value.name === "string" && typeof value.version === "string";
}
function validMessage(value: unknown): value is PackedReceipt["messages"][number] {
  return object(value) && typeof value.code === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(value.code)
    && Array.isArray(value.path) && value.path.every((part) => typeof part === "string")
    && typeof value.type === "string" && ["suggestion", "warning", "error"].includes(value.type);
}
function validPacked(value: unknown, temporary: string, pkg: PackageManifest): value is PackedReceipt {
  return object(value) && validManifest(value.pkg) && value.pkg.name === pkg.name && value.pkg.version === pkg.version
    && Array.isArray(value.messages) && value.messages.every(validMessage)
    && typeof value.tarball === "string" && typeof value.consumer === "string"
    && typeof value.files === "number" && Number.isInteger(value.files) && value.files > 0
    && path.resolve(value.tarball).startsWith(temporary + path.sep) && path.resolve(value.consumer).startsWith(temporary + path.sep);
}
function parsePacked(text: string, temporary: string, pkg: PackageManifest): PackedReceipt {
  const packed: unknown = JSON.parse(text);
  if (!validPacked(packed, temporary, pkg)) throw new InspectionError("error", "Native package inspection returned inconsistent packed-package evidence.");
  return packed;
}
function inspectPacked(cwd: string, temporary: string, publintBin: string, level: string, pkg: PackageManifest): PackedReceipt {
  const output = runNodeTool(packWorker(publintBin, cwd, temporary, level), [], cwd);
  if (output.error || output.signal || output.status !== 0) throw new InspectionError("error", "npm packing or native publint inspection did not complete.");
  return parsePacked(output.stdout, temporary, pkg);
}
function publintFindings(packed: PackedReceipt): AdapterResult["findings"] {
  return packed.messages.map((message) => finding(`package/publint/${message.code}`, `package.json:${message.path.join(".")}`,
    `Native publint packaging problem: ${message.code}.`, message.type === "suggestion" ? "info" : message.type === "warning" ? "warning" : "error"));
}
function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item));
}
function validResolution(value: unknown): boolean { return object(value) && numbers(value.visibleProblems); }
function validEntrypoint(value: unknown): boolean {
  return object(value) && object(value.resolutions) && ["node16-esm", "node16-cjs", "bundler"].every((mode) => validResolution(value.resolutions && object(value.resolutions) ? value.resolutions[mode] : undefined));
}
function validTypeProblem(value: unknown): boolean {
  const kinds = ["NoResolution", "UntypedResolution", "FalseCJS", "FalseESM", "CJSResolvesToESM", "FallbackCondition", "CJSOnlyExportsDefault",
    "FalseExportDefault", "MissingExportEquals", "UnexpectedModuleSyntax", "InternalResolutionError", "NamedExports"];
  return object(value) && typeof value.kind === "string" && kinds.includes(value.kind);
}
function validAnalysis(value: unknown): value is TypeAnalysis | UntypedAnalysis {
  if (!object(value) || typeof value.packageName !== "string" || typeof value.packageVersion !== "string") return false;
  if (value.types === false) return true;
  return object(value.types) && value.types.kind === "included" && Array.isArray(value.problems)
    && value.problems.every(validTypeProblem)
    && object(value.entrypoints) && Object.values(value.entrypoints).every(validEntrypoint);
}
function inspectTypes(cwd: string, temporary: string, bin: string, packed: PackedReceipt, profile: string): TypeAnalysis | UntypedAnalysis {
  // Empty native config prevents hidden ignore rules and implicit network work.
  const config = path.join(temporary, "attw.json");
  fs.writeFileSync(config, "{}\n");
  const output = runNodeTool(bin, [packed.tarball, "--format", "json", "--profile", profile, "--config-path", config, "--no-definitely-typed"], cwd);
  if (output.error || output.signal || (output.status !== 0 && output.status !== 1)) {
    throw new InspectionError("error", "Are the Types Wrong could not complete packed-package inspection.");
  }
  const report: unknown = JSON.parse(output.stdout);
  if (!object(report) || !validAnalysis(report.analysis) || report.analysis.packageName !== packed.pkg.name || report.analysis.packageVersion !== packed.pkg.version) {
    throw new InspectionError("error", "Are the Types Wrong returned inconsistent package evidence.");
  }
  if (output.status === 1 && (!report.analysis.types || report.analysis.problems.length === 0)) {
    throw new InspectionError("error", "Are the Types Wrong failed without native compatibility problems.");
  }
  return report.analysis;
}
function declaredEntrypoints(analysis: TypeAnalysis, modes: ConsumerMode[]): { entrypoints: string[]; visible: Set<number> } {
  if (!Array.isArray(analysis.problems) || !object(analysis.entrypoints) || !Object.keys(analysis.entrypoints).length) {
    throw new InspectionError("incomplete", "Are the Types Wrong did not inspect any public package entrypoints.");
  }
  const visible = new Set<number>();
  const entrypoints: string[] = [];
  for (const [subpath, entrypoint] of Object.entries(analysis.entrypoints)) {
    if (!object(entrypoint) || !object(entrypoint.resolutions) || (subpath !== "." && !subpath.startsWith("./"))) {
      throw new InspectionError("error", "Are the Types Wrong returned malformed entrypoint evidence.");
    }
    if (entrypoint.isWildcard || subpath.includes("*")) {
      throw new InspectionError("incomplete", "The first library profile cannot exhaustively consumer-test wildcard export subpaths.");
    }
    entrypoints.push(subpath);
    for (const mode of modes) addVisibleProblems(entrypoint.resolutions[mode], analysis.problems.length, visible);
  }
  return { entrypoints, visible };
}
function addVisibleProblems(resolution: unknown, count: number, visible: Set<number>): void {
  if (!object(resolution) || !numbers(resolution.visibleProblems)
    || resolution.visibleProblems.some((index) => index < 0 || index >= count)) {
    throw new InspectionError("error", "Are the Types Wrong omitted declared consumer-mode evidence.");
  }
  for (const index of resolution.visibleProblems) visible.add(index);
}
function typeProblemFindings(analysis: TypeAnalysis, visible: Set<number>): AdapterResult["findings"] {
  return [...visible].map((index) => {
    const problem = analysis.problems[index];
    if (!object(problem) || typeof problem.kind !== "string") throw new InspectionError("error", "Are the Types Wrong returned malformed problem evidence.");
    const subject = [problem.entrypoint, problem.typesFileName, problem.fileName].find((value): value is string => typeof value === "string") ?? analysis.packageName;
    return finding(`package/attw/${problem.kind}`, subject, `Native type/package compatibility problem: ${problem.kind}.`);
  });
}
function consumerSource(specifiers: string[], mode: ConsumerMode): string {
  return specifiers.map((specifier, index) => mode === "node16-cjs"
    ? `import subject${index} = require(${JSON.stringify(specifier)}); void subject${index};`
    : `import * as subject${index} from ${JSON.stringify(specifier)}; void subject${index};`).join("\n");
}
function prepareConsumer(consumer: string, specifiers: string[], mode: ConsumerMode, result: AdapterResult): { dir: string; config: string } {
  const dir = path.join(consumer, mode);
  fs.mkdirSync(dir);
  const extension = mode === "node16-cjs" ? "cts" : mode === "node16-esm" ? "mts" : "ts";
  const source = consumerSource(specifiers, mode);
  fs.writeFileSync(path.join(dir, `consumer.${extension}`), source);
  const tsconfig = {
    compilerOptions: { target: "ES2022", module: mode === "bundler" ? "ESNext" : "Node16", moduleResolution: mode === "bundler" ? "Bundler" : "Node16", strict: true, skipLibCheck: false, noEmit: true, types: [] },
    files: [`consumer.${extension}`],
  };
  const config = path.join(dir, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify(tsconfig));
  result.configs?.push({ path: `package-validation#consumer/${mode}`, digest: digest(JSON.stringify({ source, tsconfig })) });
  return { dir, config };
}
function checkTypes(bin: string, dir: string, config: string, mode: ConsumerMode, result: AdapterResult): void {
  const output = runNodeTool(bin, ["--project", config, "--pretty", "false"], dir);
  if (output.error || output.signal || output.status === null || ![0, 1, 2].includes(output.status)) {
    throw new InspectionError("error", "A packed TypeScript consumer could not complete.");
  }
  if (output.status === 0) return;
  const codes = [...new Set(output.stdout.match(/\bTS\d+(?=:)/g) ?? [])];
  if (!codes.length) throw new InspectionError("error", "A packed TypeScript consumer failed without structured diagnostic codes.");
  result.findings.push(finding(`package/consumer/${mode}/types`, result.scope.targets[0], `The packed ${mode} TypeScript consumer did not type-check (${codes.join(", ")}).`));
}
function checkRuntime(dir: string, specifiers: string[], mode: ConsumerMode, result: AdapterResult): void {
  const runtime = path.join(dir, `consumer.${mode === "node16-cjs" ? "cjs" : "mjs"}`);
  const source = specifiers.map((specifier) => mode === "node16-cjs" ? `require(${JSON.stringify(specifier)});` : `await import(${JSON.stringify(specifier)});`).join("\n");
  const completed = mode === "node16-cjs"
    ? 'require("node:fs").writeFileSync(require("node:path").join(__dirname, "entrypoints-loaded"), "complete");'
    : 'const fs = await import("node:fs"); fs.writeFileSync(new URL("./entrypoints-loaded", import.meta.url), "complete");';
  fs.writeFileSync(runtime, `${source}\n${completed}`);
  result.configs?.push({ path: `package-validation#runtime/${mode}`, digest: digest(`${source}\n${completed}`) });
  const output = runNodeTool(runtime, [], dir);
  if (output.error || output.signal || output.status === null) throw new InspectionError("error", "A packed Node consumer could not complete.");
  if (output.status !== 0) result.findings.push(finding(`package/consumer/${mode}/runtime`, result.scope.targets[0], `The packed ${mode} Node consumer failed to load every public entrypoint.`));
  else if (!fs.existsSync(path.join(dir, "entrypoints-loaded"))) throw new InspectionError("incomplete", "A packed Node consumer terminated before all public entrypoints loaded.");
}
function testConsumers(cwd: string, packed: PackedReceipt, modes: ConsumerMode[], entrypoints: string[], bin: string, result: AdapterResult): void {
  linkDependencies(cwd, packed.consumer, packed.pkg);
  const specifiers = entrypoints.map((entrypoint) => packed.pkg.name + (entrypoint === "." ? "" : entrypoint.slice(1)));
  let runtimeChecks = 0;
  for (const mode of modes) {
    const { dir, config } = prepareConsumer(packed.consumer, specifiers, mode, result);
    checkTypes(bin, dir, config, mode, result);
    if (mode !== "bundler") { checkRuntime(dir, specifiers, mode, result); runtimeChecks += 1; }
  }
  result.metrics = { packedFiles: packed.files, entrypoints: entrypoints.length, consumerChecks: modes.length, runtimeChecks };
}
function validatePacked(cwd: string, temporary: string, packed: PackedReceipt, opts: PackageSettings, bins: ReturnType<typeof toolProvenance>, result: AdapterResult): void {
  result.scope.targets = [packed.pkg.name];
  result.scope.scanned = packed.files;
  result.configs?.push({ path: "package-validation#packed-artifact", digest: digest(fs.readFileSync(packed.tarball)) });
  result.findings = publintFindings(packed);
  const analysis = inspectTypes(cwd, temporary, bins.attwBin, packed, opts.attwProfile);
  if (!analysis.types) {
    result.findings.push(finding("package/declarations-missing", packed.pkg.name, "The packed library has no included TypeScript declarations."));
    result.outcome = "fail";
    return;
  }
  const { entrypoints, visible } = declaredEntrypoints(analysis, opts.modes);
  result.findings.push(...typeProblemFindings(analysis, visible));
  testConsumers(cwd, packed, opts.modes, entrypoints, bins.tscBin, result);
  result.outcome = result.findings.some((item) => item.severity !== "info") ? "fail" : "pass";
}

/** Package publication checks against one real, scripts-disabled npm tarball. */
export function runPackageValidation(cwd = process.cwd(), options: PackageValidationOptions = {}): AdapterResult {
  const result: AdapterResult = {
    outcome: "incomplete", scope: { kind: "package", targets: ["package.json"], scanned: 0, unit: "packed files" }, findings: [], configs: [],
  };
  let temporary: string | undefined;
  try {
    cwd = path.resolve(cwd);
    const opts = settings(options);
    const manifest = path.join(cwd, "package.json");
    const pkg = packageInput(manifest);
    result.configs?.push({ path: manifest, digest: digest(fs.readFileSync(manifest)) });
    result.configs?.push({ path: "package-validation#options", digest: digest(JSON.stringify({ ...opts, ignoreScripts: true, offlineConsumers: true })) });
    const bins = toolProvenance(cwd, result);
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-package-"));
    const packed = inspectPacked(cwd, temporary, bins.publintBin, opts.publintLevel, pkg);
    validatePacked(cwd, temporary, packed, opts, bins, result);
    result.notes = ["Lifecycle scripts are disabled; build before validation. Consumers use installed declared dependencies without network installation.",
      "Bundler support is a real TypeScript resolution consumer; bundler runtime behavior is outside this first profile."];
  } catch (error) {
    result.outcome = error instanceof InspectionError ? error.outcome : "error";
    const message = error instanceof InspectionError ? error.message : "Package manifest, native tool evidence, or consumer preparation failed.";
    result.findings.push(finding(`package/${result.outcome}`, "package.json", message));
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
  return result;
}
