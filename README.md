# abacus

Plug-and-play quality gates for TypeScript projects. One dev dependency, one
config file, three commands. Budgets live in your repo so every exemption has
an owner and a reason.

| Gate | What it catches | Tool |
| --- | --- | --- |
| Cyclomatic complexity ≤ 20, depth ≤ 4, params ≤ 6 | branchy functions nobody can hold in their head | oxlint (`complexity`, `max-depth`, `max-params`) |
| ABC score ≤ 60 per function | the *other* kind of bloat: 150 calls and no branches (registration blobs, god-functions) | `abacus abc` (TypeScript AST) |
| ≤ 400 lines/file, ≤ 120 lines/function (warn) | files that became modules by accident | oxlint (`max-lines*`) |
| Floating / misused promises | the classic silent Worker bug | oxlint type-aware (`tsgolint`) |
| gzip bundle budgets | the SPA quietly doubling, the Worker creeping toward the 1 MB limit | `abacus size` (+ `wrangler deploy --dry-run`) |

## Install

```bash
pnpm add -D git+ssh://git@github.com/tannerwj/abacus.git oxlint oxlint-tsgolint
pnpm abacus init --preset cloudflare-worker   # or: typescript | vite-spa
```

`init` writes `abacus.config.json` and `.oxlintrc.json` (extending the preset),
and adds `lint` / `abc` / `size` scripts. Then:

```jsonc
// package.json
"check":  "tsc --noEmit && pnpm lint && pnpm test && pnpm abc",
"deploy": "pnpm check && pnpm build && pnpm size && wrangler deploy"
```

## Presets

- **typescript** — base rules + complexity/ABC budgets. No size gates.
- **cloudflare-worker** — base + `no-restricted-globals` for `process`/`__dirname`,
  Worker bundle gzip budget (400 KB), SPA asset budgets if you serve one.
- **vite-spa** — base + react/jsx-a11y, per-chunk and CSS gzip budgets.

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

## What it deliberately is not

No dashboards, no history, no CI plugins. It exits non-zero and prints the
offenders. Wire it into whatever runs your checks.

## Notes

- Type-aware lint needs tsconfig `paths` to be relative (`"./src/*"`) and no
  `baseUrl` (tsgolint limitation).
- Generated or vendored code (e.g. shadcn `components/ui`) goes in
  `exclude` and `ignorePatterns`, not in the allow list.
