import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { digest } from "./evidence.js";
import { arrayValue, objectValue } from "./json-values.js";
import { LEAN_TOOLCHAIN, leanFields, leanName, leanPath } from "./lean-config.js";
export function leanInputFile(cwd, relative) {
    leanPath(relative);
    let file = fs.realpathSync(cwd);
    for (const part of relative.split("/")) {
        file = path.join(file, part);
        if (fs.lstatSync(file).isSymbolicLink())
            throw new Error("Lean inputs cannot contain symlinks");
    }
    return file;
}
function projectFiles(cwd, relative) {
    const directory = leanInputFile(cwd, relative);
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === ".lake")
            return [];
        const name = `${relative}/${entry.name}`;
        if (entry.isDirectory())
            return projectFiles(cwd, name);
        if (!entry.isFile())
            throw new Error("Unsupported Lean input file");
        return [name];
    });
}
function validateProject(config, cwd) {
    const read = (name) => fs.readFileSync(leanInputFile(cwd, `${config.project}/${name}`), "utf8");
    if (read("lean-toolchain").trim() !== LEAN_TOOLCHAIN)
        throw new Error("Lean toolchain file does not match pin");
    const manifest = leanFields(JSON.parse(read("lake-manifest.json")), [
        "version",
        "packagesDir",
        "packages",
        "name",
        "lakeDir",
    ]);
    if (manifest.version !== "1.1.0" ||
        manifest.packagesDir !== ".lake/packages" ||
        manifest.lakeDir !== ".lake")
        throw new Error("Unsupported Lake manifest layout");
    if (arrayValue(manifest.packages).length)
        throw new Error("External Lean dependencies are not supported");
    const lake = objectValue(parse(read("lakefile.toml")));
    if (Object.keys(lake).some((key) => !["name", "version", "defaultTargets", "lean_lib"].includes(key)))
        throw new Error("Unsupported Lake configuration");
    if (manifest.name !== leanName(lake.name))
        throw new Error("Lake manifest project identity differs");
    const libraries = arrayValue(lake.lean_lib);
    if (!libraries.length)
        throw new Error("Lean project requires a library");
    for (const library of libraries)
        leanName(leanFields(library, ["name"]).name);
    if (lake.defaultTargets !== undefined)
        arrayValue(lake.defaultTargets).forEach(leanName);
}
export function leanInputs(config, cwd) {
    validateProject(config, cwd);
    const files = projectFiles(cwd, config.project);
    if (files.some((file) => /(?:^|\/)(?:lakefile\.lean|[^/]+\.olean|[^/]+\.so)$/u.test(file)))
        throw new Error("Executable Lake configuration and prebuilt proof artifacts are unsupported");
    for (const target of config.targets)
        if (!files.includes(`${config.project}/${target.module.replaceAll(".", "/")}.lean`))
            throw new Error("Registered Lean module is missing");
    return [...new Set([...files, ...config.specifications])].sort().map((file) => {
        const input = leanInputFile(cwd, file), stat = fs.statSync(input);
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
            throw new Error("Invalid Lean input size or kind");
        return { path: file, digest: digest(fs.readFileSync(input)) };
    });
}
