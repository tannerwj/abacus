# Additions for the cross app coding standards

These additions extend [Tanner's coding standards](https://gist.github.com/tannerwj/defd95424231e010c3c3220cfe15f2fb)
with the review responsibilities that accompany executable rules. Platform
requirements in the existing standards continue to apply.

## Quality and verification

**Three kinds of standards.** Abacus owns deterministic source checks. Test
harnesses verify behavioral contracts against the real implementation. Review
owns design and risk decisions. Agent skills help prepare work and evidence;
an agent's judgment is never a substitute for a deterministic merge gate or
the reviewer responsible for an exception.

**Independent expectations.** Establish the requirement, invariant or reference
before implementing the feature. Tests generated alongside code can repeat
its mistake. Expected values come from a spec, hand calculation or independent
reference. A round trip needs an independent example when two matching bugs
could cancel each other.

**Property testing where it earns its keep.** Use Hegel or the project's
existing property-testing library for parsers, algorithms, cryptographic and
money calculations that E2E cannot explore adequately. Exercise valid and
hostile inputs, boundaries, ordering and scale. Keep minimized counterexamples
and rerunnable commands. Never narrow a failing generator or loosen an oracle
to obtain a pass without an independently justified correction to the test.

**Evidence belongs to the source it tested.** Record the command execution,
source identity, report bytes, outcomes and actual coverage. Missing, stale,
malformed or empty evidence is unknown. Required unknown coverage blocks even
when violations are advisory. Show skipped tests, retries and timeouts, and
state reporter limitations instead of treating unavailable fields as proof.

## Risk profiles

**Authorization.** Test anonymous, owner, other-owner/tenant and read-only
actors against the resource and action matrix. Denied operations must leave
state unchanged. Server enforcement is the contract; UI visibility is secondary.

**Resilience.** Test response loss after commit, replay with the same operation
identity, concurrent claims and opposing requests. Assert entities, counters
and history, not just status codes. Use isolated state and staging-specific
identifiers for resets.

**Performance.** Budgets name the statistic, unit, workload, environment and
minimum sample count. Gzip budgets cover transfer size; measure actual latency,
CPU, memory and request counts where they matter. Cap test resource use and
justify threshold changes with comparable evidence.

**Dependencies.** Review direct/transitive changes and newly allowed install
scripts, and retain known-vulnerability audit results. Unavailable advisory
services do not produce a clean scan. A clean result covers the inventory and
advisory source used, not every possible supply-chain risk.

## Standards governance

**Review the definition of passing.** Every change to budgets, baselines,
gates, assertions, exclusions, native rules and enforcement is visible in
`abacus standards --base <review-base>`. A passing run under weaker rules does
not approve the weakening. The reviewer records why it is appropriate and what
protection remains.

**Metrics need context.** LOC and comment-ratio ceilings are explicit choices,
not universal quality requirements. Preserve existing project policy until a
reviewed migration. Legitimate feature growth can increase code size. Keep
names and structure readable rather than optimizing syntax for a score.
Source rationale stays in docs. Review narrowly scoped required legal notices
or machine directives separately from prose comments.

**Accountable debt.** Temporary waivers name an owner, exact finding, reason
and expiration. Permanent intentional growth is an explicit budget decision.
Baseline updates explain the measured increase in the same change. Ordinary
checks and previews never create approval, update a baseline or change rules.
