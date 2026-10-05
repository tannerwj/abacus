# Getting started

[Documentation](README.md) · [Gates](gates.md) · [CI](ci.md)

Abacus works inside an existing TypeScript project. Start with its three default
gates, then add coverage once the native tools understand your project.

## Requirements

- Node 24.12 or newer **within the Node 24 line** is the recommended setup
- pnpm 11.19.0 is the repository's declared package manager
- Git is needed for the public HTTPS package install
- Your project should have a `package.json` and source files; compiler checks
  also need an appropriate TypeScript configuration

Abacus's package metadata declares Node `>=22`. The bundled
`@b12k/gitleaks@8.30.1-v.53` wrapper declares Node `>=24`, and the locked
Linux LZMA binding used by dependency tooling declares `^22.20 || ^24.12 || >=25`.
`dependency-cruiser@18.5.0` declares `^22 || ^24 || >=26`. The documented Node 24
setup satisfies those ranges; the broad Abacus range does not mean every Node 22
version meets every dependency's requirements. Use a supported runtime instead
of disabling engine checks to get an installation through.

## 1. Install

Merge the following entries into your project's existing `pnpm-workspace.yaml`,
or create that file if it does not exist. Keep its other settings and approvals.

```yaml
allowBuilds:
  "@tjohnson/abacus": false
  "@b12k/gitleaks": true
```

The Abacus Git package includes its built `dist/` files. Gitleaks's install script
downloads the official binary and verifies its SHA-256 checksum; approving that
script is needed for secret checks. Review this policy as you would any dependency
build-script approval.

```sh
pnpm add -D git+https://github.com/tannerwj/abacus.git oxlint@1.82.0 oxlint-tsgolint@7.0.2001 oxfmt@0.67.0
```

This is a public Git install, so it needs neither a GitHub account nor SSH setup.
Commit `pnpm-lock.yaml`: it records the resolved Abacus commit and dependency
versions. To choose a specific reviewed revision, append `#<full-commit-sha>`
to the Git URL. There is no npm-release prerequisite in this guide.

## 2. Initialize

Run from your project root:

```sh
pnpm exec abacus init --preset typescript
```

Other presets are `cloudflare-worker`, `vite-spa`, and `nextjs`. Initialization
writes Abacus, lint, formatter, Knip, Gitleaks, dependency-cruiser, and jscpd config
files, and adds missing package scripts.

Existing files and scripts are kept. Read the `skip` and `keep` messages, then
merge any needed settings yourself. In particular, `init --all` selects all
source gates only when it writes a **new** `abacus.config.json`; it does not
replace an existing config. Using `pnpm exec abacus` runs the CLI directly even
if your project already has similarly named package scripts.

Review the generated configuration before committing it:

- Set ABC `roots`, `ratchet.metrics.loc.roots`, `ratchet.metrics.comments.roots`,
  and native entry points to the files you intend to check. Changing ABC roots
  alone does not move the default ratchet scans from `src/`
- Exclude generated or vendored code in the relevant tool's configuration
- Keep type-aware lint's tsconfig `paths` relative, such as `"./src/*"`, without
  `baseUrl`; this is a tsgolint limitation
- Match asset-budget directories to actual build output; the SPA templates use
  `dist/client/assets`, which may differ from your project
- Worker size checks need your project's own installed Wrangler CLI

## 3. Review a baseline and run

```sh
pnpm exec abacus ratchet --write
pnpm exec abacus check
```

The explicit write creates `abacus.ratchet.json`; normal checks never create or
repair it. A missing or invalid baseline fails checking. Review and commit the
snapshot, especially any later change that raises a ceiling.

Writing a baseline does not waive fixed budgets or native lint errors. If it
fails, fix the findings or deliberately adjust the relevant config before
retrying. Existing debt is expected in some projects: use the
[gate guide](gates.md) to understand a finding and keep any allowance specific
and explained.

The default check runs `lint`, `abc`, and `ratchet`. Under the default blocking
configuration, a failing gate makes the command exit nonzero. The report shows
selected checks and excluded source gates. Optional policy enforcement can make
findings advisory; required errors or incomplete coverage still block.

## 4. Add coverage deliberately

Try all nine source gates for one run:

```sh
pnpm exec abacus check --all
```

This adds TypeScript, dead-code, secrets, cycles, duplication, and dated-TODO
checks. Each has native configuration and scope requirements. For example,
select actual compiler projects rather than relying on an empty solution-style
root, and give Knip the entry points your project really uses. A required tool
error or empty intended scan cannot count as a complete pass.

To make the selection permanent, edit `check.gates` in `abacus.config.json`:

```json
{
  "check": {
    "gates": ["lint", "abc", "ratchet", "tsc", "deadcode", "secrets", "cycles", "dupes", "todos"]
  }
}
```

Merge this field into your full config. Formatting and size are separate:

```sh
pnpm exec abacus fmt --check
pnpm build
pnpm exec abacus size
```

`pnpm build` means your own project's build script. Configure size budgets before
using the size gate; the `typescript` preset has none. After building, you can
combine configured size checking with `abacus check --all --with-size`.
Architecture and packed-library profiles are explicitly configured policy checks,
not part of `--all`.

Current cycle checks warn on unresolved imports but may still pass, both as an
individual command and in aggregate evidence. Treat that warning as reduced
coverage, and fix module resolution before relying on the graph check.

## 5. Use the same checks in CI

Run `pnpm exec abacus check` after your frozen dependency install. Keep tests,
formatting, and your build in the workflow where your project needs them. See
[Using Abacus in CI](ci.md) for a complete starting example.

For machine-readable output:

```sh
pnpm exec abacus check --json
pnpm exec abacus check --evidence /tmp/abacus-run.json
```

The evidence-file path must not already exist. Keep it outside the input tree
when comparing reproducible digests. See [check evidence](evidence.md) before
treating a report as a coverage guarantee or supply-chain attestation.

## Troubleshooting

- **Gitleaks is unavailable:** confirm its build-script approval, then run
  `pnpm rebuild @b12k/gitleaks`
- **Existing config was skipped:** merge the desired gates/settings manually;
  `init` is intentionally non-destructive
- **TypeScript checks no source files:** select your actual compiler projects;
  see [compiler projects](compiler-projects.md)
- **Graph imports are unresolved:** check aliases and runtime-specific modules
  in `.dependency-cruiser.cjs`; a warning is not complete graph coverage
- **A size budget has no files:** build first, correct the output directory,
  or set `allowEmpty` only for genuinely optional assets
- **A project path contains `%`:** dependency-cruiser 18 has a known config-loading
  limitation; use a checkout path without a literal `%`

For a reproducible bug, [open an issue](https://github.com/tannerwj/abacus/issues/new/choose)
with the command, versions, redacted output, and a small fixture. Report
vulnerabilities [privately](https://github.com/tannerwj/abacus/blob/master/SECURITY.md).
