/**
 * `abacus secrets` — leaked-credential scan via gitleaks.
 *
 * gitleaks is bundled through the @b12k/gitleaks npm wrapper (downloads the
 * official gitleaks release and verifies its sha256), so the gate runs with
 * zero extra installs. Scans the working tree (--no-git); respects .gitignore.
 *
 * Secret values are NEVER printed: findings report file, line, and rule only.
 * Exit 1 when any finding is present.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
/** Path to the gitleaks binary bundled with abacus, resolved relative to this module. */
export function gitleaksBinPath() {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@b12k/gitleaks/package.json");
    const bin = path.join(path.dirname(pkgJson), "dist", process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
    if (!fs.existsSync(bin))
        throw new Error(`bundled gitleaks not found at ${bin}`);
    return bin;
}
/** Run gitleaks detect on the working tree. Secret values are dropped, never returned. */
export function scanSecretReport(cwd = process.cwd(), configPath) {
    cwd = path.resolve(cwd);
    const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "abacus-secrets-")), "report.json");
    try {
        const out = spawnSync(gitleaksBinPath(), ["detect", "--source", ".", "--report-format", "json", "--report-path", reportPath, "--no-banner", "--no-git", ...(configPath ? ["--config", configPath] : [])], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
        if (out.error)
            throw new Error(`gitleaks failed to run: ${out.error.message}`);
        // gitleaks exits 1 when it finds leaks; anything else non-zero is a real error.
        if (out.status !== 0 && out.status !== 1) {
            throw new Error(`gitleaks exited ${out.status}`);
        }
        if (!fs.existsSync(reportPath))
            throw new Error("gitleaks produced no report");
        const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        if (!Array.isArray(raw) || !raw.every((f) => typeof f.File === "string" && Number.isInteger(f.StartLine) && typeof f.RuleID === "string"))
            throw new Error("gitleaks produced an invalid report");
        if (out.status === 1 && raw.length === 0)
            throw new Error("gitleaks failed without findings");
        const match = /scanned ~([\d.]+) bytes/u.exec(out.stderr ?? "");
        const bytes = match ? Number(match[1]) : 0;
        return { bytes, findings: raw.map((f) => ({
                // Resolve relative native paths against the scanned tree, never the caller's cwd.
                file: path.relative(cwd, path.resolve(cwd, f.File)).split(path.sep).join("/"),
                line: f.StartLine,
                rule: f.RuleID,
                description: f.Description ?? "",
            })) };
    }
    finally {
        fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });
    }
}
export function scanSecrets(cwd = process.cwd()) {
    return scanSecretReport(cwd).findings;
}
/** Human-readable report. Returns true when clean (no findings). */
export function reportSecrets(cwd = process.cwd()) {
    const findings = scanSecrets(cwd);
    if (findings.length === 0) {
        console.log("Secrets — none found.\n");
        return true;
    }
    console.log(`Secrets — ${findings.length} finding${findings.length === 1 ? "" : "s"}:\n`);
    for (const f of findings) {
        const desc = f.description ? `  ${f.description}` : "";
        console.log(`  ${f.file}:${f.line}  ${f.rule}${desc}`);
    }
    console.log(`\n${findings.length} potential secret${findings.length === 1 ? "" : "s"}. ` +
        `Rotate any real credential, then allowlist test fixtures in .gitleaks.toml.`);
    return false;
}
