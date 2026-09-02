/**
 * abacus.config.json — lives in the consuming repo so every budget and every
 * exemption is owned (and reviewed) there. Everything has a default; an empty
 * `{}` is a valid config for the `typescript` preset.
 */
import fs from "node:fs";
import path from "node:path";
export const CONFIG_FILE = "abacus.config.json";
const KB = 1024;
export function defaults(preset) {
    const base = {
        preset,
        roots: ["src", "scripts"],
        exclude: ["\\.d\\.ts$", "\\.test\\.tsx?$", "/components/ui/"],
        abc: { budget: 60, allow: {} },
        size: { budgets: [] }
    };
    if (preset === "cloudflare-worker")
        base.size.worker = { max: 400 * KB };
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
        roots: raw.roots ?? base.roots,
        exclude: raw.exclude ?? base.exclude,
        abc: { budget: raw.abc?.budget ?? base.abc.budget, allow: raw.abc?.allow ?? {} },
        size: { budgets: raw.size?.budgets ?? base.size.budgets, worker: raw.size?.worker ?? base.size.worker }
    };
}
