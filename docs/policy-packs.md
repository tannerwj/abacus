# Pinned policy packs and safe upgrades

A policy pack is a versioned JSON manifest that selects Abacus adapters and their bounded options. Native tools still own lint rules, compiler options, dependency boundaries, and package-resolution checks. Abacus records what ran, what was scanned, and how the result is enforced. Packs are not a general-purpose rules language.

Start with advisory checks, inspect coverage and debt, then deliberately promote specific checks to `block`. The example pack under `configs/policy-packs/advisory/` uses `warn` and `observe`; it does not create a ratchet baseline or introduce a comment quota. Existing comment-ratio ceilings, if enabled in repository configuration, remain ceilings rather than incentives to add comments.

## Manifest

```json
{
  "schemaVersion": 1,
  "name": "@my-team/typescript-policy",
  "version": "1.0.0",
  "compatibility": {
    "adapterVersion": 1,
    "evidenceSchemaVersion": 1,
    "abacus": ">=0.2.0 <1.0.0",
    "tools": { "oxlint": ">=1.80.0 <2.0.0" }
  },
  "checks": [
    {
      "id": "complexity",
      "gate": "abc",
      "required": true,
      "enforcement": "warn",
      "severity": "warning",
      "rationale": "Measure complex functions before setting a blocking budget",
      "parameters": { "abc": { "budget": 60 } }
    },
    {
      "id": "source-lint",
      "gate": "lint",
      "required": true,
      "enforcement": "warn",
      "severity": "warning",
      "rationale": "Review source correctness findings",
      "nativeConfig": "native/oxlint.json"
    }
  ],
  "nativeFiles": ["native/base.json"]
}
```

- Every check has a unique, stable `id`, a supported `gate`, `required`, `enforcement`, `severity`, and a nonempty `rationale`
- Gates: `lint`, `abc`, `ratchet`, `tsc`, `deadcode`, `secrets`, `cycles`, `dupes`, `todos`, `size`, `architecture`, `package`
- Outcomes and enforcement are separate. A failed check blocks when its enforcement is `block`. A required check with `error`, `incomplete`, or `not-applicable` blocks even in advisory mode: unavailable tooling or zero coverage is not a clean scan
- Keep native tool severities meaningful. A tool's advisory warning is not automatically promoted to an error by a generic policy severity
- Parameters accept the known `preset`, `roots`, `exclude`, `abc`, `size`, and `ratchet` configuration fields, plus `architecture.targets` and `package.{modes,publintLevel,attwProfile}`. Unsupported fields and expressions fail validation
- Worker `wranglerArgs` supports only paired `--env VALUE`, `--name VALUE`, and `--config VALUE` selectors. Deployment, dry-run, output-directory, separator, and arbitrary flag overrides are rejected; the runtime supplies immutable dry-run/output flags
- Ratchet LOC metrics accept only `roots` and `slack`; comment-ratio metrics accept only `roots` and `max`. `loc.max` and `comments.slack` are rejected because the runtime does not implement them. `ratchet.file` names the deliberately maintained snapshot; previews never create or change it
- Parameter objects merge with repository configuration; arrays replace. Baselines, existing ABC allowances, exclusions, and targets remain repository-owned inputs and appear in source/config evidence. Pack parameters never write or refresh a baseline
- Package modes are explicitly declared using a nonempty list of `node16-esm`, `node16-cjs`, and/or `bundler`. Do not claim CJS support unless it is intentionally supported. Missing declared support is incomplete

Compatibility uses exact semantic versions or whitespace-conjoined `>=`, `>`, `<=`, `<`, and `=` comparisons. Examples: `1.82.0`, `>=1.80.0 <2.0.0`. Floating tags, caret/tilde ranges, wildcards, alternatives, and abbreviated versions are unsupported. Tool names must match evidence names, such as `oxlint`, `typescript`, `knip`, `dependency-cruiser`, `jscpd`, or `gitleaks-wrapper`. This constrains compatible tool versions; it does not install them or replace the repository lockfile.

## Exact local and npm pins

Every reference requires an exact pack version and a lowercase SHA-256 digest. A missing digest, mismatched version, modified native file, unsupported schema, or incompatible runtime fails visibly. Resolution never installs a package, imports pack code, fetches a URL, or follows a floating network reference.

Generate the digest after reviewing the manifest and bundled native configuration:

```sh
abacus policy-digest --path configs/policy-packs/advisory/policy.json
```

The bundled advisory fixture's pin is:

```json
{
  "path": "configs/policy-packs/advisory/policy.json",
  "version": "1.0.0",
  "digest": "937c67bf9678706fa2aeb1f17f5e4e3b36a5989d9b53bb92dd92a000676d0ab3"
}
```

Repository `abacus.config.json` can include:

```json
{
  "policy": {
    "pack": {
      "path": "configs/policy-packs/advisory/policy.json",
      "version": "1.0.0",
      "digest": "937c67bf9678706fa2aeb1f17f5e4e3b36a5989d9b53bb92dd92a000676d0ab3"
    },
    "exceptions": []
  }
}
```

An installed npm package must expose its manifest through a direct, exact JSON export:

```json
{
  "package": "@my-team/policy-pack",
  "export": "./typescript-policy",
  "version": "1.0.0",
  "digest": "<the reviewed 64-character lowercase SHA-256 digest>"
}
```

For example, that package's `package.json` contains `"exports": { "./typescript-policy": "./policy.json" }`. The installed package's name and version must match the pin, and the exported manifest's version must match too. Conditional and wildcard exports are unsupported. Install the exact package version separately and commit its lockfile; Abacus only resolves the existing local installation. Native files are bundled relative to the exported manifest directory.

