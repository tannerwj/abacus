# Behavioral verification evidence

`abacus verify` runs an explicitly supplied command without a shell, captures
its JSON report, and writes a new evidence envelope. `abacus check` imports
configured envelopes without executing their commands. Verification is opt-in
and remains separate from `--all`, so a source-only run never claims tests ran.

Supported formats are Vitest JSON, Playwright JSON, pnpm audit JSON and a small
contract format for existing E2E tools such as tester-army/e2e. Abacus does not
install a test framework into consumers or choose their test cases.

## Record a test run

Build first if the tests use built assets. Put raw output, caches, traces and
evidence outside the evaluated project tree. The raw report and envelope need
distinct, nonexistent paths; reruns use a new disposable directory.

```sh
run_dir=$(mktemp -d)
pnpm exec abacus verify --id e2e --profile behavior --format vitest \
  --report "$run_dir/tests.json" --evidence "$run_dir/evidence.json" \
  -- pnpm exec vitest run --reporter=json --outputFile "$run_dir/tests.json"
```

For Playwright, set `PLAYWRIGHT_JSON_OUTPUT_NAME` to the raw report path before
running `abacus verify ... --format playwright -- pnpm exec playwright test --reporter=json`.
Configure Playwright's output and trace directories outside the source tree too.
For audit, the shipped [audit bridge](examples/audit.mjs) writes `pnpm audit --json`
stdout to the raw report file and preserves its exit status:

```sh
pnpm exec abacus verify --id dependencies --profile dependencies --format pnpm-audit \
  --report "$run_dir/audit.json" --evidence "$run_dir/audit-evidence.json" \
  -- node node_modules/@tjohnson/abacus/docs/examples/audit.mjs "$run_dir/audit.json"
```

Review and copy the bridge into the project if its behavior needs to change.
Abacus suppresses command
stdout/stderr to keep raw diagnostics and tokens out of normalized evidence.

The default command timeout is 120 seconds; `--timeout MS` allows 1 through
3,600,000 milliseconds. Startup errors, signals, timeouts, missing/malformed
reports and source changes produce visible execution issues in the envelope.
`verify` exits 1 on those issues, failed execution, reported failures or no targets.
It exits 2 for invalid invocation or prerequisites. Existing files are preserved.

The envelope records source commit/tree digest, runtime identity, timestamps,
duration, command argument digest, executable hash, exit status, raw-report
hash and normalized results. It omits raw command arguments, test titles,
stdout, stderr and secret-bearing failure text. Native cases get hashed IDs;
contract cases use deliberately named IDs.

## Import evidence in the aggregate check

Add an explicit report to `abacus.config.json`. Point `path` at the new envelope
from the run; changing the config changes source provenance, so write the
configuration before recording verification. CI can use a fixed external
directory which it creates afresh for each job.

```json
{
  "verification": {
    "reports": [{
      "id": "e2e",
      "path": "/tmp/abacus-ci/e2e-evidence.json",
      "format": "playwright",
      "profile": "behavior",
      "required": true,
      "enforcement": "block",
      "maxAgeHours": 24,
      "maxSkipped": 0,
      "maxFlaky": 0
    }]
  }
}
```

Reports are repository-owned and are always evaluated alongside a selected
policy pack. A pack cannot remove these checks. Each result has the ID
`verification/<id>`, normalized counts, scope, report hashes and execution
metadata. Ordinary findings obey `block`, `warn` or `observe`; required
execution errors or incomplete coverage always block.

An import verifies matching identity, profile, format, source commit/tree,
environment when specified, report bytes and recomputed summary. Evidence older
than `maxAgeHours` (default 24), from the future, or with changed source is
incomplete. Keep both the raw report and envelope for re-evaluation.

Skipped and flaky limits default to zero. Vitest JSON does not identify retry
and timeout attempts separately; that limitation stays in evidence. Playwright
retains those attempts and treats expected failures as skipped successful
coverage. Invalid statuses, summary/case disagreement and runner setup failures
never become a clean scan.

## Declare authorization and resilience contracts

An existing test harness can write this data after exercising the real system:

```json
{
  "schemaVersion": 1,
  "cases": [
    { "id": "authorization/other-owner-denied", "status": "passed" },
    { "id": "resilience/replay-after-commit", "status": "passed" }
  ],
  "errors": 0,
  "flaky": 0,
  "timedOut": 0
}
```

Statuses are `passed`, `failed` or `skipped`. IDs are unique, 1 through 160
ASCII letters/digits plus `.`, `_`, `/` and `-`, starting with a letter/digit.
Optional error, flaky and timeout counts are nonnegative integers. Preserve the
test runner's failures when translating its output; never emit fixed passing
results. Keep a failing fixture to test the bridge.

The `authorization` and `resilience` profiles require `format: "contract"`,
an `environment` of `isolated` or `staging`, and a nonempty `assertions` list.
Missing or skipped named assertions make coverage incomplete. Failed named
assertions retain their findings. Record with matching `--profile` and
`--environment` selectors. [Engineering policy](engineering-policy.md) describes
which cases to choose; Abacus cannot infer a project's permissions or invariants.

## Enforce measured performance budgets

Contract cases can include `measurement: { "value": 150, "unit": "ms", "samples": 100 }`.
Values are finite and nonnegative; units are `ms`, `bytes` or `count`; sample
counts are positive integers. The `performance` profile requires a contract
report, environment and at least one budget:

```json
"budgets": [{ "id": "latency-p95", "unit": "ms", "max": 200, "minSamples": 100 }]
```

The report case ID names the measurement. A missing measurement, different unit
or insufficient sample count is incomplete; a measured value over `max` fails.
A skipped measurement case is incomplete even when the report allows other skips.
The producer defines the statistic and workload. Document them so reviewers
can distinguish p95 latency from an average and assess comparability.

## Review dependency audits

Use `profile: "dependencies"` with `format: "pnpm-audit"`. The supported
report contains advisory identities/severities and metadata with dependency and vulnerability
counts. Registry errors, malformed responses and zero targets do not pass.
Any reported vulnerability fails this profile; the repository selects whether
findings are advisory or blocking. Scan development dependencies too unless a
documented policy deliberately chooses a narrower inventory.

Advisory counts must agree with the inventory. Findings retain public GHSA IDs
(or pnpm advisory IDs) so an exception for one advisory does not waive future
advisories. Raw titles, URLs and descriptions are not copied into evidence.

## Evidence boundaries and recovery

Envelopes are unsigned evidence from repository-controlled code. An author can
forge a report; a hash establishes identity and detects changes, not truth.
Review the runner, independent assertions, actual environment and CI origin.
The source digest excludes installed dependencies, and remote staging state is
not attested. Native tools may modify files or make network requests when the
explicit command runs; `verify` is not a sandbox.

Execution resolves native executables without a shell. On Windows, invoke Node
with the framework's JavaScript CLI rather than a `.cmd` shim. The audit bridge
uses pnpm's JavaScript CLI when run through pnpm.

On stale evidence, regenerate reports against the current source. On runner
failure, inspect private raw output and fix prerequisites. Preserve failed
artifacts according to the repository's retention policy, then use new paths.
To undo adoption, review removal of `verification.reports` through the standards
report and restore the previous config. Checks never delete reports or change
thresholds automatically.
