# Abacus documentation

[Repository](../README.md) · [Contributing](https://github.com/tannerwj/abacus/blob/master/CONTRIBUTING.md) · [Security](https://github.com/tannerwj/abacus/blob/master/SECURITY.md)

## Start here

1. [Getting started](getting-started.md): install Abacus in an existing TypeScript
   project, generate configs, review a baseline, and run a first check
2. [Gates and configuration](gates.md): choose checks, understand their scope,
   and adjust budgets or native tool configuration
3. [Using Abacus in CI](ci.md): use the same repository-owned checks on pull requests

## Share standards and inspect evidence

- [Check evidence](evidence.md): report fields, outcomes, provenance, and coverage limits
- [Policy packs and upgrade previews](policy-packs.md): pin shared standards and review changes
- [Compiler projects](compiler-projects.md): select separate TypeScript projects explicitly
- [Architecture and package profiles](profiles.md): configure complete graph checks and declared library consumers

## Where configuration lives

- `abacus.config.json` selects gates, roots, budgets, and optional policy pins
- `abacus.ratchet.json` records the deliberately reviewed numeric baseline
- `.oxlintrc.json` and `.oxfmtrc.jsonc` configure linting and formatting
- `knip.json`, `.gitleaks.toml`, `.dependency-cruiser.cjs`, and `.jscpd.json`
  configure their native tools
- [The JSON schema](../configs/abacus.schema.json) describes Abacus configuration

Run `pnpm exec abacus help` for the CLI command list. These guides ship in the
package under `node_modules/@tjohnson/abacus/docs`.
