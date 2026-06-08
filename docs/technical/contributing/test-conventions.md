# Test Conventions

TaskSail uses Vitest for the backend TypeScript platform and desktop TypeScript/React/Electron code, and pytest for Python domain tests. Domain-targeted selection is driven by `tests/test_manifest.json`.

## Docs Contracts

Docs contracts are pytest tests under `tests/domains/docs_contracts`. Manifest-backed targeted execution and direct full-directory execution should cover the same contract set.

## Desktop Tests

The desktop package owns its local test, lint, build, CSS color discipline, and package validation commands. Desktop tests should stay package-local unless a root validation lane deliberately runs them.

## Sources of truth

- [test manifest](../../../tests/test_manifest.json)
- [docs contracts](../../../tests/domains/docs_contracts/test_docs_operating_model.py)
- [root package scripts](../../../package.json)
- [desktop package scripts](../../../src/frontend/desktop/package.json)
