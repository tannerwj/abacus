/**
 * `abacus tsc` — TypeScript zero-error gate plus strictness audit.
 *
 * Runs `tsc --noEmit` (the project's own tsc when available, otherwise the
 * TypeScript bundled with abacus) and exits 1 on any type error. Also audits
 * the effective tsconfig for the high-value strictness flags beyond `strict`
 * — reported as advisory, never failing: adopting a flag is the repo's
 * decision, recorded in its tsconfig.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { nodeToolBinPath, runNodeTool } from "./tool-runner.js";
import { assertCompilerSource, inspectCompilerInputs } from "./compiler-inputs.js";
import { digest } from "./evidence.js";
/** Project's tsc if installed, else the TypeScript bundled with abacus. */
export function tscBinPath(cwd = process.cwd()) {
    return nodeToolBinPath("typescript", "tsc", cwd);
}
/** Resolve the effective tsconfig (following `extends`) via the TS API. Exported for tests. */
export function effectiveOptions(cwd = process.cwd()) {
    const { options, configPath } = inspectCompilerInputs(cwd);
    return { options, configPath };
}
function compilerRun(cwd, project, incremental) {
    const directory = incremental ? fs.mkdtempSync(path.join(os.tmpdir(), "abacus-tsc-cache-")) : undefined;
    try {
        const cacheArgs = directory ? ["--tsBuildInfoFile", path.join(directory, "check.tsbuildinfo")] : [];
        return runNodeTool(tscBinPath(cwd), ["--project", path.resolve(cwd, project), "--noEmit", "--pretty", "false", "--listFiles", ...cacheArgs], cwd);
    }
    finally {
        if (directory)
            fs.rmSync(directory, { recursive: true, force: true });
    }
}
/** Resolution manifests can change the meaning or selected entrypoint of unchanged declarations. */
function installedManifests(files) {
    const manifests = new Set();
    for (const file of files) {
        const parts = path.resolve(file).split(path.sep), boundary = parts.indexOf("node_modules");
        if (boundary < 0)
            continue;
        const root = parts.slice(0, boundary + 1).join(path.sep);
        for (let directory = path.dirname(file); directory !== root; directory = path.dirname(directory)) {
            const manifest = path.join(directory, "package.json");
            if (fs.existsSync(manifest))
                manifests.add(manifest);
        }
    }
    return [...manifests];
}
export function runTsc(cwd = process.cwd(), project = "tsconfig.json") {
    const inputs = inspectCompilerInputs(cwd, project);
    const { options, configPath } = inputs;
    if (!configPath || inputs.incompleteReason)
        return { ...inputs, clean: false, files: 0, errors: [], sources: [], dependencies: [] };
    const out = compilerRun(cwd, project, options.incremental === true || options.composite === true);
    if (out.error)
        throw new Error(`tsc failed to run: ${out.error.message}`);
    const text = `${out.stdout ?? ""}\n${out.stderr ?? ""}`;
    const errors = text.split("\n").filter((l) => /error TS\d+/.test(l));
    if (out.status !== 0 && errors.length === 0)
        throw new Error("tsc failed without compiler diagnostics");
    const allSources = [...new Set(text.split("\n").filter((line) => path.isAbsolute(line) && /\.(?:[cm]?[jt]sx?|json)$/u.test(line)))];
    const projectSources = allSources.filter((file) => !file.split(/[\\/]/u).includes("node_modules"));
    try {
        for (const file of projectSources)
            assertCompilerSource(cwd, file);
    }
    catch {
        return { ...inputs, clean: false, errors: [], files: 0, sources: [], dependencies: [], incompleteReason: "The compiler followed source inputs outside the evaluated project tree" };
    }
    const inputFiles = [...new Set([...allSources, ...installedManifests(allSources)])];
    const entries = inputFiles.map((file) => ({ path: file, digest: digest(fs.readFileSync(file)) }));
    const sources = entries.filter((entry) => !entry.path.split(/[\\/]/u).includes("node_modules"));
    const dependencies = entries.filter((entry) => entry.path.split(/[\\/]/u).includes("node_modules"));
    return { ...inputs, sources, dependencies, clean: out.status === 0 && errors.length === 0, errors, options, configPath, files: projectSources.length };
}
/** Beyond-`strict` flags worth adopting, with the one-line reason. */
export const STRICTNESS_FLAGS = [
    { flag: "strict", why: "the baseline; enables the core strict checks" },
    { flag: "noUncheckedIndexedAccess", why: "index signatures include undefined; catches a real bug class strict misses" },
    { flag: "exactOptionalPropertyTypes", why: "optional props cannot be explicitly assigned undefined" },
    { flag: "noImplicitOverride", why: "requires the override keyword; catches accidental method shadowing" },
    { flag: "noImplicitReturns", why: "every code path must return a value" },
    { flag: "noFallthroughCasesInSwitch", why: "catches accidental switch fallthrough" },
    { flag: "noUnusedLocals", why: "unused locals are compile-time dead code" },
    { flag: "noUnusedParameters", why: "unused parameters are compile-time dead code" },
    { flag: "noPropertyAccessFromIndexSignature", why: "index-signature access requires brackets; more explicit" },
];
/** Human-readable report. Returns true when tsc is clean (strictness gaps are advisory). */
export function reportTsc(cwd = process.cwd()) {
    const result = runTsc(cwd);
    if (!result.configPath) {
        console.log("TypeScript — no tsconfig.json found; add one to get a real gate.\n");
        return false;
    }
    if (result.incompleteReason) {
        console.log(`TypeScript — incomplete: ${result.incompleteReason}.\n`);
        return false;
    }
    if (!result.clean) {
        console.log(`TypeScript — ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}:\n`);
        for (const e of result.errors.slice(0, 25))
            console.log(`  ${e}`);
        if (result.errors.length > 25)
            console.log(`  … and ${result.errors.length - 25} more`);
        console.log("");
        return false;
    }
    console.log("TypeScript — 0 errors.\n");
    console.log("Strictness audit (advisory — adopt in tsconfig.json when ready):");
    for (const { flag, why } of STRICTNESS_FLAGS) {
        const on = result.options[flag] === true;
        console.log(`  ${on ? "✓" : "○"} ${flag}${on ? "" : ` — ${why}`}`);
    }
    console.log("");
    return true;
}
