# Trustworthy check evidence

`abacus check` uses the same deterministic adapters locally and in CI. Add
`--json` for machine-readable evidence, or `--evidence /tmp/abacus-run.json`
for a new file (existing files are never overwritten). Keep output outside the
input tree when comparing reproducible digests. `--at 2026-10-04T07:00:00Z`
fixes the evaluation instant for dated debt and exceptions.

The CLI drains stdout and stderr before exiting, including large JSON reports
captured through pipes. Finding failures retain exit status 1; execution/configuration
errors retain status 2.

The version-1 contract records:

- `pass`, `fail`, `waived`, `not-applicable`, `incomplete`, or `error`
- Required applicability and independent `block` / `warn` / `observe` enforcement
- Active and waived finding counts, declared scope, actual scanned count and unit
- Source commit when Git exists, dirty state and source/build-input content digest
- Policy pin/digest, effective Abacus configuration digest and native input hashes
- Actual resolved analyzer versions/binary hashes and runtime identity

A required missing tool, invalid report, empty intended scan, changed input tree,
unsupported profile, or unavailable applicability is a blocker even in advisory
mode. Advisory *violations* remain observable without blocking. A waiver never
turns a failed tool or incomplete scan into success. If a tool fails, evidence
uses a safe diagnostic rather than copying arbitrary stderr or source snippets;
run the named individual gate to diagnose configuration problems.

Native reports provide scope counts: Oxlint files, Knip processed files,
dependency-cruiser modules, jscpd source files, TypeScript project files,
gitleaks bytes, and built assets. Units differ deliberately; do not sum them.
Gitleaks measurements come from its pinned version's scan log; a missing count
is incomplete. ABC includes files with no functions as legitimate scanned files.
TypeScript strictness flags and undated TODOs remain advisory.

Secret scans use the selected repository as their working directory and native
source `.`. Finding paths are repository-relative, so exact root-anchored path
allowlists can exempt a documented fixture without suppressing nested copies.
Keep fixture path and exact value conditions joined with `AND`.

## What these hashes do and do not prove

The tree digest includes source, tests, repository configuration and existing
built inputs; excludes `.git` and `node_modules`; hashes in-tree file symlink targets and rejects out-of-tree or directory symlinks. Policy digests cover the declared native-config closure.
The lockfile and package metadata participate in the tree digest; resolved
analyzer versions/binary hashes are also recorded. This is a reviewable evidence
manifest, not a hermetic sandbox or signed software-supply-chain attestation.
Transitive analyzer code can still differ if an installation is tampered with.
Native configuration is executable in ordinary repository-local tool workflows;
pinned packs conservatively support data-only native configurations.

Fingerprint algorithm 1 uses rule ID and logical subject. ABC subjects identify
file, function and duplicate ordinal; lint subjects use file, rule and occurrence
ordinal. Graph checks use source/target edges. Some adapters use line locations
where no stable logical identity exists. These fingerprints are useful for
same-tree policy comparisons; they are not a claim of perfect identity across
arbitrary code edits. There is no automatic finding-baseline expansion or
baseline suppression in this MVP.

Metric ratchets remain separate numeric ceilings. Only an explicit
`abacus ratchet --write` or `--update` changes their committed snapshot. Neither
ordinary checking nor policy preview edits pins, native configs, exceptions,
budgets, sources or baselines.

Trustworthy aggregate evaluation requires source roots, build directories and ratchet snapshots to stay inside the evaluated project tree. Shared installed policy artifacts are separately pinned and checked for changes during evaluation. Out-of-tree project inputs are unsupported rather than silently omitted from the source digest.

Worker size checks resolve the installed Wrangler JavaScript CLI and record its
version/digest. Extra arguments are limited to explicit --env, --name and
--config selectors, with config paths inside the project. Dry-run and temporary
output flags are immutable; flags capable of turning a measurement into a
publication are rejected before invoking Wrangler.

Compiler checks retain separate selected-project coverage, safe TS code/location diagnostics, and source/config/installed-declaration byte closures. Out-of-tree non-installed sources or extends inputs are incomplete. Incremental build info is directed to an isolated temporary location. A required zero-target result stays incomplete even when native diagnostics exist or an exact waiver matches. Missing/invalid ratchet baselines and unresolved dependency imports use fixed safe cause codes; arbitrary tool output is never echoed.
