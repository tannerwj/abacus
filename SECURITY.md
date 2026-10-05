# Security policy

## Report vulnerabilities privately

Use GitHub's [Report a vulnerability](https://github.com/tannerwj/abacus/security/advisories/new)
flow for this repository. Sign in to GitHub and submit a private report to the
repository maintainers. Please do not post exploit details, credentials, or
sensitive project data in public issues or pull requests.

Include, when safe:

- The affected Abacus commit or package version, Node version, and operating system
- The vulnerable behavior and its security impact
- A minimal reproduction with fake data and redacted configuration
- The commands and conditions needed to reproduce it
- A suggested fix, if you have one

Check the [Security tab](https://github.com/tannerwj/abacus/security) if you need to
find the reporting flow. Public bug reports are appropriate for ordinary,
non-sensitive correctness or usability problems.

## Scope and support

Abacus is early-stage software. Security fixes target the latest default branch;
there is no published long-term support or backport schedule. Include an exact
Git revision in reports so the affected code can be identified.

Relevant reports include credential disclosure, unsafe subprocess invocation,
unexpected network or write behavior, path-boundary escapes, and ways a check
could conceal a security-relevant failure. Native-tool vulnerabilities may also
need reporting to that tool's maintainers; describe the Abacus integration when
it contributes to the impact.

## Safe usage

- Run Abacus on repositories and native tool configs you trust. Some configuration
  formats and package-validation entry points execute project or dependency code
- Review dependency updates, lockfile changes, and build-script approvals
- Gitleaks checks the working tree and omits secret values from findings. It is
  not a guarantee that no credential exists, and does not replace a full-history scan
- A leaked credential should be revoked or rotated even if the file is removed
- Review report paths, findings, and provenance before sharing evidence publicly
- Read the [evidence boundaries](docs/evidence.md); passing checks are not a
  sandbox, signed attestation, or complete security audit
