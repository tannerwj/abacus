import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./evidence.js";
/** Find an installed package without depending on its exports map. */
function packageManifest(packageName, start) {
    let dir = path.resolve(start);
    for (;;) {
        const manifest = path.join(dir, "node_modules", packageName, "package.json");
        if (fs.existsSync(manifest))
            return manifest;
        const parent = path.dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
/**
 * Resolve the declared JavaScript CLI, preferring the project's installation.
 * npm/pnpm .bin files may be shell or Windows .cmd shims, not Node programs.
 */
export function nodeToolBinPath(packageName, command, cwd = process.cwd(), moduleUrl = import.meta.url) {
    const manifest = packageManifest(packageName, cwd)
        ?? packageManifest(packageName, path.dirname(fileURLToPath(moduleUrl)));
    if (!manifest)
        throw new Error(`no ${command} found (checked project and bundled ${packageName})`);
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (!pkg || typeof pkg !== "object" || !("bin" in pkg)) {
        throw new Error(`no ${command} bin entry in ${manifest}`);
    }
    const bins = pkg.bin;
    const entry = typeof bins === "string" ? bins
        : bins && typeof bins === "object" ? Reflect.get(bins, command) : undefined;
    if (typeof entry !== "string")
        throw new Error(`no ${command} bin entry in ${manifest}`);
    const bin = path.resolve(path.dirname(manifest), entry);
    if (!fs.existsSync(bin))
        throw new Error(`${command} bin not found at ${bin}`);
    return bin;
}
/** Run a declared Node CLI directly, with arguments kept out of a shell. */
export function runNodeTool(bin, args, cwd, env) {
    return spawnSync(process.execPath, [bin, ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
        timeout: 120_000,
        env: env ? { ...process.env, ...env } : process.env,
    });
}
/** Metadata for the actual resolved installation, rather than a PATH guess. */
export function toolMetadata(bin, name) {
    let dir = path.dirname(fs.realpathSync(bin));
    for (;;) {
        const file = path.join(dir, "package.json");
        if (fs.existsSync(file)) {
            const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
            if (pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string") {
                return { name, version: pkg.version, digest: digest(fs.readFileSync(bin)) };
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            throw new Error(`Cannot determine ${name} version`);
        dir = parent;
    }
}
