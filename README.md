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
| Ratchet: LOC, comment ratio, max ABC, oxlint count | the slow creep no per-function budget sees; every green run is the new ceiling | `abacus ratchet` |
| `as` only, no `{} as T`, `!` warns, redundant `as` warns | type assertions that paper over a wrong type instead of fixing it | oxlint (`typescript/consistent-type-assertions`, `no-non-null-assertion`, `no-unnecessary-type-assertion`) |
| `vi.mock` warns in tests | module mocking hiding the seam a real dependency injection would expose | oxlint (`vitest/no-restricted-vi-methods`) |
| Formatting | bikeshedding | `abacus fmt` (oxfmt, prettier-compatible defaults) |

## Install

```bash
pnpm add -D git+ssh://git@git.taxhawk.com/tjohnson/abacus.git oxlint oxlint-tsgolint oxfmt
pnpm abacus init --preset cloudflare-worker   # or: typescript | vite-spa | nextjs
pnpm abacus ratchet --write                   # snapshot today's numbers; commit abacus.ratchet.json
```

`init` writes `abacus.config.json`, `.oxlintrc.json` (extending the preset) and
`.oxfmtrc.jsonc`, and adds `lint` / `fmt` / `abc` / `size` / `ratchet` scripts. Then:

```jsonc
// package.json
"check":  "tsc --noEmit && pnpm fmt --check && pnpm lint && pnpm test && pnpm abc && pnpm ratchet",
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

## Ratchet

Fixed budgets get written up to. The ratchet makes the current value the ceiling:

```json
"ratchet": { "file": "abacus.ratchet.json", "metrics": {
  "loc": { "roots": ["src"], "slack": 0.02 }, "oxlintWarnings": true, "abcMax": true,
  "comments": { "roots": ["src"], "max": 0.3 } } }
```

`abacus ratchet` fails when a metric exceeds snapshot × (1 + slack) or the fixed
`max`; it prints "ratchet down available" when one decreased so you can
`--write` the tighter snapshot. LOC = code lines (blank and comment-only lines
skipped, TS/TSX/JS via the TypeScript scanner); comments = comment lines / code
lines; `oxlintWarnings` counts warnings + errors from `oxlint --format json .`.
Raising the snapshot is a reviewed diff to `abacus.ratchet.json`, not a flag.

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

- pnpm ≥ 10 flags git dependencies for build scripts even though `dist/` is
  prebuilt. Silence it once per repo in `pnpm-workspace.yaml`:
  `allowBuilds: { "@tjohnson/abacus": false }`.

- Type-aware lint needs tsconfig `paths` to be relative (`"./src/*"`) and no
  `baseUrl` (tsgolint limitation).
- Generated or vendored code (e.g. shadcn `components/ui`) goes in
  `exclude` and `ignorePatterns`, not in the allow list.
