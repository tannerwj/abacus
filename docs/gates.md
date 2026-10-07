# Gate and configuration guide

[Documentation](README.md) · [Getting started](getting-started.md)

## Selecting gates

`abacus check` reads `check.gates` from `abacus.config.json`. Its backward-compatible
default is `lint`, `abc`, and `ratchet`. The six new source gates are opt-in;
the command prints which gates are excluded. To select them permanently:

```json
"check": { "gates": ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos"] }
```

`abacus init --all` selects every source gate when writing a new config.
`abacus check --all` runs them for one invocation, even with an existing config.
Every selected gate runs even if an earlier one fails. Under default blocking
enforcement, a failure or tool error makes the aggregate command exit 1.
Optional [policy enforcement](policy-packs.md) can make findings advisory;
required errors or incomplete coverage still block. `tsc` diagnostics fail; select actual compiler projects to establish coverage. Unknown or empty gate lists are configuration errors.

Size needs built assets and is excluded from `--all`. Run `abacus size` after
building, or use `abacus check --all --with-size`. You can also explicitly include
`"size"` in `check.gates` if your check always runs after a build. For example:

```jsonc
// package.json
"check":  "pnpm fmt --check && pnpm test && abacus check --all",
"deploy": "pnpm check && pnpm build && pnpm size && wrangler deploy"
```

## Raising a budget

Prefer splitting the function. When you genuinely can't yet, record the debt:

```json
"abc": { "budget": 60, "allow": { "src/sync/persist.ts persistDataset": { "max": 130, "why": "untested sync path; split once a harness exists" } } }
```

`abacus abc` warns when an allow entry no longer matches anything, so the list
shrinks as you pay it down.

## ABC metric

Fitzpatrick's ABC: **A**ssignments (`=`, `+=`, `++`, `const x = …`),
**B**ranches (calls and `new`), **C**onditions (`if`, `?:`, `case`, loops,
`catch`, comparisons, `&&`/`||`/`??`, `?.`, early returns).
Score = √(A² + B² + C²). Nested functions are scored on their own.
Cyclomatic complexity focuses on independent control-flow paths; ABC catches functions that are big
without being branchy.
Class and object getters/setters are scored too. Their names are prefixed with
`get ` or `set `, so `src/model.ts get value` and `src/model.ts set value` can
have separate reviewed allowlist entries.

## Size budgets

Each configured asset budget must match at least one file. A missing directory
or zero matches fails rather than reporting a misleading zero-byte success.
For a genuinely optional asset type in an existing directory, set `allowEmpty`
on that budget only:

```json
{ "label": "Optional CSS", "dir": "dist/assets", "match": "\\.css$", "max": 20480, "allowEmpty": true }
```

The default is `allowEmpty: false`; populated budgets still enforce the gzip
sum or largest-file limit.

## Ratchet

Fixed budgets get written up to. The ratchet makes the current value the ceiling:

New configs enable lint-count and maximum-complexity ratchets. LOC and comment
ceilings are explicit opt-ins; existing configs that inherited the older defaults
retain them. Review growth in context rather than shortening or compressing code
to satisfy a metric. ABC evidence also reports total complexity and over-budget
function counts. The following example deliberately enables growth metrics:

```json
"ratchet": { "file": "abacus.ratchet.json", "metrics": {
  "loc": { "roots": ["src"], "slack": 0.02 }, "oxlintWarnings": true, "abcMax": true,
  "comments": { "roots": ["src"], "max": 0.3 } } }
```

`abacus ratchet` fails when the baseline is missing, empty, malformed, has invalid
values, or omits any enabled metric. A normal check never creates, repairs, or
changes it. Enabling a new metric/root requires a deliberate baseline update.
No enabled metrics is also a configuration failure.

It fails when a metric exceeds snapshot × (1 + slack) or the fixed
`max`; it prints "ratchet down available" when one decreased so you can
`--write` the tighter snapshot. LOC = code lines (blank and comment-only lines
skipped, TS/TSX/JS via the TypeScript scanner); comments = comment lines / code
lines; `oxlintWarnings` counts warnings + errors from `oxlint --format json .`.
Only `abacus ratchet --write` (or the explicit alias `--update`) creates/replaces
the snapshot. Commit and review that diff, especially if a ceiling increases;
fixed maximums are still enforced during explicit writes.

## Formatting

