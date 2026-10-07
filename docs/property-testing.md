# Property testing scope and regression proof

Abacus uses pinned Hegel 0.4.7 for its pure policy/parser logic. Tests use 2,000
cases per property, a fixed default seed of 20261007 and no local database
writes. Set `ABACUS_PBT_SEED` for a different reproducible run. String/collection
materialization is bounded to keep CI resource use predictable; integer values
and semantic-version numeric components cover their full generator domains.

These properties target failures ordinary CLI examples cannot enumerate:

| Surface | Contract and failure mode |
| --- | --- |
| Canonical policy JSON | Object-key permutations, hostile keys and Unicode must preserve identity; integer arrays round-trip without value or order loss |
| Semantic versions | Increasing a numeric component preserves order across arbitrary digit widths; leading-zero versions are rejected |
| Exact exceptions | Changing either rule or subject cannot waive a finding; an exact match cannot erase tooling, applicability or coverage failures |
| Policy preview | Identical evidence, including generated finding sets, produces no added/resolved findings or new blockers |
| Native/contract report parsers | Assertion totals must agree with summaries; unknown status, missing attempts, invalid units/counts and duplicate contract identities fail visibly |

`pnpm test:properties` also restores four faulty implementations in a disposable
copy: insertion-order canonicalization, string version ordering, inexact waiver
matching and waivers that erase missing coverage. Each selected test must fail
an assertion. Startup failures and surviving mutations fail the proof command.
The real checkout is never modified by this probe.

## Public surface inventory

The index exports and adapter families determine scope. Property checks focus
on combinatorial pure logic; the remaining surfaces have a stated verification
approach rather than a blanket claim of property coverage.

| Public family | Verification approach |
| --- | --- |
| ABC measure, source/project scoring, naming and reporting | Hand-calculated AST cases and source-gate fixtures; no new randomized AST generator in this change |
| Size measurement, gzip and reporting | Missing/empty asset and real compressed-file fixtures; build/runtime wrappers verified through packed consumers |
| Configuration, presets and initialization | Real CLI initialization, preserved legacy implicit policy, runtime validation and packed install |
| Ratchet measurement, scanner line counts and reporting | Existing hand-calculated parser cases, explicit baseline failure paths and packed consumer runs |
| Gate selection and aggregate checking | Existing gate regressions plus real CLI evidence, source mutation and independent coverage checks |
| Policy validation, resolution and digest | Pure canonical/exception/version properties plus native-closure, symlink, schema and integrity fixtures; filesystem resolution stays in integration checks |
| Preview comparison | Generated identity property and existing explicit policy-change, tool/source/config mismatch cases |
| Architecture and TypeScript profiles | Real native graph/compiler fixtures, separate projects and source/config closure regressions |
| Packed package validation | Real tarball consumers, runtime exports, declarations and disabled lifecycle-script cases |
| Verification parsing and recording/import | Parser rejection cases and real Vitest/Playwright/audit CLI evidence; timestamps, budgets, skips, retries, timeouts and source/report tampering |
| Verification configuration | Real CLI profile selection and missing assertions/measurements; malformed configuration is checked before evaluation |
| Standards reporting | Disposable Git repository comparing gates, roots, budgets, custom baselines, scripts, native rules and enforcement |

The seeded property suite supplements E2E. It does not claim every public
function has a generative test, prove arbitrary program equivalence or attest
remote staging state. Native reporting limitations stay explicit in evidence.

## Failure handling

Retain the Hegel counterexample, seed, property name and complete rerun result.
Determine whether code or the expectation violates the stated contract. Fix
the implementation or independently justify the test correction; keep every
observed failure accounted for. Do not shrink the generator domain or change a
numeric tolerance solely to avoid the failure. Rerun the full relevant suite
after the fix. [Hegel's review checklist](https://github.com/hegeldev/hegel-skill/blob/main/skills/hegel-review/SKILL.md)
provides the checks for independent evidence, both directions and untested variants.
