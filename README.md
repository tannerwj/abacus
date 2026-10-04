# abacus

Plug-and-play quality gates for TypeScript projects. One dev dependency, one
config file, a handful of commands. Budgets live in your repo so every exemption
has an owner and a reason.

| Gate | What it catches | Tool |
| --- | --- | --- |
| Cyclomatic complexity ≤ 20, depth ≤ 4, params ≤ 6 | branchy functions nobody can hold in their head | oxlint (`complexity`, `max-depth`, `max-params`) |
| ABC score ≤ 60 per function | the *other* kind of bloat: 150 calls and no branches (registration blobs, god-functions) | `abacus abc` (TypeScript AST) |
| ≤ 400 lines/file, ≤ 120 lines/function (warn) | files that became modules by accident | oxlint (`max-lines*`) |
| Floating / misused promises | the classic silent Worker bug | oxlint type-aware (`tsgolint`) |
| gzip bundle budgets | the SPA quietly doubling, the Worker creeping toward the 1 MB limit | `abacus size` (+ `wrangler deploy --dry-run`) |
| Ratchet: LOC, comment ratio, max ABC, oxlint count | growth beyond a committed, reviewed baseline | `abacus ratchet` |
| Unused exports, files, types, dependencies | abandoned code and missing entry-point configuration | `abacus deadcode` (knip) |
| Leaked credentials | secrets accidentally committed to the working tree | `abacus secrets` (gitleaks) |
| TypeScript errors + strictness advice | compiler errors; optional flags are advisory | `abacus tsc` |
| Circular imports | fragile module evaluation order | `abacus cycles` (dependency-cruiser) |
| Copy-paste duplication | clones exceeding the configured percentage | `abacus dupes` (jscpd) |
| Expired dated comments | overdue TODO/FIXME/HACK/XXX deadlines | `abacus todos` |
| `as` only, no `{} as T`, `!` warns, redundant `as` warns | type assertions that paper over a wrong type instead of fixing it | oxlint (`typescript/consistent-type-assertions`, `no-non-null-assertion`, `no-unnecessary-type-assertion`) |
| `vi.mock` warns in tests | module mocking hiding the seam a real dependency injection would expose | oxlint (`vitest/no-restricted-vi-methods`) |
| Formatting | bikeshedding | `abacus fmt` (oxfmt, prettier-compatible defaults) |

## Install

Requires Node 22+. The bundled gitleaks wrapper declares Node 24 but uses only
standard APIs, and dependency-cruiser 18 supports Node 22/24/26+.
Development uses pnpm 11.19.0.
For pnpm's build-script approval, add this to the consuming repository's
`pnpm-workspace.yaml` before installing:

```yaml
allowBuilds:
  "@tjohnson/abacus": false # dist is already built
  "@b12k/gitleaks": true   # downloads the official binary and verifies SHA-256
```

```bash
pnpm add -D git+ssh://git@github.com/tannerwj/abacus.git oxlint oxlint-tsgolint oxfmt
pnpm abacus init --preset cloudflare-worker   # or: typescript | vite-spa | nextjs
pnpm abacus ratchet --write                   # snapshot today's numbers; commit abacus.ratchet.json
```

`init` writes `abacus.config.json`, `.oxlintrc.json` (extending the preset) and
`.oxfmtrc.jsonc`, plus knip, gitleaks, dependency-cruiser, and jscpd configs. It
adds `check`, `lint`, `fmt`, `abc`, `size`, `ratchet`, `tsc`, `deadcode`, `secrets`,
`cycles`, `dupes`, and `todos` scripts. Existing files and scripts are preserved.
If gitleaks was installed with scripts disabled, authorize its build script
above, then run `pnpm rebuild @b12k/gitleaks`.

## Aggregate checks

`abacus check` reads `check.gates` from `abacus.config.json`. Its backward-compatible
default is `lint`, `abc`, and `ratchet`. The six new source gates are opt-in;
the command prints which gates are excluded. To select them permanently:

```json
"check": { "gates": ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos"] }
```

`abacus init --all` selects every source gate when writing a new config.
`abacus check --all` runs them for one invocation, even with an existing config.
Every selected gate runs even if an earlier one fails, and any failure or tool
error makes the aggregate command exit 1. `tsc` errors fail; strictness advice
does not. Unknown or empty gate lists are configuration errors.

Size needs built assets and is excluded from `--all`. Run `abacus size` after
building, or use `abacus check --all --with-size`. You can also explicitly include
`"size"` in `check.gates` if your check always runs after a build. For example:

```jsonc
// package.json
"check":  "pnpm fmt --check && pnpm test && abacus check --all",
"deploy": "pnpm check && pnpm build && pnpm size && wrangler deploy"
```

## Presets