`abacus fmt` / `abacus fmt --check` wrap [oxfmt](https://oxc.rs/docs/guide/usage/formatter)
with the template in `configs/oxfmt.jsonc` (100 cols, double quotes, semicolons,
trailing commas). Edit `.oxfmtrc.jsonc` in your repo; oxfmt reads it automatically.

## Dead code

`abacus deadcode` wraps [knip](https://knip.dev) (bundled, zero extra installs):
unused exports, files, types, and dependencies. It exits 1 when anything is
found. `abacus init` writes a `knip.json` with entry points auto-detected from
package.json, wrangler config, and common test/script/config patterns; edit it
in your repo for project-specific entries (e.g. string-based lazy imports like
`lazyView("./js/views/x.js", ...)`, which knip cannot trace).

## Secrets

`abacus secrets` wraps [gitleaks](https://github.com/gitleaks/gitleaks) (bundled
via `@b12k/gitleaks`: downloads the official release, verifies sha256): scans
the working tree for leaked credentials, exits 1 on findings. Secret values are
never printed — findings report file, line, and rule only. `abacus init` writes
a `.gitleaks.toml` extending the default rules; add known false positives there.

## TypeScript

`abacus tsc` runs a no-emit check for each configured TypeScript project, using
the project's own compiler when installed or the bundled compiler otherwise.
It reports safe diagnostic codes/locations and project coverage. Select actual
projects with `tsc.projects`; an empty solution root is not proof that referenced
source projects were checked. See [compiler projects](compiler-projects.md).
Adopting stricter flags is the repository's decision, recorded in its tsconfig.json.

## Circular dependencies

`abacus cycles` runs [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
(bundled) with the `no-circular` rule over `src/`, or the project directory if
there is no `src/`. Native error-level violations make the command fail. Cycles are a code smell — they make module evaluation order
fragile and signal that shared code wants its own module. `abacus init` writes
a `.dependency-cruiser.cjs`; exempt intentional cycles there rather than
ignoring the gate.
Unresolved imports are reported separately as incomplete coverage. Standalone
checks exit 1; required aggregate coverage blocks even under advisory enforcement.
Native cycle findings remain visible, and an exact waiver cannot waive missing
coverage. Resolve aliases and runtime-specific imports before relying on the graph.

Known upstream limitation: dependency-cruiser 18 can fail config loading with
`URI malformed` when a project path contains a literal `%`. Space-containing
paths are covered by the real packed-consumer integration; `%` paths remain
unsupported by that dependency.

## Duplication

`abacus dupes` runs [jscpd](https://github.com/kucherenko/jscpd) (bundled)
over `src/` and exits 1 when copy-paste duplication exceeds 5% of the codebase
(min 5 lines / 50 tokens per clone). The standalone report lists up to 20 clone pairs with
file and line ranges, so the fix — extracting the shared logic — is obvious.
`abacus init` writes a `.jscpd.json`; adjust `threshold` or `ignore` patterns
there. Test files and fixtures are ignored by default.

## Todos

`abacus todos` scans source lines for TODO/FIXME/HACK/XXX markers with dates
(`TODO(2026-12-01)`, `FIXME: 2026-12-01`, …) and exits 1 when any date is in
the past. A deadline that passes silently is a lie — resolve it or move the
date. Undated TODOs are reported but never fail.

## Design choices

No dashboards, no history, no CI plugins. It exits non-zero and prints the
offenders. Wire it into whatever runs your checks.

Not a copy of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) either.
Its assertion rules are covered natively (`consistent-type-assertions`,
`no-unnecessary-type-assertion`, `no-non-null-assertion`), `no-module-mocking` by
`vitest/no-restricted-vi-methods`, and bloat by the ABC and ratchet gates. What
abacus skips on purpose: `no-unknown-parameters` / `no-unknown-returns` /
`no-unknown-type-aliases` (fight Hono and Zod boundary code), `no-object-parameters`,
`no-array-filter-map`, `require-safety-comment-for-type-assertion`,
`require-readable-spacing`, and the Effect rules. They need an alpha JS plugin
vendored into every consumer and pinned to an exact oxlint version; the value did
not cover that cost.

## Project-specific configuration

- Type-aware lint needs tsconfig `paths` to be relative (`"./src/*"`) and no
  `baseUrl` (tsgolint limitation)
- Put generated or vendored code in `exclude` and native `ignorePatterns`
- Match each native tool’s entry points, source roots, and exclusions to your
  project; an exception is not a substitute for checking the intended files
