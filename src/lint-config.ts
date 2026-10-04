import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Known Oxlint native semantics only: shared ignores must be rooted at the consumer. */
export function sharedLintIgnores(file: string, visited = new Set<string>()): string[] {
  const resolved = fs.realpathSync(file);
  if (visited.has(resolved)) throw new Error("Circular shared Oxlint extends configuration");
  visited.add(resolved);
  const parsed = ts.parseConfigFileTextToJson(resolved, fs.readFileSync(resolved, "utf8"));
  const raw: unknown = parsed.config;
  if (parsed.error || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Shared Oxlint config must be JSON or JSONC data");
  if ("overrides" in raw && (!Array.isArray(raw.overrides) || raw.overrides.length)) throw new Error("Shared Oxlint directory-relative overrides are unsupported in this profile");
  if ("files" in raw || "excludeFiles" in raw) throw new Error("Shared Oxlint directory-relative file selectors are unsupported in this profile");
  const patterns = "ignorePatterns" in raw ? raw.ignorePatterns : [];
  if (!Array.isArray(patterns) || !patterns.every((item): item is string => typeof item === "string" && item.trim().length > 0 && !item.startsWith("-"))) throw new Error("Invalid shared Oxlint ignorePatterns");
  const refs = "extends" in raw ? raw.extends : [];
  const extended = typeof refs === "string" ? [refs] : refs;
  if (!Array.isArray(extended) || !extended.every((item): item is string => typeof item === "string" && item.startsWith("./"))) throw new Error("Shared Oxlint extends must use declared bundled relative files");
  const inherited = extended.flatMap((ref) => sharedLintIgnores(path.resolve(path.dirname(resolved), ref), new Set(visited)));
  return [...new Set([...inherited, ...patterns])];
}