## Native configuration closure

The digest covers canonical manifest JSON and the byte-level SHA-256 of every `check.nativeConfig` and every companion listed in `nativeFiles`. JSON whitespace and object key order in the manifest do not change its digest; any native-config byte does. Resolved absolute native paths and their hashes are included in evidence. Resolution also records the exact manifest file path and raw-byte digest for integrity checks, even though canonical manifest formatting is not part of the pack identity. The runner verifies the manifest and all resolved native bytes before and after evaluation; a changed or missing policy input produces a required `policy-stability` blocker.

The current `nativeConfig` override gates are `lint`, `deadcode`, `architecture`, `cycles`, `secrets`, and `dupes`; other gates reject the override rather than silently ignoring it.

Every native path must be a bundled relative file without `..`, an absolute path, a URL, or a symlink. Native symlinks, including intermediate path components, are unsupported so a pinned file cannot silently retarget. A JSON/JSONC or static JavaScript/CJS `extends`, external `$ref`, or `tsConfig.fileName`/`webpackConfig.fileName` must use `./` and target a declared bundled file. Missing and undeclared companions fail resolution. Repository source globs are not policy dependencies; the evaluated source tree is fingerprinted separately.

Supported bundled formats are JSON, JSONC, self-contained TOML, and static `module.exports = { ... }` JavaScript/CJS data literals. JavaScript imports, `require`, computed values, spreads, callbacks, and arbitrary executable configuration are unsupported in pinned packs. TOML is parsed structurally: external `extend.path` is unsupported in dotted, quoted, table, and inline-table spellings; tool-versioned `extend.useDefault` and `extend.disabledRules` can be used. Nonempty native `jsPlugins` is unsupported, including local paths, npm names, and object forms. This is an explicit declared closure, not an attempt to infer every dependency of arbitrary JavaScript or a sandbox for native tools. Repository-native configurations outside a pack retain the native tool's normal trust model.

## Repository-owned exceptions

Exceptions are additive overlays for exact logical findings. They do not edit the organization pack, relax thresholds, exclude entire files, or create baselines.

```json
{
  "id": "legacy-complexity",
  "ruleId": "abc/budget",
  "subject": "src/legacy.ts legacyFunction #1",
  "owner": "platform-team",
  "reason": "Decompose this function after the tracked migration",
  "expires": "2026-12-31"
}
```

Copy `ruleId` and `subject` exactly from evidence. Both must match; wildcard matching is unsupported. IDs and exact rule/subject targets cannot be duplicated. Ownership, reason, and a real `YYYY-MM-DD` expiration date are mandatory. Expiration is evaluated against the shared run's UTC date, with the waiver valid through the stated date. An expired exception produces a visible `policy/expired-exception` finding even if its original finding has disappeared, so stale debt records must be reviewed and removed deliberately.

An active exception marks its finding with `exceptionId`. A failed check becomes `waived` only when all its findings are waived. Exceptions cannot waive tool errors, incomplete coverage, missing baselines, or a required not-applicable result. Findings retain their original stable fingerprint, allowing previews to distinguish a resolved finding from an unchanged waived finding.

## Preview upgrades before changing pins

Create two JSON pin-reference files, then evaluate them against the same source tree:

```sh
abacus preview --from old-pin.json --to candidate-pin.json
```

Preview runs both versions with a shared evaluation timestamp and verifies matching commit plus tree digest. It reports:

- Added, removed, or changed checks and their rationale/severity/coverage requirements
- Native config declarations and recorded digest changes
- Bounded parameter/threshold and enforcement changes
- Added and resolved logical finding fingerprints
- Newly blocking checks, including required tooling/coverage failures and newly unwaived findings
- Exceptions affected by changed checks, new/resolved matching findings, or expiration

A changed threshold message alone does not create a new finding: fingerprints exclude threshold values. Subjects can include line locations when an adapter has no stable logical identity; see the evidence contract for limitations. Reusing a check ID across versions preserves continuity; intentionally changing an ID appears as removed/added evidence.

Preview does not modify source, update a pin, edit exceptions, rewrite a lockfile, or create/refresh a ratchet baseline. Native tools may still create their normal temporary reports/cache artifacts. Review the preview and deliberately commit the new pin and any separately approved debt decisions. Keep source, runtime/tool versions, built assets, and other evaluation inputs stable when attributing a change to a policy upgrade.

The pure library function is `comparePolicyRuns(before, after, { beforePack, afterPack, exceptions })`. It consumes already evaluated evidence and performs no filesystem or tool operations. Supplying both manifests enables parameter and declared-native-path comparisons. It refuses different source commits, tree digests, evaluation times, runtime metadata, repository configuration digests, shared tool versions/digests, unsupported fingerprint/schema versions, duplicate check IDs, and manifest/evidence mismatches. Newly selected tools are permitted, but every tool name recorded on both sides must have identical version and digest; inconsistent tool metadata within one run also fails.

Pinned Oxlint JSON/JSONC packs in this profile use global rules. The adapter explicitly reapplies declared bundled ignorePatterns as consumer-root CLI excludes, together with installed-dependency and VCS exclusions. Directory-relative overrides/files/excludeFiles are unsupported and fail visibly rather than silently missing consumer source. Repository-local Oxlint configuration retains its native semantics. The actual installed type-aware platform executable is bound explicitly and recorded by version/digest.
