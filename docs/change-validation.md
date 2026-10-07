# Verification and policy adoption review

This change adds source-bound behavior reports, authorization/resilience
contracts, measured budgets, advisory reports and Git-based standards comparison.
It also makes required graph coverage independent of native violations and
defines the human review responsibilities that deterministic rules cannot own.

## Deliberate standards changes

The repository's measured source LOC grows from 3,003 to 4,456 to implement
the report parsers, execution/import provenance, verification profiles and
standards comparison and validated JSON boundaries. Only `loc src` is refreshed in the committed baseline.
The existing two-percent growth allowance, comment ratio ceiling of 0.051,
maximum ABC of 50 and zero lint findings are retained. The function budget
remains 60; no complexity allowance or finding waiver was added.

The standards report correctly labels that baseline increase as weakening.
It is an explicit feature-scope decision for review, not automatic approval
created by passing under the refreshed baseline. To undo it, restore the
previous implementation and baseline together, rebuild and rerun the checks.

New consumer configs ratchet lint findings and maximum complexity, with LOC
and comments available as explicit options. New configs omit the blanket UI
directory exclusion. Existing incomplete configs preserve their previous
implicit metrics and exclusions; their migration remains a separate decision.

## Dependencies and execution cost

Hegel 0.4.7, Playwright 1.64.0 and Vitest 4.1.11 are exact development pins.
Updating Vitest removes the known advisories found in the previous development
toolchain. The scan includes development dependencies. A clean result applies
to the advisory inventory consulted at execution time.

Hegel needs Koffi's native build, which is explicitly allowed alongside the
existing esbuild and gitleaks installers. pnpm also recorded exact release-age
exemptions for the three Playwright 1.64.0 packages; review these together with
their lockfile integrity. They do not exempt other packages or later releases.
No production dependencies were added. Playwright integration uses its HTTP
API and downloads no browsers.

Seven generated properties run 2,000 cases each, with bounded materialized
collections, a reproducible seed and no property database writes. Four
isolated mutation probes establish that regression assertions detect faulty
behavior. Cold installation intentionally downloads dependencies into a fresh
store; CI caps the entire job at 20 minutes and stores standards reports for
seven days. Native audit integration calls the advisory registry.

## Accounted-for failures

The original suite exposed six macOS path-alias failures: graph/native-input
scoping, evidence symlinks and compiler fixtures disagreed about `/var` and
`/private/var`. Scope validation now canonicalizes existing parents while still
rejecting final symlinks that leave the project. Existing assertions remain.

The policy-merge fixture relied on an old default comment metric. It now
explicitly declares that metric before checking its preservation. Its expected
roots, merged ceiling and immutability assertions are unchanged.

New parser rejection tests first demonstrated that advisory identities were
lost and contradictory audit counts were accepted. The normalization fix
retains public advisory IDs and checks summary counts against actual records.
An E2E failure also demonstrated that a newly added named waiver was only
classified for generic review; the standards report now calls it weakening.

The complete type-aware scan also exposed unsafe JSON casts in existing native
readers and the new evidence readers. Those boundaries now validate object,
array and field types before use, preserving the lint rules and zero-finding
ceiling. Configuration normalization still preserves the legacy implicit
settings. Performance coverage rejects a skipped measurement even when other
skips are allowed; a failing E2E fixture established this regression first.

Native reporter limitations, unsigned evidence, runner-supplied environment
labels and unverified remote staging state are documented in
[verification](verification.md). The CI workflow is prepared locally; running
the equivalent commands does not establish a hosted GitHub Actions result or
configure protected-branch approval requirements.

## Completed validation

- `pnpm check:all`: build, typecheck, 276 tests and all nine source gates pass;
  no lint findings, measured maximum ABC 49 against the retained ceiling of 50.
- `pnpm test:verification`: real Vitest, Playwright HTTP and pnpm audit reports,
  integrity/failure/profile cases, skipped measurements, graph waivers and
  Git standards comparison pass.
- `pnpm test:properties`: 54 focused tests, including seven properties at
  2,000 cases each, and all four isolated regression proofs pass.
- `pnpm test:install`: cold frozen install, packed consumers, source/post-build
  gates, evidence, upgrade previews and complete large JSON output pass.
- The real dependency audit reports no known advisories for the current
  inventory. A separate historical-lockfile run retains ten advisories with
  nine distinct identities and the native failing exit status.
- Workflow YAML parses; read-only permissions, timeout and immutable action
  pin checks pass. Hosted execution remains unverified until it runs in GitHub.
