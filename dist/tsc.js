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
import ts from "typescript";
import { nodeToolBinPath, runNodeTool } from "./tool-runner.js";
/** Project's tsc if installed, else the TypeScript bundled with abacus. */
export function tscBinPath(cwd = process.cwd()) {
    return nodeToolBinPath("typescript", "tsc", cwd);
}
/** Resolve the effective tsconfig (following `extends`) via the TS API. Exported for tests. */
export function effectiveOptions(cwd = process.cwd()) {
    const configPath = ts.findConfigFile(cwd, (file) => ts.sys.fileExists(file), "tsconfig.json");
    if (!configPath)
        return { options: {} };
    const configFile = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
    if (configFile.error)
        return { options: {}, configPath };
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    return { options: parsed.options, configPath };
}
export function runTsc(cwd = process.cwd()) {
    const { options, configPath } = effectiveOptions(cwd);
    const out = runNodeTool(tscBinPath(cwd), ["--noEmit", "--pretty", "false", "--listFiles"], cwd);
    if (out.error)
        throw new Error(`tsc failed to run: ${out.error.message}`);
    const text = `${out.stdout ?? ""}\n${out.stderr ?? ""}`;
    const errors = text.split("\n").filter((l) => /error TS\d+/.test(l));
    if (out.status !== 0 && errors.length === 0)
        throw new Error("tsc failed without compiler diagnostics");
    const files = text.split("\n").filter((line) => path.isAbsolute(line) && /\.[cm]?tsx?$/.test(line) && !line.includes(`${path.sep}node_modules${path.sep}`)).length;
    return { clean: out.status === 0 && errors.length === 0, errors, options, configPath, files };
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
