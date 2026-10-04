/**
 * `abacus deadcode` — unused exports, files, types, and dependencies via knip.
 *
 * knip is bundled with abacus (like TypeScript), so the gate works with zero
 * extra installs. The consuming repo owns its knip.json (written by
 * `abacus init`), so entry points and exemptions are reviewed there, not here.
 * Exit 1 when any dead code is found.
 *
 * Known blind spot: knip cannot trace string-based dynamic imports such as
 * `lazyView("./js/views/adapt.js", "readAdaptView")`. If your project
 * lazy-loads modules by path string, add those files to knip.json `entry`
 * (or `ignore`) — otherwise they (and their exports) will be flagged.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
/** Path to the knip binary bundled with abacus, resolved relative to this module. */
export function knipBinPath() {
    const require = createRequire(import.meta.url);
    const main = require.resolve("knip");
    const bin = path.join(path.dirname(main), "..", "bin", "knip.js");
    if (!fs.existsSync(bin))
        throw new Error(`bundled knip not found at ${bin}`);
    return bin;
}
const ISSUE_TYPES = [
    "files", "exports", "types", "enumMembers", "namespaceMembers",
    "dependencies", "devDependencies", "optionalPeerDependencies",
    "unlisted", "unresolved", "duplicates", "binaries",
];
/** Parse knip's `--reporter json` output into a flat issue list. Exported for tests. */
export function parseKnipJson(stdout) {
    const json = stdout.slice(stdout.indexOf("{"));
    const data = JSON.parse(json);
    const issues = [];
    const counts = {};
    for (const fileIssues of data.issues ?? []) {
        for (const type of ISSUE_TYPES) {
            const items = fileIssues[type];
            if (!Array.isArray(items))
                continue;
            for (const item of items) {
                issues.push({ type, file: fileIssues.file, line: item.line ?? item.pos, name: item.name ?? fileIssues.file });
                counts[type] = (counts[type] ?? 0) + 1;
            }
        }
    }
    issues.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.name.localeCompare(b.name));
    return { issues, counts };
}
export function runKnip(cwd = process.cwd()) {
    const out = spawnSync(process.execPath, [knipBinPath(), "--reporter", "json"], {
        cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    if (out.error)
        throw new Error(`knip failed to run: ${out.error.message}`);
    // knip exits 1 when it finds issues; the JSON report is still on stdout.
    if (!out.stdout.includes("{")) {
        throw new Error(`knip produced no JSON output (exit ${out.status}): ${out.stderr.slice(0, 500)}`);
    }
    return parseKnipJson(out.stdout);
}
const TYPE_LABELS = {
    files: "unused files",
    exports: "unused exports",
    types: "unused types",
    enumMembers: "unused enum members",
    namespaceMembers: "unused namespace members",
    dependencies: "unused dependencies",
    devDependencies: "unused devDependencies",
    optionalPeerDependencies: "unused optional peerDependencies",
    unlisted: "unlisted dependencies",
    unresolved: "unresolved imports",
    duplicates: "duplicate dependencies",
    binaries: "unused binaries",
};
/** Human-readable report. Returns true when clean (no dead code). */
export function reportDeadcode(cwd = process.cwd()) {
    const report = runKnip(cwd);
    if (report.issues.length === 0) {
        console.log("Dead code — none found.\n");
        return true;
    }
    const total = report.issues.length;
    console.log(`Dead code — ${total} finding${total === 1 ? "" : "s"}:\n`);
    let lastType = "";
    for (const issue of report.issues) {
        if (issue.type !== lastType) {
            lastType = issue.type;
            console.log(`  ${TYPE_LABELS[issue.type] ?? issue.type} (${report.counts[issue.type]}):`);
        }
        const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
        console.log(`    ${loc}  ${issue.name}`);
    }
    console.log(`\n${total} dead-code finding${total === 1 ? "" : "s"}. Remove it, or exempt it in knip.json with a reason.`);
    return false;
}
/**
 * Detect knip `entry` points for `abacus init`: package.json main/exports/bin
 * plus src/index.ts when it exists (the Cloudflare Worker default).
 * Exported for tests.
 */
export function detectKnipEntry(cwd = process.cwd()) {
    const entry = new Set();
    const pkgFile = path.join(cwd, "package.json");
    if (fs.existsSync(pkgFile)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
            const push = (v) => {
                if (typeof v === "string" && /\.(tsx?|mjs|js)$/.test(v)) {
                    entry.add(v.replace(/^\.\//, ""));
                }
                else if (Array.isArray(v))
                    v.forEach(push);
                else if (v && typeof v === "object")
                    Object.values(v).forEach(push);
            };
            push(pkg.main);
            push(pkg.exports);
            if (pkg.bin && typeof pkg.bin === "object")
                Object.values(pkg.bin).forEach(push);
            else
                push(pkg.bin);
        }
        catch { /* unreadable package.json: fall through to defaults */ }
    }
    // Cloudflare Worker entry point from wrangler config (TOML or JSONC).
    for (const wf of ["wrangler.toml", "wrangler.json", "wrangler.jsonc"]) {
        const wfPath = path.join(cwd, wf);
        if (fs.existsSync(wfPath)) {
            const text = fs.readFileSync(wfPath, "utf8");
            const m = text.match(/^\s*main\s*=\s*["']([^"']+)["']/m) ?? text.match(/"main"\s*:\s*"([^"]+)"/);
            if (m)
                entry.add(m[1].replace(/^\.\//, ""));
        }
    }
    for (const fallback of ["src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx", "src/worker.ts"]) {
        if (fs.existsSync(path.join(cwd, fallback)))
            entry.add(fallback);
    }
    // Traditional client bundle entry (script-tag loaded, imports the rest).
    for (const fallback of ["public/app.js", "public/app.ts", "public/main.js", "public/main.ts"]) {
        if (fs.existsSync(path.join(cwd, fallback)))
            entry.add(fallback);
    }
    // Files executed by external runners, never imported: test files, tool
    // configs, and standalone scripts. Without these, knip flags every test
    // as an "unused file".
    entry.add("**/*.test.{ts,tsx}");
    entry.add("**/*.spec.{ts,tsx}");
    entry.add("**/*.e2e.{ts,tsx,js,mjs}");
    entry.add("*.config.{ts,js,mjs}");
    entry.add(".dependency-cruiser.{js,cjs,mjs}");
    entry.add("scripts/**/*.{ts,js,mjs}");
    return [...entry];
}
/** knip.json content for `abacus init`. Entry points are detected, not guessed. */
export function knipConfig(cwd = process.cwd()) {
    return `${JSON.stringify({
        $schema: "https://unpkg.com/knip@6/schema.json",
        entry: detectKnipEntry(cwd),
        // Generated build output is scanned by size budgets, not source dead-code checks.
        ignore: ["dist/**", ".next/**", ".open-next/**", ".wrangler/**"],
        ignoreExportsUsedInFile: true,
    }, null, 2)}\n`;
}
