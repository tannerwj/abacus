import fs from "node:fs";
import path from "node:path";
import { digest } from "./evidence.js";
import { canonicalPolicyJson } from "./canonical-json.js";

export function leanAdapterDigest(): string {
  const directory = import.meta.dirname;
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort();
  if (!files.length) throw new Error("Lean adapter requires built Abacus modules");
  const entries = files.map((file) => ({
    path: `dist/${file}`,
    digest: digest(fs.readFileSync(path.join(directory, file))),
  }));
  const auditor = "configs/lean/Audit.lean";
  entries.push({
    path: auditor,
    digest: digest(fs.readFileSync(path.resolve(directory, "..", auditor))),
  });
  return digest(canonicalPolicyJson(entries));
}
