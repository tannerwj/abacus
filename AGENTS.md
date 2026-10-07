# Abacus development

Read [engineering policy](docs/engineering-policy.md) for review and verification
requirements. [Cross-app coding standards](https://gist.github.com/tannerwj/defd95424231e010c3c3220cfe15f2fb)
provide Tanner's platform and workflow preferences.

- Abacus evaluates deterministic rules. Keep LLM judgment in policy and review.
- Add no prose comments in new source. Put rationale and limitations in docs.
- E2E is primary. Focused tests are for algorithms, parsers, crypto and money
  calculations; name the failure E2E misses before adding one.
- Never weaken a failing test or refresh a baseline merely to get green.
- Checks and previews never update standards or execute recorded test commands.
- Build and include `dist/` after source changes; Git consumers use those files.
- Run `pnpm check:all` and the relevant rerunnable integration artifacts:
  `pnpm test:verification`, `pnpm test:properties`, `pnpm test:install`.
- Default Git branch is `master`. Branch for large changes. Commit and push only
  when asked; omit attribution lines.
