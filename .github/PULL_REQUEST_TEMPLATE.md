## Summary

Describe the change and the problem it solves. Link a related issue if there is one.

## Verification

- [ ] I ran applicable checks and recorded the exact commands/results below
- [ ] I added regression coverage for behavior changes, where applicable
- [ ] I updated user-facing docs/help if needed
- [ ] I rebuilt and included `dist/` changes for source edits
- [ ] I reviewed baseline, budget, exception, and lockfile changes, if any
- [ ] I reviewed `abacus standards --base <review-base> --json` and explained any weakening
- [ ] I checked authorization, replay/concurrency, performance and dependency risks where applicable
- [ ] Expected values have an independent basis; new regression tests fail with the faulty behavior restored

### Commands and results

Include passed, failed, and blocked checks. Run `pnpm check:all`, `pnpm test:verification`,
`pnpm test:properties` and `pnpm test:install` as required by [repository policy](../AGENTS.md).

## Notes for review

Explain intentional coverage limits, compatibility changes, and any existing failures.
Remove private source, credentials, and personal data from examples and output.
