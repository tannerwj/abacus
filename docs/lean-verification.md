# Optional Lean model verification

Lean is an opt-in producer for Abacus's existing verification gate. Nothing is
proved merely by adding this configuration. Participating projects must supply
reviewed specifications, Lean definitions and proofs, and explicit expected
theorem identities. Abacus itself does not acquire a proof of its TypeScript
implementation by shipping this adapter.

## Assurance and supported scope

A successful report means the registered theorem declarations have the exact
registered structural types, their modules were rebuilt with pinned Lean
4.34.1, the resulting declarations were replayed with `leanchecker --fresh`,
using the same Lean kernel (not an independently implemented checker),
and their transitive kernel dependencies use only `propext`, `Classical.choice`
and `Quot.sound`. The bundled `leanchecker` is the supported successor to the
standalone `lean4checker` in this release. Direct and indirect `sorryAx`, custom
axioms and native-evaluation assumptions are rejected. Only actual theorem
constants from the registered module count; an imported namesake or a definition
does not substitute for the theorem.

The type digest is SHA-256 of canonical JSON containing the theorem's universe
parameters and structural kernel expression. The shipped auditor does not use
pretty printers, custom notation or cached exported-axiom summaries. It follows
types and proof/definition values through the kernel constant graph. Review
must still establish the meanings of referenced definitions, hypotheses,
quantifier domains and the relationship to the intended requirement. A theorem
about a hand-written model does not prove that a TypeScript function implements
that model. That requires a separately justified refinement/translation link
and tests of the shipped implementation.

Version one deliberately supports standard-library-only projects: a pinned
`lean-toolchain`, `lakefile.toml`, a `lake-manifest.json` with no packages, and
named Lean libraries. Executable `lakefile.lean`, custom Lake options, external
dependencies, prebuilt proof artifacts and input symlinks are unsupported.
Existing `.lake` state is never copied or trusted. Unsupported scope blocks
required evidence; it is not a successful empty scan.

## Trust and isolation

Proof elaboration and module initialization can execute code. The explicit
runner requires Linux and `/usr/bin/bwrap` with working user, PID and network
namespaces. It clears the environment, creates a fresh read-only proof-source copy with only `.lake` writable,
mounts the pinned toolchain and auditor read-only, exposes read-only system
runtime libraries, and disables networking. It does not mount the project,
user home, credentials or the host temporary directory into the sandbox. There
is no unsandboxed fallback and no automatic package/toolchain download.

Use reviewed proof sources and an administrator-provisioned, official toolchain
in a disposable, secret-free CI worker. Treat the OS, bubblewrap, system runtime
libraries, Abacus runner/auditor, Lean kernel and artifact store as trusted.
Timeouts and bounded captured output protect availability but are not a complete
resource-exhaustion defense; apply worker CPU/memory/disk limits too. Abacus does
not claim protection against a determined malicious proof author or compromised
host; the checker also assumes structurally valid `.olean` files. For that threat model use Lean's trusted challenge/comparator workflow
and independent external checkers, with its own reviewed sandbox boundary.

The imported JSON is a trusted-producer record, not a signature, remote
attestation or independently executed proof checker. Anyone able to rewrite
both reports and envelopes can forge claims, just as with imported behavioral
test evidence. Restrict CI artifact writes and review the configured recording
command. `abacus check` only validates/imports artifacts; it never executes
recorded commands, installs tools, rebuilds proofs or changes standards.

## Registration

Install the official Lean 4.34.1 distribution on the CI worker before running
Abacus. Record SHA-256 for `bin/lean`, `bin/lake` and `bin/leanchecker` and the
complete distribution identity:

```sh
node --input-type=module -e 'import { digestToolchain } from "@tjohnson/abacus"; console.log(digestToolchain(process.argv[1]))' /opt/lean-4.34.1
sha256sum /opt/lean-4.34.1/bin/{lean,lake,leanchecker}
```

`digestToolchain` hashes a deterministic manifest of every file and internal
file symlink under `bin` and `lib`, binding the kernel/shared libraries and
standard-library objects as well as launcher binaries. The runner checks these
identities before and after verification. Distribution hashes are platform
specific; review toolchain updates together with their security fixes and
changes to standard-library assumptions.

Put the informal contract in `docs/`, reviewed formal sources under `proofs/`,
and register every expected theorem. This example is a configuration template:
replace every `REVIEWED_*_SHA256` with a reviewed 64-character lowercase digest.
It cannot pass as supplied. Do not use a hash copied from an unexplained failing
proof as approval to change the target.

