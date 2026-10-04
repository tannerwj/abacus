# Architecture and packed-library profiles

These profiles are opt-in policy checks. They reuse native tool rules and return
normalized evidence; they do not infer a project's intended architecture or its
supported consumers. Start with advisory enforcement and promote a check only
after reviewing its scope and findings.

## Architecture

`runArchitecture(cwd, { configPath?, targets? })` runs dependency-cruiser over the
complete configured source roots. `targets` defaults to `["."]`. A repository
`.dependency-cruiser.cjs` is required unless an explicit `configPath` is supplied.
The cycle-only bundled convenience template is never a substitute for an
architecture policy.

A policy check can select an inspectable bundled native config:

```json
{
  "id": "architecture-boundaries",
  "gate": "architecture",
  "required": true,
  "enforcement": "warn",
  "severity": "error",
  "rationale": "Review the existing layer boundaries before making them blocking",
  "nativeConfig": "native/dependency-cruiser.cjs",
  "parameters": { "architecture": { "targets": ["src", "test"] } }
}
```

Native configs can express domain-to-infrastructure restrictions, browser/server
separation, imports through public entrypoints, and production-to-test
restrictions. The real fixtures in `test/fixtures/profiles/architecture-*` cover
all four. Their rules are examples, not defaults appropriate for every project.
Type-only imports and native exclusions remain governed by that config.

Every native violation is reported as `architecture/<native-rule-name>`, with a
stable edge/module subject. This boundary profile treats each non-ignored native
forbidden-rule violation as a failed result while preserving its native
error/warning/info severity; policy enforcement decides whether that result
blocks. A native `ignore` finding is recorded without failing the profile. The evidence records the module/dependency counts,
actual resolved tool version and executable digest, config-file digest, and a
digest of the effective native rules/options/roots. Imported native-rule changes
therefore change the effective digest even when the entry config is unchanged.
The JSON reporter's process exit code is not a clean-scan signal: the native
report itself determines violations.

Missing roots/config, no forbidden rules, zero modules, and unresolved imports
produce `incomplete`. Source roots and followed project modules must remain in
the repository input tree, including after symlink resolution. Native resolution
config file inputs outside that tree are also incomplete; in-tree config inputs
are recorded by digest. Graph cache and known-violation suppression are disabled.
Native parser/transpiler coverage issues and reduced view/revision filters are
also incomplete rather than passing architecture coverage. Malformed output, malformed native findings, configuration
errors, missing tools, timeouts, or unexpected exits produce `error`. Neither is
a passing scan. This gate is never restricted to changed files. Choose the full
source roots and native exclusions deliberately.

## Packed library

`runPackageValidation(cwd, options)` validates a named, versioned built package.
`options.modes` is an explicit, nonempty support contract:

- `node16-esm`: a strict Node16 ESM TypeScript consumer and a real Node import smoke test
- `node16-cjs`: a strict Node16 CommonJS TypeScript consumer and a real Node require smoke test
- `bundler`: a strict TypeScript Bundler-resolution consumer

An ESM-only library may declare just `node16-esm` and/or `bundler`; it is not
required to add CommonJS. A claimed CJS mode is actually checked, including its
declaration/module mapping. Node smoke tests run on the recorded host Node
version; `node16-*` describes TypeScript's module-resolution contract rather than
an emulated Node 16 runtime.

```json
{
  "id": "published-library",
  "gate": "package",
  "required": true,
  "enforcement": "warn",
  "severity": "error",
  "rationale": "Check the artifact that downstream consumers receive",
  "parameters": {
    "package": {
      "modes": ["node16-esm", "bundler"],
      "publintLevel": "warning",
      "attwProfile": "esm-only"
    }
  }
}
```

The adapter packs once with the installed npm CLI through the official
`@publint/pack` API, with lifecycle scripts disabled and npm offline. It runs
publint and Are the Types Wrong against those same tarball bytes, unpacks them
into an isolated consumer, and uses the installed/bundled TypeScript compiler.
Consumer dependencies are links to already-installed declared production, peer,
and optional dependencies. Nothing is automatically installed from the network.
Build the package and install its declared dependencies before running this gate.

Every exact public entrypoint discovered by Are the Types Wrong is imported by
every declared consumer. Node smoke completion is verified after all imports;
an early successful process exit is incomplete coverage. Missing declarations,
missing published build files, invalid declaration/module mappings, failed type
consumers, and failed runtime imports cannot pass. Tool errors and malformed
native evidence remain errors even in an advisory policy.

Options are bounded:

- `publintLevel`: `suggestion`, `warning`, or `error`; default `warning`. Suggestions are informational. This publication profile deliberately treats reported publint warnings and errors as failed results while retaining their native warning/error labels; choose `error` to gate only on native errors. Generic check severity does not promote native advisories, and policy enforcement remains a separate decision
- `attwProfile`: `strict`, `node16`, or `esm-only`; by default `node16` when CJS is declared and `esm-only` otherwise. Declared modes are authoritative: a native profile cannot hide a promised mode's problems
- Repository `.attw.json` is not implicitly loaded. The adapter supplies an empty native config and explicit bounded arguments, preventing local ignore rules or network options from hiding the support contract

Evidence includes packed file count, exact public entrypoint count, type/runtime
consumer counts, packed-artifact digest, effective mode/options digests, and
consumer config/source digests. Tool provenance includes the actual publint API,
pack API, ATTW CLI/core, ATTW's internal TypeScript analyzer, consumer TypeScript,
and npm versions and entrypoint digests. ATTW can use a different TypeScript
version from the real consumer compiler; both are recorded. Native findings are
normalized to tool codes and locations; raw diagnostics, source, and tool output
are not included.

### First-profile boundaries

This first profile covers exact TypeScript/JavaScript library entrypoints. A
wildcard export subpath is `incomplete`: exhaustive wildcard and non-code asset
consumer modeling is not silently claimed. It does not emulate a bundler runtime,
install consumer dependencies, infer supported modes, run a build, execute pack
lifecycle scripts, or validate arbitrary application deployment behavior.
Application-specific checks and further library profiles should be added only
with concrete native configs and positive/negative artifacts.

The real fixtures include valid ESM-only and dual-mode tarballs, incorrect
module/declaration mapping, absent declarations/builds, and a runtime import
missing from the published artifact. Tests also verify malformed tool output,
ignored pack lifecycle scripts, exact additional entrypoints, and early runtime
termination.

Node runtime smoke tests execute the repository's trusted package entrypoints
and already-installed dependencies. Scripts-disabled packing is not a sandbox
for arbitrary or untrusted tarballs; only use this profile on code you intend to
test. No lifecycle scripts or network dependency installation are authorized by
running this check.
