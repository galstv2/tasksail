# Validation Module

`validation` owns local checks and repository policy gates. It covers TypeScript validation, Python lint routing, file-size checks, comment discipline, test-count floor, logging/protocol-output discipline, changed-domain targeting, pre-commit wiring, local setup checks, and Python version policy checks.

Docs-contract tests should remain in pytest where semantic documentation contracts are easier to express. The Markdown validator remains focused on links, anchors, and trailing whitespace.

## Sources of truth

- [validation CLI](../../../src/backend/platform/validation/cli.ts)
- [local checks](../../../src/backend/platform/validation/localChecks.ts)
- [comment discipline](../../../src/backend/platform/validation/commentDiscipline.ts)
- [Python version policy](../../../src/backend/platform/validation/pythonVersionPolicyCheck.ts)
