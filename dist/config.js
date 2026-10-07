import { objectValue, enumValue } from "./json-values.js";
/**
 * abacus.config.json — lives in the consuming repo so every budget and every
 * exemption is owned (and reviewed) there. Everything has a default; an empty
 * `{}` is a valid config for the `typescript` preset.
 */
import fs from "node:fs";
import path from "node:path";
import { validateVerificationConfig } from "./verification-config.js";
export const CHECK_GATES = ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos", "size"];
/** Source gates can run before a build. Size remains an explicit post-build gate. */
export const SOURCE_GATES = CHECK_GATES.filter((gate) => gate !== "size");
export const CONFIG_FILE = "abacus.config.json";
const KB = 1024;
export function defaults(preset) {
    const base = {
        preset,
        check: { gates: ["lint", "abc", "ratchet"] },
        roots: ["src", "scripts"],
        tsc: { projects: ["tsconfig.json"] },
        exclude: ["\\.d\\.ts$", "\\.test\\.tsx?$"],
        abc: { budget: 60, allow: {} },
        size: { budgets: [] },
        ratchet: { file: "abacus.ratchet.json", metrics: { oxlintWarnings: true, abcMax: true } }
    };
    if (preset === "cloudflare-worker")
        base.size.worker = { max: 400 * KB };
    if (preset === "nextjs")
        base.exclude.push("^\\.next/", "^\\.open-next/", "next-env\\.d\\.ts$");
    if (preset === "vite-spa" || preset === "cloudflare-worker") {
        base.size.budgets = [
            { label: "SPA JS (all chunks, gzip)", dir: "dist/client/assets", match: "\\.js$", max: 280 * KB },
            { label: "SPA largest JS chunk (gzip)", dir: "dist/client/assets", match: "\\.js$", max: 260 * KB, mode: "largest" },
            { label: "SPA CSS (gzip)", dir: "dist/client/assets", match: "\\.css$", max: 20 * KB }
        ];
    }
    return base;
}
function existingDefaults(raw) {
    const base = defaults(enumValue(raw.preset ?? "typescript", ["typescript", "cloudflare-worker", "vite-spa", "nextjs"]));
    const ratchet = raw.ratchet === undefined ? {} : objectValue(raw.ratchet);
    if (ratchet.metrics === undefined)
        base.ratchet.metrics = { loc: { roots: ["src"], slack: 0.02 }, oxlintWarnings: true, abcMax: true, comments: { roots: ["src"], max: 0.3 } };
    if (raw.exclude === undefined)
        base.exclude.push("/components/ui/");
    return base;
}
export function loadConfig(cwd = process.cwd()) {
    const file = path.join(cwd, CONFIG_FILE);
    if (!fs.existsSync(file))
        return defaults("typescript");
    const raw = objectValue(JSON.parse(fs.readFileSync(file, "utf8"))), base = existingDefaults(raw);
    const config = structuredClone(base);
    for (const key of ["preset", "roots", "exclude"])
        if (raw[key] !== undefined)
            Reflect.set(config, key, raw[key]);
    config.check = loadCheck(raw.check, base.check);
    config.tsc = loadTsc(raw.tsc, base.tsc);
    for (const key of ["abc", "size", "ratchet"]) {
        if (raw[key] !== undefined)
            Object.assign(config[key], objectValue(raw[key]));
    }
    if (raw.policy !== undefined) {
        assertPolicyConfig(raw.policy);
        config.policy = raw.policy;
    }
    if (raw.verification !== undefined)
        config.verification = validateVerificationConfig(raw.verification);
    validateAbacusConfig(config);
    return config;
}
function assertPolicyConfig(value) {
    const policy = objectValue(value), pack = objectValue(policy.pack);
    nonempty(pack.version, "policy version");
    nonempty(pack.digest, "policy digest");
    const local = typeof pack.path === "string" && pack.package === undefined && pack.export === undefined;
    const installed = typeof pack.package === "string" && typeof pack.export === "string" && pack.path === undefined;
    if (!local && !installed)
        throw new Error("Invalid policy reference");
    if (policy.exceptions !== undefined) {
        if (!Array.isArray(policy.exceptions))
            throw new Error("Invalid policy exceptions");
        for (const entry of policy.exceptions) {
            const exception = objectValue(entry);
            for (const key of ["id", "ruleId", "subject", "owner", "reason", "expires"])
                nonempty(exception[key], `exception.${key}`);
        }
    }
}
function nonempty(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} must be a nonempty string`);
}
function finite(value, name, minimum = 0) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
        throw new Error(`${name} must be finite and >= ${minimum}`);
}
function stringList(value, name) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim()))
        throw new Error(`${name} must be a list of nonempty strings`);
}
function metricConfig(value, name) {
    if (!value)
        return;
    stringList(value.roots, `${name}.roots`);
    const permitted = name === "ratchet.loc" ? ["roots", "slack"] : ["roots", "max"];
    if (Object.keys(value).some((key) => !permitted.includes(key)))
        throw new Error(`${name} has unsupported metric fields`);
    if (value.slack !== undefined)
        finite(value.slack, `${name}.slack`);
    if (value.max !== undefined)
        finite(value.max, `${name}.max`);
}
function validateSize(budget) {
    for (const key of ["label", "dir", "match"])
        nonempty(budget[key], `size.${key}`);
    finite(budget.max, "size.max");
    RegExp(budget.match, "u");
    if (budget.mode !== undefined && !["sum", "largest"].includes(budget.mode))
        throw new Error("Invalid size.mode");
    if (budget.allowEmpty !== undefined && typeof budget.allowEmpty !== "boolean")
        throw new Error("Invalid size.allowEmpty");
}
/** Only read-only deployment selectors; protected dry-run/output flags are not configurable. */
export function validateWranglerArgs(input) {
    stringList(input, "size.worker.wranglerArgs");
    const args = [];
    for (let index = 0; index < input.length; index++) {
        const token = input[index];
        const equals = token.indexOf("=");
        const flag = equals < 0 ? token : token.slice(0, equals);
        if (!["--env", "--name", "--config"].includes(flag))
            throw new Error("wranglerArgs permits only --env, --name and --config selectors");
        const value = equals < 0 ? input[++index] : token.slice(equals + 1);
        nonempty(value, `wranglerArgs ${flag}`);
        if (value.startsWith("-"))
            throw new Error("wranglerArgs selector requires an explicit value");
        args.push(flag, value);
    }
    return args;
}
function canonicalProjectPath(file) {
    if (fs.existsSync(file))
        return fs.realpathSync(file);
    const parent = path.dirname(file);
    return parent === file ? file : path.join(canonicalProjectPath(parent), path.basename(file));
}
export function assertProjectPath(cwd, input, label) {
    const root = canonicalProjectPath(path.resolve(cwd)), absolute = path.resolve(cwd, input);
    const mapped = absolute === path.resolve(cwd) ? root : path.join(canonicalProjectPath(path.dirname(absolute)), path.basename(absolute));
    for (const target of [mapped, canonicalProjectPath(absolute)]) {
        const relative = path.relative(root, target);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error(`${label} must stay within the evaluated project tree`);
    }
}
export function validateProjectInputs(config, cwd) {
    for (const project of validateTscProjects(config.tsc.projects))
        assertProjectPath(cwd, project, "TypeScript project");
    for (const root of [...config.roots, ...(config.ratchet.metrics.loc?.roots ?? []), ...(config.ratchet.metrics.comments?.roots ?? [])])
        assertProjectPath(cwd, root, "Source root");
    for (const budget of config.size.budgets)
        assertProjectPath(cwd, budget.dir, "Built asset directory");
    assertProjectPath(cwd, config.ratchet.file, "Ratchet snapshot");
    const args = validateWranglerArgs(config.size.worker?.wranglerArgs ?? []);
    for (let index = 0; index < args.length; index += 2)
        if (args[index] === "--config")
            assertProjectPath(cwd, args[index + 1], "Wrangler config");
}
/** Runtime validation matters: JSON values do not acquire TypeScript's guarantees. */
export function validateAbacusConfig(config) {
    if (config.verification !== undefined)
        validateVerificationConfig(config.verification);
    if (!["typescript", "cloudflare-worker", "vite-spa", "nextjs"].includes(config.preset))
        throw new Error("Invalid preset");
    validateCheckGates(config.check.gates);
    if (!config.tsc)
        throw new Error("tsc must specify a projects list");
    loadTsc(config.tsc, defaults(config.preset).tsc);
    stringList(config.roots, "roots");
    stringList(config.exclude, "exclude");
    for (const expression of config.exclude)
        RegExp(expression, "u");
    finite(config.abc.budget, "abc.budget", 1);
    if (!config.abc.allow || typeof config.abc.allow !== "object" || Array.isArray(config.abc.allow))
        throw new Error("Invalid abc.allow");
    for (const [subject, entry] of Object.entries(config.abc.allow)) {
        nonempty(subject, "abc.allow subject");
        finite(entry.max, "abc.allow.max", 1);
        nonempty(entry.why, "abc.allow.why");
    }
    if (!Array.isArray(config.size.budgets))
        throw new Error("Invalid size.budgets");
    for (const budget of config.size.budgets)
        validateSize(budget);
    if (config.size.worker) {
        finite(config.size.worker.max, "size.worker.max");
        validateWranglerArgs(config.size.worker.wranglerArgs ?? []);
    }
    nonempty(config.ratchet.file, "ratchet.file");
    metricConfig(config.ratchet.metrics.loc, "ratchet.loc");
    metricConfig(config.ratchet.metrics.comments, "ratchet.comments");
    for (const flag of ["oxlintWarnings", "abcMax"])
        if (config.ratchet.metrics[flag] !== undefined && typeof config.ratchet.metrics[flag] !== "boolean")
            throw new Error(`ratchet.${flag} must be boolean`);
}
export function validateCheckGates(gates) {
    if (!Array.isArray(gates) || gates.length === 0 || !gates.every(isCheckGate)) {
        throw new Error(`check.gates must be a nonempty list of: ${CHECK_GATES.join(", ")}`);
    }
    return [...new Set(gates)];
}
function isCheckGate(gate) {
    return typeof gate === "string" && CHECK_GATES.some((known) => known === gate);
}
function loadCheck(raw, base) {
    const value = raw === undefined ? {} : objectValue(raw);
    return { gates: validateCheckGates(value.gates ?? base.gates) };
}
/** Local JSON project selectors only; executable arguments and reference builds are unsupported. */
export function validateTscProjects(input, label = "tsc.projects") {
    stringList(input, label);
    if (!input.length)
        throw new Error(`${label} must be a nonempty unique list`);
    const projects = input.map((project) => {
        if (path.isAbsolute(project) || path.win32.isAbsolute(project) || /^[a-z]+:/iu.test(project) || project.includes("\\") || project.split("/").includes("..") || !project.endsWith(".json"))
            throw new Error(`${label} must contain local relative JSON config paths within the evaluated project tree`);
        return path.posix.normalize(project);
    });
    if (new Set(projects).size !== projects.length)
        throw new Error(`${label} must be a nonempty unique list`);
    return projects;
}
function loadTsc(raw, base) {
    if (raw === undefined)
        return structuredClone(base);
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "projects"))
        throw new Error("tsc supports only a projects list");
    const projects = Reflect.get(raw, "projects");
    return { projects: validateTscProjects(projects === undefined ? base.projects : projects) };
}