```json
{
  "verification": {
    "reports": [{
      "id": "critical-model",
      "path": "../artifacts/lean-evidence.json",
      "format": "lean",
      "profile": "formal",
      "required": true,
      "enforcement": "block",
      "environment": "isolated",
      "maxAgeHours": 24,
      "lean": {
        "project": "proofs",
        "specifications": ["docs/critical-contract.md"],
        "toolchain": "leanprover/lean4:v4.34.1",
        "toolchainDigest": "REVIEWED_DISTRIBUTION_SHA256",
        "tools": {
          "lean": "REVIEWED_LEAN_SHA256",
          "lake": "REVIEWED_LAKE_SHA256",
          "leanchecker": "REVIEWED_CHECKER_SHA256"
        },
        "targets": [{
          "module": "Model",
          "name": "Model.contract",
          "typeDigest": "REVIEWED_KERNEL_TYPE_SHA256"
        }]
      }
    }]
  }
}
```

The project requires these Lake files, with its actual module/library name:

```toml
name = "Model"
[[lean_lib]]
name = "Model"
```

`lean-toolchain` contains `leanprover/lean4:v4.34.1`.
`lake-manifest.json` must be checked in with `packages: []`; generate/review it
with the pinned Lake version, before recording evidence.

For initial type enrollment, review the theorem and all definitions first,
then use `configs/lean/Audit.lean` in the same isolated toolchain to inspect its
structural `type` JSON and standard-axiom audit. Hash `JSON.stringify(type)` with SHA-256; this structural representation contains
only arrays and scalar values, so no object-key ordering is involved. The runner reports a mismatched actual type
digest for review but never rewrites registration. The rerunnable fixtures in
`test/lean-native-e2e.mjs` demonstrate this process on a trivial identity model;
the fixture is not a proposed application requirement.

## Explicit recording, then read-only checking

Create a writable artifact directory outside the evaluated project. Both paths
must be new; recording does not overwrite previous evidence. After the project
config and specifications are final:

```sh
abacus verify --id critical-model --profile formal --format lean \
  --report ../artifacts/lean-report.json \
  --evidence ../artifacts/lean-evidence.json --timeout 900000 -- \
  abacus lean --id critical-model --report ../artifacts/lean-report.json \
  --toolchain-dir /opt/lean-4.34.1 --timeout 600000
abacus check --json
abacus standards --base master --json --fail-on any
```

The outer recording timeout must leave time for complete distribution hashing
and cleanup. Fresh kernel replay includes imported modules and can be materially
slower than an incremental build. Set a bounded timeout appropriate to the
worker; timed-out work never becomes passing evidence.

The envelope binds execution, source tree, raw report bytes and elapsed time.
The Lean report additionally binds normalized registration configuration,
toolchain/distribution/tool digests, an adapter digest of shipped Abacus JavaScript
modules and its Lean auditor, each proof-project and specification file,
exact targets, structural types and transitive axiom lists. These independent
input hashes still protect proof/specification files accidentally excluded from
the general source digest. Current evidence must match all of them.

Required missing, malformed, empty, stale, future-dated, timed-out, failed or
unsupported evidence blocks even with `warn` or `observe` enforcement. A
nonzero checker/runner exit is incomplete formal coverage, not a waivable
axiom violation. Unexpected targets do not substitute for expected targets.
Plain `abacus check` honors configured verification reports as well as its JSON
form. A successful `verify` envelope creation is not itself a passing gate;
run `check` against the current configuration.

## Review and verification

The reviewed feature-growth budget raises Abacus's source LOC snapshot from
4,456 to 5,120 for the optional runner, strict report/config validation and
identity tracking. The existing 2% slack, complexity budget, warning baseline
and comment-ratio ceiling are unchanged. This budget decision does not waive
missing evidence or the outstanding supported-host sandbox integration check.

`abacus standards` includes configured proof-project files and specification
files from both the base revision and working tree. Theorem/type registration
changes and removed specification inputs are potentially weakening; changed
proof definitions, assumptions, toolchains and source specifications require
review. Regenerating a passing artifact does not approve these changes.

Run `pnpm test:verification` for CLI evidence/import and standards regressions.
`pnpm test:properties` also restores forbidden-axiom and theorem-type faults in
an isolated copy and requires the shipped CLI regressions to fail.
Run `ABACUS_LEAN_TOOLCHAIN=/opt/lean-4.34.1 pnpm test:lean-native` on a supported isolated
Linux worker for real positive/negative proof and runner checks. The narrower
`node test/lean-native-e2e.mjs --tools-only` mode exercises the official tools on
the small reviewed repository fixtures; it does not establish that the sandboxed
runner works. Never use that mode for unreviewed external proofs.

References: [Lean proof validation](https://lean-lang.org/doc/reference/latest/ValidatingProofs/),
[Lean axioms](https://lean-lang.org/doc/reference/latest/Axioms/),
[engineering policy](engineering-policy.md), [verification evidence](verification.md).
