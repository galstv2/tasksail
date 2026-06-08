# Pre-Commit And CI

Setup configures repository git hooks. Local checks and CI lanes keep validation, docs quality, workflow contracts, Python tests, and desktop shell contracts aligned.

## Local

Use:

```bash
pnpm run validate
pnpm run local-checks
pnpm run test:contracts
pnpm run check-open-source-readiness
```

## CI

The docs-check workflow validates Markdown links and docs/contract behavior, then runs desktop shell checks. CI may use direct hosted-tool setup for Python and Node, while local docs execution should prefer the repository Python wrapper.

## Sources of truth

- [pre-commit hook runner](../../../src/backend/platform/validation/preCommitHook.ts)
- [docs-check workflow](../../../.github/workflows/docs-check.yml)
- [local checks](../../../src/backend/platform/validation/localChecks.ts)
- [open-source readiness checker](../../../src/backend/platform/validation/openSourceReadiness.ts)
- [workflow policy CLI](../../../src/backend/platform/workflow-policy/cli.ts)
