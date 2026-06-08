# Platform State And Logs

TaskSail stores generated runtime state outside source-owned docs and code. Platform state includes seeded runtime config, MCP registries, runtime launch data, guardrail receipts, task terminal events, provider home directories, local helper files, and logs.

## State Boundaries

Runtime state is local and generated. Do not commit generated state or normalize task terminal event files during documentation or validation work.

Queue and task artifacts under `AgentWorkSpace` are part of local workflow state. Templates are source-owned; active task runtime data is generated.

## Logging

TypeScript and Python logging both support local log directory and log level behavior. Progress and protocol output are validated separately so CLI output remains machine-readable where required.

## Sources of truth

- [runtime terminal events](../../../src/backend/platform/core/runtimeTerminalEvents.ts)
- [logger](../../../src/backend/platform/core/logger.ts)
- [Python logging config](../../../src/backend/scripts/python/lib/logging_config.py)
- [queue paths](../../../src/backend/platform/queue/paths.ts)
