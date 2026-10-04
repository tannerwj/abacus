/**
 * abacus.config.json — lives in the consuming repo so every budget and every
 * exemption is owned (and reviewed) there. Everything has a default; an empty
 * `{}` is a valid config for the `typescript` preset.
 */
import fs from "node:fs";
import path from "node:path";
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
        exclude: ["\\.d\\.ts$", "\\.test\\.tsx?$", "/components/ui/"],
        abc: { budget: 60, allow: {} },
        size: { budgets: [] },
        ratchet: { file: "abacus.ratchet.json", metrics: { loc: { roots: ["src"], slack: 0.02 }, oxlintWarnings: true, abcMax: true, comments: { roots: ["src"], max: 0.3 } } }
    };
    if (preset === "cloudflare-worker")
        base.size.worker = { max: 400 * KB };
    if (preset === "nextjs")
        base.exclude.push("/components/ui/", "^\\.next/", "^\\.open-next/", "next-env\\.d\\.ts$");
    if (preset === "vite-spa" || preset === "cloudflare-worker") {
        base.size.budgets = [
            { label: "SPA JS (all chunks, gzip)", dir: "dist/client/assets", match: "\\.js$", max: 280 * KB },
            { label: "SPA largest JS chunk (gzip)", dir: "dist/client/assets", match: "\\.js$", max: 260 * KB, mode: "largest" },
            { label: "SPA CSS (gzip)", dir: "dist/client/assets", match: "\\.css$", max: 20 * KB }
        ];
    }
    return base;
}
export function loadConfig(cwd = process.cwd()) {
    const file = path.join(cwd, CONFIG_FILE);
    if (!fs.existsSync(file))
        return defaults("typescript");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const base = defaults(raw.preset ?? "typescript");
    return {
        preset: raw.preset ?? base.preset,
        check: loadCheck(raw.check, base.check),
        roots: raw.roots ?? base.roots,
        exclude: raw.exclude ?? base.exclude,
        abc: { budget: raw.abc?.budget ?? base.abc.budget, allow: raw.abc?.allow ?? {} },
        size: { budgets: raw.size?.budgets ?? base.size.budgets, worker: raw.size?.worker ?? base.size.worker },
        ratchet: { file: raw.ratchet?.file ?? base.ratchet.file, metrics: raw.ratchet?.metrics ?? base.ratchet.metrics }
    };
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
    return { gates: validateCheckGates(raw?.gates ?? base.gates) };
}
