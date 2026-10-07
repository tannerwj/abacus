# Engineering policy for Abacus projects

Abacus makes engineering standards repeatable. Review establishes that the
standards describe the right behavior, the checks cover the intended inputs,
and any departure is deliberate. A passing report supports that decision;
it does not establish product correctness by itself.

Use this policy with the project's requirements, threat model and operational
runbooks. Tanner's [cross-app coding standards](https://gist.github.com/tannerwj/defd95424231e010c3c3220cfe15f2fb)
remain the source for his platform and workflow preferences. This policy adds
the verification and review responsibilities needed when adopting Abacus.

## Assign each rule to the right kind of check

| Kind | Examples | Required evidence |
| --- | --- | --- |
| Deterministic source rule | Type errors, complexity ceilings, dependency boundaries, credentials, bundle size | An applicable Abacus gate with declared scope and actual coverage |
| Behavioral contract | Authorization, retries, atomic claims, user journeys, runtime budgets | Tests against the actual implementation, imported with source and execution provenance |
| Engineering judgment | Whether a feature is needed, abstraction quality, meaningful names, acceptable risk | A reviewer explains the decision using requirements and evidence |

Keep judgment in policy and review. Abacus never invokes an LLM to decide
whether code is good or an exception deserves approval. Agent skills can help
author tests and prepare review evidence; their conclusions are not merge gates.

## Establish the contract before implementing it

State the user outcome, relevant failure modes and acceptance conditions before
changing behavior. Identify the data owner, permitted actors, side effects and
recovery path when they apply. Expected values come from a specification, a
hand calculation or an independently established reference.

An agent that writes an implementation and its tests can repeat the same
misunderstanding in both. Review the test's basis independently. Round trips
alone can hide two mutually compensating bugs; also check a known external
example or independent invariant when the format or algorithm requires it.

## Verify behavior through the shipped interface

E2E is the primary strategy. Exercise what users run, including shipped
templates and defaults, happy paths, denied requests, empty states and recovery.
Every new route gets a test in the same change. Use disposable state and
deterministic fixtures; wait for actual UI and network state before asserting.
Never mock the application to test the application.

Pure algorithm, parser, cryptographic and money calculations may need focused
tests because their input spaces are difficult to reach through E2E. Before
adding one, name the failure E2E would miss. Property tests explore valid and
hostile inputs, boundaries, ordering and scale. Keep minimized counterexamples
and a rerunnable command. Hegel is optional for consumers and a pinned
development dependency for Abacus itself.

For a fix or security invariant, demonstrate that the regression test fails
when the faulty behavior is restored in an isolated checkout. Restore the fix
and rerun the real check. Investigate every failure; do not delete, skip,
weaken assertions, widen tolerances or narrow generators to obtain green.

Native reporter support has limits. Vitest JSON does not expose retry and
timeout attempts separately. Use explicit contract evidence for those claims.
Playwright expected failures count as unexercised passing coverage. Keep raw
reports and traces private when they can contain source, credentials or user data.

## Review the risks the project actually has

Authorization tests exercise an actor and resource matrix: anonymous access,
the owner, another owner or tenant, read-only credentials and denied mutations.
Check server enforcement and the absence of unauthorized side effects. Hiding
a button does not establish authorization. See [OWASP authorization testing](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.html).

Resilience tests exercise response loss after commit, replay with the same
operation identity, overlapping claims, and same-answer and opposing-answer
requests. Verify owned entities, counters and resulting history. A retry test
that fails only before the server receives a request misses duplicate writes.

Performance budgets name the measured quantity, unit, workload, environment,
sample minimum and threshold. Measure user or service latency, CPU, memory or
request counts as relevant; gzip bytes establish transfer size. Calibrate
limits with comparable runs and justify changes. More samples and deployed
staging tests consume time and platform resources; cap concurrency and test
traffic, and use separate staging identifiers before running destructive resets.

Dependency review includes direct and transitive changes, known vulnerability
reports and any newly permitted installation scripts. An unavailable registry
or empty inventory is unknown coverage. A clean audit only establishes that
the consulted advisory source reported no known issues for the scanned inventory.

## Keep checks applicable and coverage explicit

Review source roots, tool entrypoints, compiler projects, native exclusions and
built assets. Generated and vendored code need specific exclusions with a
reason; a directory name alone does not establish that all its contents are
third-party code. Inspect skipped and flaky counts and missing assertions.

Required missing tools, invalid reports, zero targets, stale evidence and
incomplete coverage block even in advisory mode. Cycle findings remain visible
when imports are unresolved; the required coverage result blocks separately.
Exceptions cannot turn missing evidence into verified behavior.

The environment label on verification evidence is supplied by the runner.
Review target identity, test isolation and staged deployment revision yourself.
Source hashes do not attest remote databases, deployed bundles or telemetry.

## Use metrics to support maintainability

Keep correctness rules blocking once their scope is established. New Abacus
configs ratchet lint findings and maximum complexity. LOC and comment-ratio
ceilings are explicit opt-ins; existing configs retain their previous defaults.
Total ABC complexity is also reported to show growth that a maximum can hide.

A feature can legitimately add code. A function can be legitimately complex.
Explain those cases and review the design rather than shortening names,
compressing code or splitting functions solely to satisfy a metric. Avoid
prose comments in new source; put rationale, threat models and workarounds in
docs and name tests after the invariants. Required legal notices and machine
directives need explicit, narrowly scoped review.

## Review changes to the definition of passing

Run `abacus standards --base master --json` against the actual review base.
Review increased ceilings, refreshed baselines, removed gates or assertions,
broader exclusions, weaker enforcement, test-script changes and all changed
native configuration. Use `--fail-on weakening` or `--fail-on any` when the
repository's approval process has a way to handle deliberate standards changes.

An author may prepare a standards change but cannot establish its approval by
recording a passing run under the new rules. The reviewer assesses the before
and after report and records the rationale in the pull request or decision log.
Permanent intentional growth is documented as a budget decision. Temporary
finding waivers name an owner, reason, exact target and expiration.

Keep baseline updates explicit and explain the measured increase in the same
change. Ordinary checks never rewrite them. Keep tool versions and policy pins
locked, preview shared-policy upgrades on unchanged inputs, and compare
configuration effects before promoting advisory violations to blocking.

## Release with a recovery path

Run applicable source checks, E2E and property checks, dependency audit, the
build and post-build budgets. Record failed or unavailable checks accurately.
Review migrations and backward compatibility, staging evidence and telemetry
as required by the project. Know the previous deploy revision and exact rollback
procedure before production changes; verify served behavior and telemetry after
deployment. A code rollback must remain compatible with an additive migration.

Restore a previous Abacus policy pin, native configuration, baseline and
lockfile together if a standards upgrade must be reverted, then run the same
checks. Evidence from the previous source tree must be regenerated. Keep the
failure and decision recorded so a rollback does not become a silent waiver.
