import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { digest, type RunEvidence } from "./evidence.js";
import { assertProjectPath } from "./config.js";

const IGNORED = new Set([".git", "node_modules"]);
/**
 * Every file under the project except `.git`, `node_modules` and paths the
 * repository excludes (`provenance.exclude`: tool state such as a local dev
 * server's database, which changes while checks run). Directories are tested
 * with a trailing slash, so `^\\.wrangler/` skips the whole tree.
 */
function inputs(root: string, skip: RegExp[], dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (entry.isDirectory()) return skip.some((re) => re.test(relative + "/")) ? [] : inputs(root, skip, file);
    if (skip.some((re) => re.test(relative))) return [];
    if (entry.isSymbolicLink()) {
      assertProjectPath(root, fs.realpathSync(file), "Input symlink target");
      if (!fs.statSync(file).isFile()) throw new Error("Input directory symlinks need an explicit supported scope");
      return [path.relative(root, file)];
    }
    return entry.isFile() ? [path.relative(root, file)] : [];
  }).sort();
}
export function sourceProvenance(cwd: string, exclude: string[] = []): RunEvidence["source"] {
  const files = inputs(cwd, exclude.map((expression) => new RegExp(expression, "u")));
  const manifest = files.map((file) => {
    const full = path.join(cwd, file);
    return [file.replaceAll(path.sep, "/"), digest(fs.readFileSync(full)), fs.lstatSync(full).isSymbolicLink() ? fs.readlinkSync(full) : null];
  });
  const git = (args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
  const revision = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  return { commit: revision.status === 0 ? revision.stdout.trim() : null, treeDigest: digest(JSON.stringify(manifest)), dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}
