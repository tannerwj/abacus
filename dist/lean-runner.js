import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadConfig } from "./config.js";
import { digest } from "./evidence.js";
import { canonicalPolicyJson } from "./canonical-json.js";
import { leanConfigurationDigest } from "./lean-config.js";
import { leanInputs } from "./lean-inputs.js";
import { leanAdapterDigest } from "./lean-adapter.js";
import { validateLeanEvidence } from "./lean-report.js";
import { reportArray, reportObject } from "./verification-reports.js";
const AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);
function reportDestination(file, cwd) {
    const requested = path.resolve(cwd, file);
    const canonical = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
    const relative = path.relative(fs.realpathSync(cwd), canonical);
    if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
        throw new Error("Lean report must be outside the evaluated project tree");
    if (fs.existsSync(canonical))
        throw new Error("Lean report requires a fresh path");
    return canonical;
}
function toolHashes(toolchain) {
    const read = (name) => {
        const file = path.join(toolchain, "bin", name);
        if (!fs.statSync(file).isFile())
            throw new Error(`Missing Lean tool: ${name}`);
        return digest(fs.readFileSync(file));
    };
    return { lean: read("lean"), lake: read("lake"), leanchecker: read("leanchecker") };
}
function fileDigest(file) {
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    const fd = fs.openSync(file, "r");
    try {
        let length;
        while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
            hash.update(buffer.subarray(0, length));
        return hash.digest("hex");
    }
    finally {
        fs.closeSync(fd);
    }
}
function toolchainFiles(root, relative) {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
        const destination = fs.realpathSync(file), inside = path.relative(root, destination);
        if (inside.startsWith(`..${path.sep}`) ||
            inside === ".." ||
            path.isAbsolute(inside) ||
            !fs.statSync(destination).isFile())
            throw new Error("Toolchain symlinks must resolve to files inside the distribution");
        return [{ path: relative, link: fs.readlinkSync(file), digest: fileDigest(destination) }];
    }
    if (stat.isDirectory())
        return fs
            .readdirSync(file)
            .sort()
            .flatMap((name) => toolchainFiles(root, `${relative}/${name}`));
    if (!stat.isFile())
        throw new Error("Unsupported toolchain file");
    return [{ path: relative, digest: fileDigest(file) }];
}
export function digestToolchain(toolchainDir) {
    const root = fs.realpathSync(toolchainDir);
    return digest(canonicalPolicyJson(["bin", "lib"].flatMap((dir) => toolchainFiles(root, dir))));
}
function sandboxArgs(sandbox, args, audit) {
    const mounts = ["/usr", "/lib", "/lib64"].filter((dir) => fs.existsSync(dir));
    return [
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--clearenv",
        ...mounts.flatMap((dir) => ["--ro-bind", dir, dir]),
        "--ro-bind",
        sandbox.toolchain,
        "/toolchain",
        "--ro-bind",
        path.resolve(import.meta.dirname, "../configs/lean"),
        "/audit",
        "--ro-bind",
        sandbox.work,
        "/work",
        "--bind",
        path.join(sandbox.work, ".lake"),
        "/work/.lake",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--dir",
        "/home",
        "--dir",
        "/home/lean",
        "--setenv",
        "HOME",
        "/home/lean",
        "--setenv",
        "PATH",
        "/toolchain/bin:/usr/bin",
        "--setenv",
        "LEAN_SYSROOT",
        "/toolchain",
        "--setenv",
        "LANG",
        "C.UTF-8",
        "--setenv",
        "LEAN_PATH",
        audit ? "/toolchain/lib/lean" : "/work/.lake/build/lib/lean",
        "--chdir",
        audit ? "/audit" : "/work",
        "--",
        ...args,
    ];
}
function isolated(sandbox, args, audit = false) {
    const timeout = sandbox.deadline - Date.now();
    if (timeout < 1)
        throw new Error("Lean verification timed out");
    const result = spawnSync("/usr/bin/bwrap", sandboxArgs(sandbox, args, audit), {
        encoding: "utf8",
        shell: false,
        timeout,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin" },
    });
    if (result.error || result.signal || result.status !== 0)
        throw new Error(`Isolated Lean command failed (${args[0]}): ${result.error?.message ?? result.stderr.slice(0, 4000)}`);
    return result.stdout;
}
function selectedConfig(id, cwd) {
    const spec = loadConfig(cwd).verification?.reports.find((item) => item.id === id);
    if (spec?.format !== "lean" || spec.profile !== "formal" || !spec.lean)
        throw new Error("Lean requires a configured formal verification report");
    return spec.lean;
}
function copyProject(config, cwd, work) {
    const project = path.resolve(cwd, config.project);
    for (const input of leanInputs(config, cwd)) {
        const source = path.resolve(cwd, input.path);
        const relative = path.relative(project, source);
        if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
            continue;
        if (!relative.endsWith(".lean") &&
            !["lean-toolchain", "lakefile.toml", "lake-manifest.json"].includes(relative))
            continue;
        const target = path.join(work, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
}
function auditTarget(sandbox, target) {
    const output = isolated(sandbox, [
        "/toolchain/bin/lean",
        "--run",
        "/audit/Audit.lean",
        "/work/.lake/build/lib/lean",
        target.module,
        target.name,
    ], true);
    const raw = reportObject(JSON.parse(output));
    if (raw.module !== target.module || raw.name !== target.name || !Array.isArray(raw.type))
        throw new Error("Lean auditor returned a different theorem");
    const typeDigest = digest(canonicalPolicyJson(raw.type));
    if (typeDigest !== target.typeDigest)
        throw new Error(`Lean theorem type changed: ${target.name}; actual type digest ${typeDigest}`);
    const axioms = reportArray(raw.axioms);
    if (!axioms.every((axiom) => typeof axiom === "string" && AXIOMS.has(axiom)))
        throw new Error(`Lean theorem uses forbidden axioms: ${target.name}: ${JSON.stringify(axioms)}`);
    if (new Set(axioms).size !== axioms.length)
        throw new Error("Duplicate Lean axiom audit results");
    return { ...target, typeDigest, axioms, checked: true, rechecked: true };
}
function executionIdentity(config, cwd, toolchain) {
    return {
        tools: toolHashes(toolchain),
        toolchainDigest: digestToolchain(toolchain),
        adapterDigest: leanAdapterDigest(),
        inputs: leanInputs(config, cwd),
    };
}
export function runLeanVerification(options, cwd = process.cwd()) {
    const started = Date.now();
    if (process.platform !== "linux")
        throw new Error("Lean runner requires Linux bubblewrap isolation");
    const timeout = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3_600_000)
        throw new Error("Lean timeout must be 1 through 3600000 milliseconds");
    const config = selectedConfig(options.id, cwd);
    const destination = reportDestination(options.report, cwd);
    const toolchain = fs.realpathSync(options.toolchainDir);
    const identity = executionIdentity(config, cwd, toolchain);
    if (canonicalPolicyJson(identity.tools) !== canonicalPolicyJson(config.tools))
        throw new Error("Lean tooling does not match the configured binary digests");
    if (identity.toolchainDigest !== config.toolchainDigest)
        throw new Error("Lean distribution does not match the configured digest");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "abacus-lean-"));
    const sandbox = { toolchain, work, deadline: started + timeout };
    try {
        copyProject(config, cwd, work);
        fs.mkdirSync(path.join(work, ".lake"));
        const version = isolated(sandbox, ["/toolchain/bin/lean", "--version"]);
        if (!version.startsWith("Lean (version 4.34.1,"))
            throw new Error("Unsupported Lean toolchain version");
        const modules = [...new Set(config.targets.map((target) => target.module))];
        isolated(sandbox, ["/toolchain/bin/lake", "build", ...modules.map((module) => `+${module}`)]);
        for (const module of modules)
            isolated(sandbox, ["/toolchain/bin/leanchecker", "--fresh", module]);
        const targets = config.targets.map((target) => auditTarget(sandbox, target));
        if (canonicalPolicyJson(identity) !==
            canonicalPolicyJson(executionIdentity(config, cwd, toolchain)))
            throw new Error("Lean inputs or tools changed during verification");
        const report = {
            schemaVersion: 1,
            kind: "lean",
            claim: "model",
            configurationDigest: leanConfigurationDigest(config),
            toolchain: config.toolchain,
            ...identity,
            targets,
        };
        validateLeanEvidence(report, config, cwd);
        const serialized = `${JSON.stringify(report, null, 2)}\n`;
        if (Date.now() > sandbox.deadline)
            throw new Error("Lean verification timed out");
        fs.writeFileSync(destination, serialized, { flag: "wx" });
        return report;
    }
    finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}
