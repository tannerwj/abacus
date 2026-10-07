# Using Abacus in CI

[Documentation](README.md) · [Getting started](getting-started.md) · [Gates](gates.md)

Install and initialize Abacus in the project first. Commit generated configs,
the reviewed ratchet baseline, build-script policy, and lockfile. CI checks
those reviewed inputs with a frozen install; it should never refresh the baseline
to make a check pass.

## GitHub Actions example

This is a starting workflow for a **consumer repository** that uses pnpm 11.19.0
and the default Abacus gates. Save it as `.github/workflows/quality.yml` in that
repository after reviewing its triggers and permissions.

```yaml
name: Quality

on:
  pull_request:
  push:

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.19.0
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec abacus check
```

Use an installed Node 24 version meeting the documented 24.12 minimum. Follow your
organization's action-pinning policy when adopting the example. It runs repository
code and dependency tooling, so use your normal trust rules for pull requests.

## Select the checks your project promises

- `abacus check` uses the committed `check.gates` selection
- `abacus check --all` selects all nine source gates for that run
- `abacus fmt --check` checks formatting separately
- Your project's test command stays separate
- Size checks need a completed build and configured budgets

For a project with test/build scripts and applicable size budgets, later steps
might be:

```yaml
      - run: pnpm exec abacus fmt --check
      - run: pnpm test
      - run: pnpm exec abacus check --all
      - run: pnpm build
      - run: pnpm exec abacus size
```

Adapt these steps to actual scripts and tool scope. The `typescript` preset has
no size budgets; `--all` does not configure architecture or package-validation
profiles. Required graph coverage blocks when cycle imports remain unresolved.
Configured verification reports run alongside source checks; record them first
with [abacus verify](verification.md). Retain a [standards-change report](standards-changes.md)
against the actual pull request base when budgets or configuration change.

## Evidence

`abacus check --json` keeps a nonzero status when blocking checks fail; redirecting
its output does not change that. For a new evidence file, use
`abacus check --evidence /tmp/abacus-run.json`. Existing files are not overwritten.

Inspect the [evidence contract](evidence.md) before deciding what to retain or
share. Reports omit secret values, but contain repository paths, findings, scope,
and provenance. Use your repository's appropriate artifact visibility and
retention policy.

## This repository's workflow

The committed [quality workflow](../.github/workflows/quality.yml) runs all source
gates, behavior/report integration checks, seeded properties with regression
proof, and a cold install plus packed consumers. It checks that `dist/` was
rebuilt and uploads a standards report against the pull request's base commit.
The workflow uses read-only permissions, a 20-minute limit and seven-day report
retention. Each integration run cleans up its disposable state. The verification
suite queries the dependency advisory service; an unavailable service fails.

Standards reports support review; the default report does not approve or block
intentional weakening automatically. A protected-branch review requirement must
be configured in GitHub if the repository wants enforcement of human approval.
This change does not alter repository settings.

Actions are pinned to verified upstream commits: checkout 7.0.1, pnpm setup 6.1.0,
Node setup 7.0.0 and artifact upload 7.0.2. Review those pins with dependency
updates. CI has one runner per active ref and cancels superseded runs; cold
installs and registry checks consume CI minutes and network requests.