- **typescript** — base rules + complexity/ABC budgets. No size gates.
- **cloudflare-worker** — base + `no-restricted-globals` for `process`/`__dirname`,
  Worker bundle gzip budget (400 KB), SPA asset budgets if you serve one.
- **vite-spa** — base + react/jsx-a11y, per-chunk and CSS gzip budgets.
- **nextjs** — base + react/jsx-a11y/nextjs (the native port of `@next/eslint-plugin-next`,
  so `eslint-config-next` is not needed), ignores `.next/`, `.open-next/`, `next-env.d.ts`.
  Replace `"lint": "next lint"` (removed in Next 16) with `oxlint --type-aware .`.

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
Cyclomatic complexity counts only C; ABC catches functions that are big
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

`abacus tsc` runs `tsc --noEmit` (the project's own tsc when installed, else the
TypeScript bundled with abacus) and exits 1 on any type error. It also prints a
strictness audit — the high-value flags beyond `strict` (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, …) — as advisory only.
Adopting a flag is the repo's decision, recorded in its tsconfig.json.

## Circular dependencies

`abacus cycles` runs [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
(bundled) with the `no-circular` rule over `src/` and exits 1 when any import
cycle is found. Cycles are a code smell — they make module evaluation order
fragile and signal that shared code wants its own module. `abacus init` writes
a `.dependency-cruiser.cjs`; exempt intentional cycles there rather than
ignoring the gate.
Known upstream limitation: dependency-cruiser 18 can fail config loading with
`URI malformed` when a project path contains a literal `%`. Space-containing
paths are covered by the real packed-consumer integration; `%` paths remain
unsupported by that dependency.

## Duplication

`abacus dupes` runs [jscpd](https://github.com/kucherenko/jscpd) (bundled)
over `src/` and exits 1 when copy-paste duplication exceeds 5% of the codebase
(min 5 lines / 50 tokens per clone). The report lists every clone pair with
file and line ranges, so the fix — extracting the shared logic — is obvious.
`abacus init` writes a `.jscpd.json`; adjust `threshold` or `ignore` patterns
there. Test files and fixtures are ignored by default.

## Todos

`abacus todos` scans source files for TODO/FIXME/HACK/XXX comments with dates
(`TODO(2026-12-01)`, `FIXME: 2026-12-01`, …) and exits 1 when any date is in
the past. A deadline that passes silently is a lie — resolve it or move the
date. Undated TODOs are reported but never fail.

## What it deliberately is not

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

## Notes

- This repository opts into all source gates in its own config. Run `pnpm check`
  (or `pnpm check:all`) for build, typecheck, tests, and the aggregate gates.
  Type-aware lint may print advisory warnings; it fails on errors.
- `pnpm test:install` makes a clean checkout and empty dependency store, runs
  `pnpm install --frozen-lockfile` and the full check, then packs Abacus and runs
  all ten gates in a newly initialized consumer whose path contains spaces.
- The repo's knip config excludes generated `dist` and deliberate bad fixtures.
  dependency-cruiser/jscpd are loaded by their CLI manifests; lint/formatter peers
  are consumer tooling, and wrangler is an optional downstream binary. The
  gitleaks allowlist is limited to the documented fake Stripe key in its exact
  regression-test file; other paths and values remain scanned.

- Type-aware lint needs tsconfig `paths` to be relative (`"./src/*"`) and no
  `baseUrl` (tsgolint limitation).
- Generated or vendored code (e.g. shadcn `components/ui`) goes in
  `exclude` and `ignorePatterns`, not in the allow list.

## Versioned standards and upgrade previews

Checks now emit a normalized evidence contract with actual scan scope, distinct
outcomes, visible waivers, and source/configuration/tool provenance. A required
empty scan or tool failure cannot turn green. Use `abacus check --json` or
`abacus check --evidence /tmp/abacus-run.json`; the same command runs locally and
in CI. See [the evidence contract](docs/evidence.md).

An optional repository-owned `policy.pack` pins an installed npm or local policy
artifact by exact version and content digest. Packs keep native configs readable,
use bounded known parameters, and declare compatible analyzer versions. Exceptions
require an exact rule/subject, owner, reason, and expiry. See
[policy packs](docs/policy-packs.md).

`abacus preview --from old-pin.json --to candidate-pin.json --json` evaluates both
packs on the same unchanged source/build tree and at the same time. It separates
rule/config/threshold/enforcement changes, added/resolved findings, new blockers,
and affected exceptions. It does not adopt the candidate.

Explicit profiles add full-graph architecture boundaries through dependency-cruiser,
and package validation with publint, Are The Types Wrong, and packed TypeScript
consumers in the modes a library actually promises. See
[architecture and package profiles](docs/profiles.md). These profiles are opt-in;
`--all` retains its source-gate meaning and never silently promises package or
architecture applicability.
