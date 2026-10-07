# Contributing to Abacus

Thanks for helping make Abacus easier to use and its results easier to trust.
Docs fixes, small reproducible fixtures, and practical configuration examples
are useful contributions alongside code.

## Before you start

- Check [existing issues](https://github.com/tannerwj/abacus/issues) and
  [pull requests](https://github.com/tannerwj/abacus/pulls) for related work
- For a large behavior change, open an issue explaining the problem and proposed
  scope before building it
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue
- Be respectful and follow the [community guidelines](CODE_OF_CONDUCT.md)

## Local setup

Use Node 24.12+ within the Node 24 line and pnpm 11.19.0. The
[runtime notes](docs/getting-started.md#requirements) explain bundled requirements.

```sh
git clone https://github.com/tannerwj/abacus.git
cd abacus
pnpm install --frozen-lockfile
pnpm build
```

The checked-in `pnpm-workspace.yaml` approves the required esbuild and Gitleaks
build scripts. Gitleaks downloads its official binary and verifies SHA-256.
The public clone needs no credentials; pushing changes requires your own fork
or write access.

## Checks

```sh
pnpm check:all
```

This builds the CLI, checks TypeScript, runs the test suite, and evaluates every
source gate against this repository's config. It does not run formatting or
consumer bundle-size checks. Native advisory warnings may still be printed;
read the outcomes rather than assuming quiet output means success.

For changes to packaging, native-tool discovery, initialization, or consumer
behavior, also run:

```sh
pnpm test:install
```

This integration test installs into an empty dependency store, checks the clean
checkout, packs Abacus, and exercises the packed package in a consumer whose path
contains spaces. It needs network access for dependencies and the Gitleaks binary.
Include actual results in your pull request. If a check cannot run or exposes
an existing failure, report it explicitly instead of calling the change fully verified.

Verification adapters, coverage handling, defaults and standards reporting also
require `pnpm test:verification`. This runs real Vitest and Playwright API tests
without downloading browsers and retains rerunnable CLI regression scenarios.
`pnpm test:properties` runs the Hegel invariants and demonstrates four failures
by restoring faulty behavior in an isolated copy. Seeded cases can be replayed
with `ABACUS_PBT_SEED`; keep the minimized counterexample on any new failure.
See [engineering policy](docs/engineering-policy.md) for independent oracles and
the [property coverage inventory](docs/property-testing.md).

## Making a change

1. Create a focused branch in your fork or checkout
2. Add a regression test or fixture for a behavior fix, including relevant
   failure/empty-coverage paths
3. Keep native configs readable and outcomes explicit. Configuration errors,
   unavailable tools, and incomplete scans need distinct evidence
4. Update the relevant guide and CLI help when user-facing behavior changes
5. Run `pnpm build` after source edits and include generated `dist/` changes;
   Git-installed consumers receive those committed files
6. Run applicable checks and review the complete diff before opening a pull request

Normal checks and previews must not silently change baselines, policy pins,
budgets, exceptions, native configs, or source files. If a deliberate ratchet
update is needed, explain it separately and show the baseline diff. Do not raise
thresholds or broaden exclusions solely to make unrelated checks pass.

## Reporting a bug

Use the [bug template](https://github.com/tannerwj/abacus/issues/new/choose) and include:

- Abacus revision, Node/pnpm versions, OS, and resolved native-tool versions
- The exact command, expected result, and actual result
- A small fixture and relevant redacted config/output
- Whether it happens with an installed Git package, packed package, or repository checkout

Keep credentials, private source, and personal data out of issues and attachments.
For security-sensitive findings, use the private route in [SECURITY.md](SECURITY.md).
