# abacus

**Repeatable engineering standards for every repo.**

abacus is a command-line toolkit for TypeScript projects. Start with a preset,
keep quality rules and budgets in your repository, and run the same checks
locally and in CI. It brings linting, complexity, dependency hygiene, secrets,
and bundle budgets into one reviewable workflow.

[Getting started](docs/getting-started.md) · [Documentation](docs/README.md) ·
[Contributing](https://github.com/tannerwj/abacus/blob/master/CONTRIBUTING.md) · [Security](https://github.com/tannerwj/abacus/blob/master/SECURITY.md)

## Quick start

Run these commands in an existing TypeScript project with a `package.json`.
Use **Node 24.12+ on the Node 24 line** and **pnpm 11.19.0** for the recommended
setup. [Runtime and installation notes](docs/getting-started.md#requirements)
explain the declared Node range and bundled tool requirements.

First, merge this build-script policy into your `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  "@tjohnson/abacus": false # the Git package includes built dist files
  "@b12k/gitleaks": true # downloads the official binary and verifies SHA-256
```

```sh
pnpm add -D git+https://github.com/tannerwj/abacus.git oxlint@1.82.0 oxlint-tsgolint@7.0.2001 oxfmt@0.67.0
pnpm exec abacus init --preset typescript
pnpm exec abacus ratchet --write
pnpm exec abacus check
```

The public HTTPS install needs no GitHub account or SSH key. Commit your lockfile,
generated configuration, and `abacus.ratchet.json` after reviewing them.
`init` preserves existing files and package scripts.

The default check runs **lint, ABC complexity, and the ratchet**. A first run may
find existing debt: review the findings and tune your repository's configuration
before making it a merge requirement. The [step-by-step guide](docs/getting-started.md)
covers existing configs, adding gates, and your first CI check.

## What you get

- **Useful defaults.** Type-aware Oxlint presets, per-function complexity budgets,
  and a baseline that catches unreviewed growth
- **More coverage when you need it.** TypeScript errors, dead code, secrets,
  circular imports, duplication, dated TODOs, formatting, and built bundle size
- **Rules your team can inspect.** Native tool configs stay in the repository;
  budgets and exceptions can be reviewed alongside code
- **Evidence you can reuse.** JSON reports record outcomes, scan scope, findings,
  and source/configuration/tool provenance
- **Standards you can upgrade deliberately.** Optional pinned policy packs and
  previews compare policies against the same unchanged project before adoption
- **Behavior you can verify.** Opt-in test and audit evidence binds real runs to
  source, with authorization, resilience and measured performance profiles
- **Changes to the standards you can review.** Compare budgets, baselines,
  coverage requirements and native configuration against a Git revision

Use individual commands while fixing a finding, or select source gates together:

```sh
pnpm exec abacus check --all
pnpm exec abacus check --all --json
```

`--all` selects the nine source gates. Formatting is separate. Size runs after a
build with configured budgets. Architecture and packed-library profiles require
explicit policy configuration. Review each tool's scope and prerequisites before
opting in; [gate selection and configuration](docs/gates.md) covers the details.

## Choose a preset

| Preset | Starting point |
| --- | --- |
| `typescript` | General TypeScript projects; complexity budgets, no size budgets |
| `cloudflare-worker` | Worker-specific lint rules, Worker gzip budget, and SPA asset budgets |
| `vite-spa` | React and accessibility lint rules with JavaScript/CSS gzip budgets |
| `nextjs` | React, accessibility, and Next.js lint rules with generated-file exclusions |

Pass a preset to `abacus init --preset <name>`. Review source roots and output
paths for your project: asset budgets are templates, and Wrangler must be
installed separately for Worker measurements.

## Documentation

- [Getting started](docs/getting-started.md): install, initialize, review, and check
- [Gates and configuration](docs/gates.md): commands, budgets, baselines, and exclusions
- [Using Abacus in CI](docs/ci.md): a small workflow and explicit build ordering
- [Check evidence](docs/evidence.md): outcomes, coverage, provenance, and limitations
- [Policy packs and upgrade previews](docs/policy-packs.md): versioned shared standards
- [Compiler projects](docs/compiler-projects.md): check separate platform configurations
- [Architecture and package profiles](docs/profiles.md): boundaries and packed-library consumers
- [Behavioral verification](docs/verification.md): real test/audit reports and risk profiles
- [Standards changes](docs/standards-changes.md): review changes to the definition of passing
- [Engineering policy](docs/engineering-policy.md): requirements, independent tests and reviewer judgment

The package includes `docs/`, so these guides are also available in
`node_modules/@tjohnson/abacus/docs`.

## Status and scope

abacus is early-stage software. Review configuration and dependency updates before
adopting them, and commit the lockfile to pin your installed Git revision and tools.
The supported setup here is a Git install; the package name is not a claim of an
npm release.

Coverage matters as much as a green result. Cycle checks retain detected findings
and report unresolved imports as incomplete coverage. Required graph coverage
blocks independently of whether a cycle was found or waived. See
[cycle checks](docs/gates.md#circular-dependencies) and [evidence boundaries](docs/evidence.md).

## Community

Bug reports, practical examples, clearer docs, and small fixes are welcome.
Read [CONTRIBUTING.md](https://github.com/tannerwj/abacus/blob/master/CONTRIBUTING.md) for setup and checks, and follow our
[community guidelines](https://github.com/tannerwj/abacus/blob/master/CODE_OF_CONDUCT.md).

For vulnerabilities, use [private reporting](https://github.com/tannerwj/abacus/blob/master/SECURITY.md); please keep exploit
details and credentials out of public issues.

## License

[MIT](LICENSE).
