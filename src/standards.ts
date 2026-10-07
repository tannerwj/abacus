import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { digest, type RunEvidence } from "./evidence.js";
import { defaults, assertProjectPath } from "./config.js";
import { canonicalPolicyJson } from "./policy.js";
import { sourceProvenance } from "./provenance.js";
import { jsonObject, enumValue } from "./json-values.js";

export type StandardsClassification = "weakening" | "tightening" | "review";
export interface StandardsChange {
  file: string;
  field: string;
  classification: StandardsClassification;
  reason: string;
  beforeDigest: string;
  afterDigest: string;
}
export interface StandardsReport {
  schemaVersion: 1;
  base: { commit: string };
  source: RunEvidence["source"];
  changes: StandardsChange[];
  clean: boolean;
  limitations: string[];
}
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);
const encoded = (value: unknown) => (value === undefined ? "absent" : canonicalPolicyJson(value));
const same = (before: unknown, after: unknown) => encoded(before) === encoded(after);
const identity = (field: string) => field.replaceAll("~", "~0").replaceAll("/", "~1");

function arrays(
  field: string,
  before: unknown[],
  after: unknown[],
): { classification: StandardsClassification; reason: string } {
  const old = new Set(before.map(encoded)),
    next = new Set(after.map(encoded));
  const removed = [...old].some((entry) => !next.has(entry)),
    added = [...next].some((entry) => !old.has(entry));
  if (/\/(?:exclude|ignorePatterns|ignore|exceptions)$/u.test(field))
    return {
      classification: added ? "weakening" : "tightening",
      reason: added
        ? "New exclusions or exceptions require review"
        : "Exclusions or exceptions were removed",
    };
  if (/\/(?:gates|roots|projects|targets|assertions)$/u.test(field))
    return {
      classification: removed ? "weakening" : "tightening",
      reason: removed
        ? "Previously required checks or targets were removed"
        : "Checks or targets were added",
    };
  return {
    classification: "review",
    reason: added || removed ? "List membership changed" : "List order changed",
  };
}
function numeric(
  field: string,
  before: number,
  after: number,
  baseline: boolean,
): { classification: StandardsClassification; reason: string } {
  const minimum = field.endsWith("/minSamples");
  if (baseline || /\/(?:max|budget|slack|maxAgeHours|maxSkipped|maxFlaky)$/u.test(field))
    return {
      classification: after > before ? "weakening" : "tightening",
      reason: `Ceiling changed from ${before} to ${after}`,
    };
  if (minimum)
    return {
      classification: after < before ? "weakening" : "tightening",
      reason: `Required samples changed from ${before} to ${after}`,
    };
  return { classification: "review", reason: "Numeric configuration changed" };
}
function classify(
  field: string,
  before: unknown,
  after: unknown,
  baseline: boolean,
): { classification: StandardsClassification; reason: string } {
  if (typeof before === "number" && typeof after === "number")
    return numeric(field, before, after, baseline);
  if (Array.isArray(before) && Array.isArray(after)) return arrays(field, before, after);
  if (field.endsWith("/enforcement")) {
    const ranks: Record<string, number> = { observe: 0, warn: 1, block: 2 };
    if (Object.hasOwn(ranks, String(before)) && Object.hasOwn(ranks, String(after)))
      return {
        classification: ranks[String(after)] < ranks[String(before)] ? "weakening" : "tightening",
        reason: "Check enforcement changed",
      };
  }
  if (typeof before === "boolean" && typeof after === "boolean")
    return {
      classification: field.endsWith("/allowEmpty")
        ? after
          ? "weakening"
          : "tightening"
        : before && !after
          ? "weakening"
          : "tightening",
      reason: "A requirement or metric was enabled or disabled",
    };
  if (field.startsWith("/policy/exceptions/") || field.startsWith("/abc/allow/")) {
    if (before === undefined)
      return {
        classification: "weakening",
        reason: "A finding waiver or complexity allowance was added",
      };
    if (after === undefined)
      return {
        classification: "tightening",
        reason: "A finding waiver or complexity allowance was removed",
      };
  }
  if (after === undefined)
    return { classification: "weakening", reason: "Previously configured standard was removed" };
  return { classification: "review", reason: "Configuration changed; its effect needs review" };
}
function keyedArray(value: unknown): Json | undefined {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) => object(item) && (typeof item.id === "string" || typeof item.label === "string"),
    )
  )
    return undefined;
  const entries = value.map((item) => [String(item.id ?? item.label), item] as const);
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error("Standards contain duplicate logical identities");
  return Object.fromEntries(entries);
}
function fields(
  file: string,
  before: unknown,
  after: unknown,
  field = "",
  baseline = false,
  depth = 0,
): StandardsChange[] {
  if (depth > 100) throw new Error("Standards nesting exceeds supported depth");
  if (same(before, after)) return [];
  const keyedBefore = keyedArray(before),
    keyedAfter = keyedArray(after);
  if (keyedBefore && keyedAfter)
    return fields(file, keyedBefore, keyedAfter, field, baseline, depth + 1);
  if (object(before) && object(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) =>
        fields(file, before[key], after[key], `${field}/${identity(key)}`, baseline, depth + 1),
      );
  return [
    {
      file,
      field: field || "/",
      ...classify(field, before, after, baseline),
      beforeDigest: digest(encoded(before)),
      afterDigest: digest(encoded(after)),
    },
  ];
}
function effective(raw: unknown): Json {
  if (!object(raw)) throw new Error("Invalid Abacus standards configuration");
  const base = defaults(enumValue(raw.preset ?? "typescript", ["typescript", "cloudflare-worker", "vite-spa", "nextjs"]));
  const ratchet = object(raw.ratchet) ? raw.ratchet : {};
  const legacyMetrics = {
    loc: { roots: ["src"], slack: 0.02 },
    oxlintWarnings: true,
    abcMax: true,
    comments: { roots: ["src"], max: 0.3 },
  };
  if (raw.exclude === undefined) base.exclude.push("/components/ui/");
  return {
    ...base,
    ...raw,
    check: { ...base.check, ...(object(raw.check) ? raw.check : {}) },
    abc: { ...base.abc, ...(object(raw.abc) ? raw.abc : {}) },
    ratchet: { ...base.ratchet, ...ratchet, metrics: ratchet.metrics ?? legacyMetrics },
  };
}
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot read the requested Git standards revision");
  return result.stdout;
}
function conventional(file: string): boolean {
  return (
    /(?:^|\/)(?:abacus\.config\.json|abacus\.ratchet\.json|package\.json|tsconfig[^/]*\.json|\.?oxlint[^/]*\.(?:json|jsonc)|\.?oxfmt[^/]*\.(?:json|jsonc)|\.?gitleaks\.toml|\.?jscpd\.(?:json|jsonc)|\.?dependency-cruiser\.(?:js|cjs|json)|knip\.(?:json|jsonc|ts|js)|(?:vitest|playwright|vite|next|wrangler)\.config\.[^/]+|wrangler\.(?:toml|json|jsonc)|pnpm-workspace\.yaml|\.gitignore|\.gitlab-ci\.yml|lefthook\.yml)$/u.test(
      file,
    ) || /(?:^|\/)(?:configs\/|\.github\/workflows\/|\.husky\/)/u.test(file)
  );
}
function policyInputs(
  manifest: string,
  names: string[],
  read: (file: string) => string | undefined,
): string[] {
  const bytes = names.includes(manifest) ? read(manifest) : undefined;
  if (!bytes) return [manifest];
  const policy = jsonObject(bytes),
    checks = Array.isArray(policy.checks) ? policy.checks : [];
  const natives = [
    ...(Array.isArray(policy.nativeFiles) ? policy.nativeFiles : []),
    ...checks.flatMap((check) =>
      object(check) && typeof check.nativeConfig === "string" ? [check.nativeConfig] : [],
    ),
  ];
  return [
    manifest,
    ...natives
      .filter((native): native is string => typeof native === "string")
      .map((native) => path.posix.normalize(path.posix.join(path.posix.dirname(manifest), native))),
  ];
}
function configuredInputs(
  file: string,
  content: string,
  names: string[],
  read: (file: string) => string | undefined,
): string[] {
  const raw = jsonObject(content),
    selected: string[] = [];
  const ratchet = object(raw.ratchet) ? raw.ratchet.file : undefined;
  if (typeof ratchet === "string")
    selected.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), ratchet)));
  const pack = object(raw.policy) && object(raw.policy.pack) ? raw.policy.pack.path : undefined;
  if (typeof pack === "string" && !path.isAbsolute(pack))
    selected.push(
      ...policyInputs(
        path.posix.normalize(path.posix.join(path.posix.dirname(file), pack)),
        names,
        read,
      ),
    );
  return selected;
}
function inventory(cwd: string, revision?: string): Map<string, string> {
  const names = git(
    cwd,
    revision
      ? ["ls-tree", "-r", "--name-only", "-z", revision]
      : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  )
    .split("\0")
    .filter(Boolean);
  const read = (file: string) => {
    if (revision) return git(cwd, ["show", `${revision}:${file}`]);
    if (!fs.existsSync(path.join(cwd, file))) return undefined;
    assertProjectPath(cwd, file, "Standards input");
    return fs.readFileSync(path.join(cwd, file), "utf8");
  };
  const selected = new Set(names.filter(conventional));
  for (const file of [...selected].filter((name) => name.endsWith("abacus.config.json"))) {
    const content = read(file);
    if (!content) continue;
    for (const input of configuredInputs(file, content, names, read)) selected.add(input);
  }
  const output = new Map<string, string>();
  for (const name of [...selected].sort()) {
    if (name === ".." || name.startsWith("../") || path.isAbsolute(name))
      throw new Error("Standards input leaves the repository");
    if (!names.includes(name)) continue;
    const value = read(name);
    if (value !== undefined) output.set(name, value);
  }
  return output;
}
function fileChanges(
  file: string,
  before: string | undefined,
  after: string | undefined,
  baseline: boolean,
): StandardsChange[] {
  if (before === after) return [];
  if (file.endsWith("abacus.config.json"))
    return fields(
      file,
      before === undefined ? undefined : effective(JSON.parse(before)),
      after === undefined ? undefined : effective(JSON.parse(after)),
    );
  if (baseline)
    return fields(
      file,
      before === undefined ? undefined : JSON.parse(before),
      after === undefined ? undefined : JSON.parse(after),
      "",
      true,
    );
  if (file.endsWith("package.json")) {
    const old = before === undefined ? {} : JSON.parse(before),
      next = after === undefined ? {} : JSON.parse(after);
    return fields(file, old.scripts ?? {}, next.scripts ?? {}, "/scripts");
  }
  return [
    {
      file,
      field: "/",
      classification: "review",
      reason: "Native policy, runtime, or CI configuration changed; inspect its diff",
      beforeDigest: digest(before ?? "absent"),
      afterDigest: digest(after ?? "absent"),
    },
  ];
}
function baselineFiles(snapshot: Map<string, string>): string[] {
  return [...snapshot].flatMap(([file, bytes]) => {
    if (!file.endsWith("abacus.config.json")) return [];
    const config = jsonObject(bytes);
    const ratchet =
      object(config.ratchet) && typeof config.ratchet.file === "string"
        ? config.ratchet.file
        : "abacus.ratchet.json";
    return [path.posix.normalize(path.posix.join(path.posix.dirname(file), ratchet))];
  });
}
export function reportStandards(base: string, cwd = process.cwd()): StandardsReport {
  if (!base || base.startsWith("-") || base.includes("\0"))
    throw new Error("Standards require an explicit Git base revision");
  if (fs.realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim()) !== fs.realpathSync(cwd))
    throw new Error("Run standards at the Git repository root");
  const commit = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
  const source = sourceProvenance(cwd),
    before = inventory(cwd, commit),
    after = inventory(cwd);
  const baselines = new Set([...baselineFiles(before), ...baselineFiles(after)]);
  const changes = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((file) => fileChanges(file, before.get(file), after.get(file), baselines.has(file)));
  if (source.treeDigest !== sourceProvenance(cwd).treeDigest)
    throw new Error("Standards inputs changed during comparison");
  return {
    schemaVersion: 1,
    base: { commit },
    source,
    changes,
    clean: !changes.some((change) => change.classification !== "tightening"),
    limitations: [
      "Compares conventional native configs, CI files, package scripts, Abacus settings, configured baselines and local policy closures",
      "Native configuration changes require review; arbitrary executable configuration is never evaluated",
      "Ignored untracked files and installed policy package contents are outside this report; policy pins and lockfiles must be reviewed separately",
    ],
  };
}
