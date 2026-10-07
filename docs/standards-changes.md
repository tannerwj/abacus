# Reviewing standards changes

`abacus standards --base master` compares the current working tree, including
uncommitted changes, with an explicit Git revision. It reports changes to the
definition of passing before reviewers assess a green result under new rules.
Use the actual pull request base when it differs from `master`.

```sh
pnpm exec abacus standards --base master --json
pnpm exec abacus standards --base master --fail-on weakening
```

The default only reports and exits 0. `--fail-on weakening` exits 1 when known
weakening is detected; `--fail-on any` exits 1 for every standards change,
including tightening. Invalid configuration, unsupported inputs or an unknown
Git revision exits 2. The command reads Git blobs and current files; it never
checks out the base, executes historic config, updates a baseline or writes an
approval record.

## What the report compares

- Effective Abacus gates, roots, budgets, exclusions, metrics, exceptions,
  verification requirements and policy pins
- Default and configured custom ratchet files, read as numeric ceilings
- Package scripts across the tracked workspace
- Conventional native analyzer/compiler/test/Worker configs, bundled `configs/`,
  CI workflow files and hooks
- Local policy manifests and their declared native-file closure

Known increased ceilings, removed checks or targets, broader exclusions,
weaker enforcement, enabled empty assets and removed scripts are classified as
`weakening`. Known smaller ceilings and expanded checking are `tightening`.
Changes whose effect needs interpretation are `review`. Native file changes
always need review: arbitrary executable config is never interpreted.

The report includes file/field identities, rationale, before/after digests,
base commit and current source identity. It omits raw native file contents.
Installed pack contents and ignored untracked files are outside the report;
review lockfiles, package changes, policy pins and nonconventional inputs too.
Classification is a conservative aid to review, not a proof of every config's
meaning. A mixed list change is weakening when it removes required coverage
or adds exclusions, even if it also strengthens another part.

## Review an intentional change

Explain the user or engineering need, the old and new limits, measured effects
and the failure modes that remain protected. Review code and test changes
separately from changes that make them pass. A temporary exception needs an
owner, reason, exact target and expiration. Permanent feature growth needs an
explicit budget decision rather than a fictional expiration.

Approval belongs to the repository's reviewers and protected merge process.
The author cannot approve their own weakening by producing evidence under new
rules. Retain the report as a CI artifact and link the decision in the pull
request. Strict fail-on modes need a deliberate repository workflow for
reviewed standards changes; the CLI does not bypass that workflow.

## Restore previous standards

Restore the reviewed config, native files, snapshot and lockfile from the
previous revision together. Reinstall with the frozen lockfile, regenerate
behavioral evidence and run the same checks. Record why the upgrade was
reverted. A rollback of the policy is not permission to hide an existing failure.
