# Support Modules

Some direct platform children are intentionally documented as support modules rather than standalone reader pages.

## Core

`core` provides cross-cutting primitives: repo-root discovery, environment loading, logging, protocol output, Python execution, process handling, file locks, path helpers, worktree materialization/finalization, terminal-event contracts, and text utilities.

## Test-Only Directories

`__tests__` and `test-utils` are covered through contributing docs. They are important for validation but are not runtime modules.

## Sources of truth

- [core index](../../../src/backend/platform/core/index.ts)
- [Python CLI wrapper](../../../src/backend/platform/core/pythonCli.ts)
- [runtime terminal events](../../../src/backend/platform/core/runtimeTerminalEvents.ts)
- [platform test utilities](../../../src/backend/platform/test-utils/platform.ts)
