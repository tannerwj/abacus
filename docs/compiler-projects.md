# Explicit TypeScript compiler projects

Abacus defaults to checking `tsconfig.json`. A solution-style root config containing `files: []` and references does not prove that the referenced source projects were checked: Abacus never runs `tsc --build` implicitly. Select the actual compiler projects in `abacus.config.json`:

```json
{
  "check": { "gates": ["tsc"] },
  "tsc": {
    "projects": ["tsconfig.worker.json", "tsconfig.app.json", "tsconfig.e2e.json"]
  }
}
```

This matches a native workflow that runs each of those projects separately. Keep Worker, browser/DOM, and end-to-end compiler options in their own configurations. Do not merge their globals or add source includes to an empty solution root to simulate coverage.

## Bounded selection

`tsc.projects` is a nonempty, unique list of repository-relative JSON config paths. Paths are normalized before comparing uniqueness; `tsconfig.json` and `./tsconfig.json` are duplicate selectors. Absolute paths, URLs, traversal, backslash paths, executable arguments, and other fields under `tsc` are rejected. Nested configs such as `configs/tsconfig.worker.json` are supported.

A policy check can select projects with `parameters.tsc.projects`. Repository selection remains the default unless the policy explicitly replaces it. Normal checks never rewrite the selection, compiler configs, source files, or a ratchet baseline.

Every selected project runs independently, including those after a failing or unavailable project. Missing configs, invalid or external config/source closures, and projects with zero source targets produce incomplete evidence. Compiler execution errors stay errors. None can become a complete pass because another project succeeds. Required incomplete/error evidence still blocks under warning or observe enforcement. Finding severity and enforcement remain separate policy decisions.

## Evidence and fingerprints

Each compiler check records its selected project, outcome, source count, safe TS diagnostic codes/locations, and config/source byte fingerprints. The aggregate count is **project-files**: a shared file checked under two platform configurations is counted twice, once in each project. `metrics.uniqueFiles` reports the deduplicated local source count; it does not replace per-project coverage.

Each complete project's `inputDigest` binds its selector to its sorted source/config/dependency byte closure. Installed dependency identifiers start with `installed:node_modules/` and omit the machine's absolute workspace prefix. Loaded declarations' ancestor package manifests are included because `types`, `exports`, and package module mode affect resolution even when declaration bytes stay unchanged. The check records metadata for the actual resolved compiler CLI and separately for the bundled TypeScript API used to read configs. A project-local compiler can differ from Abacus's config reader; evidence names them separately rather than claiming they are the same installation.

Policy preview requires the complete input set, its bytes, and `inputDigest` to match for each compiler project selected by both policies. Comparing only intersecting files would misattribute a changed installed type entrypoint to policy rules. Explicitly added or removed project selectors remain allowed; unavailable/incomplete projects remain visible rather than being represented as complete closures.

Emitted findings contain only a TS code and safe source location. Raw compiler diagnostics, source snippets, and arbitrary stderr are never copied into normalized evidence. A non-default or multi-project selection includes the project in finding subjects so the same file checked in different environments has distinct finding fingerprints. The default single `tsconfig.json` selection preserves the prior subject fingerprints where practical.

## Read-only compiler execution

Projects run with `--project`, `--noEmit`, and no reference-build flag. Abacus does not build referenced projects to make the check pass. If a repository requires generated declarations, create them through its explicitly approved native workflow before checking, or accept the resulting diagnostics.

Repository-local referenced project configs and their inherited configs are inspected recursively and fingerprinted. Reference paths, inherited config inputs, and referenced source roots must stay inside the repository. Escaping references and unsupported cyclic config closures produce incomplete evidence before invoking the compiler.

Incremental/composite checks direct build-info output into a temporary directory and remove it after the check. Configured source-tree build-info files and existing caches are not rewritten. Installed compiler libraries and declarations are provenance inputs, not project-source coverage.

## Validation cases

Regression tests cover separate platform projects, a later compiler failure after an earlier project passes, shared sources counted under each project, an empty solution root, absent/empty projects, external config/extends/source inputs and symlink escapes, sanitized diagnostics, source/config byte changes, and source-tree cache stability.
