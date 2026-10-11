import { digest } from "./evidence.js";
import { canonicalPolicyJson } from "./canonical-json.js";
import { arrayValue, objectValue, stringValue } from "./json-values.js";

export const LEAN_TOOLCHAIN = "leanprover/lean4:v4.34.1";
export const LEAN_TOOLS = ["lean", "lake", "leanchecker"] as const;
export interface LeanTarget {
  module: string;
  name: string;
  typeDigest: string;
}
export interface LeanConfig {
  project: string;
  specifications: string[];
  toolchain: typeof LEAN_TOOLCHAIN;
  toolchainDigest: string;
  tools: Record<(typeof LEAN_TOOLS)[number], string>;
  targets: LeanTarget[];
}
export function leanFields(value: unknown, keys: string[]): Record<string, unknown> {
  const raw = objectValue(value);
  if (Object.keys(raw).some((key) => !keys.includes(key)) || keys.some((key) => !(key in raw)))
    throw new Error("Unsupported or missing Lean field");
  return raw;
}
export function leanHash(value: unknown): string {
  const hash = stringValue(value);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid Lean digest");
  return hash;
}
export function leanName(value: unknown): string {
  const name = stringValue(value);
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/u.test(name) || name.length > 160)
    throw new Error("Unsupported Lean declaration or module name");
  return name;
}
export function leanPath(value: unknown): string {
  const file = stringValue(value);
  if (
    !file ||
    file.startsWith("/") ||
    file.includes("\\") ||
    file.includes("\0") ||
    file.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Lean paths must be canonical project-relative paths");
  return file;
}
export function leanUnique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error("Duplicate Lean identity");
}
export function leanTools(value: unknown): LeanConfig["tools"] {
  const raw = leanFields(value, [...LEAN_TOOLS]);
  return {
    lean: leanHash(raw.lean),
    lake: leanHash(raw.lake),
    leanchecker: leanHash(raw.leanchecker),
  };
}
export function leanTarget(value: unknown): LeanTarget {
  const raw = leanFields(value, ["module", "name", "typeDigest"]);
  return {
    module: leanName(raw.module),
    name: leanName(raw.name),
    typeDigest: leanHash(raw.typeDigest),
  };
}
export function validateLeanConfig(value: unknown): LeanConfig {
  const raw = leanFields(value, [
    "project",
    "specifications",
    "toolchain",
    "toolchainDigest",
    "tools",
    "targets",
  ]);
  if (raw.toolchain !== LEAN_TOOLCHAIN) throw new Error("Unsupported Lean toolchain");
  const specifications = arrayValue(raw.specifications).map(leanPath),
    targets = arrayValue(raw.targets).map(leanTarget);
  if (!specifications.length || !targets.length)
    throw new Error("Lean requires specifications and registered theorem targets");
  leanUnique(specifications);
  leanUnique(targets.map((target) => target.name));
  return {
    project: leanPath(raw.project),
    specifications,
    toolchain: LEAN_TOOLCHAIN,
    toolchainDigest: leanHash(raw.toolchainDigest),
    tools: leanTools(raw.tools),
    targets,
  };
}
export function leanConfigurationDigest(config: LeanConfig): string {
  return digest(canonicalPolicyJson(validateLeanConfig(config)));
}
