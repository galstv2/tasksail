# Validation And Exit Codes

TaskSail validation is split between local TypeScript gates, Python gates, docs contracts, package-specific desktop checks, and CI workflow lanes.

## Local Gates

Useful local commands:

```bash
pnpm run validate
pnpm run local-checks
pnpm run test:contracts
pnpm run check-sizes
pnpm run check-comments
pnpm run check-test-floor
pnpm run check-open-source-readiness
```

Docs validation uses the Python wrapper for local execution:

```bash
pnpm exec tsx src/backend/platform/core/pythonCli.ts src/backend/scripts/python/validate-docs.py
pnpm exec tsx src/backend/platform/core/pythonCli.ts -m pytest tests/domains/docs_contracts -q
```

## Exit-Code Notes

The queue activation path and repo-context seed path use nonzero exit codes for expected non-success states such as waiting for readiness, validation failure, or reseed conflict. Always check the source-owned parser or service before documenting a command's exit behavior.

`pnpm run check-open-source-readiness` is the release-readiness gate for public MIT source-release metadata, tracked inventory, private path scanning, bundled asset provenance, and desktop package legal files.

## Sources of truth

- [validation CLI](../../../src/backend/platform/validation/cli.ts)
- [local checks](../../../src/backend/platform/validation/localChecks.ts)
- [docs validator](../../../src/backend/scripts/python/validate-docs.py)
- [repo-context CLI](../../../src/backend/mcp/repo_context_mcp/transport/cli.py)
