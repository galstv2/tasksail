# Agent Runner Module

`agent-runner` owns role-agent orchestration. It parses the canonical agent entrypoints, resolves provider-aware agent ids, launches provider subprocesses, records session receipts, prepares runtime paths, injects context overlays, handles pipeline sequencing, and records launch/progress outcomes.

The package aliases expose single-agent run and pipeline execution. The lower-level parser also includes kill-control subcommands for in-flight pipeline management.

## Reliability Boundaries

Ron launch refreshes the code diff before QA so stale diffs do not enter verification. External MCP launch context is merged with internal repo-context MCP config, and local external MCP stays opt-in through platform config and per-launch helper environment.

## Sources of truth

- [agent runner CLI](../../../src/backend/platform/agent-runner/cli.ts)
- [role agent runtime](../../../src/backend/platform/agent-runner/roleAgent.ts)
- [agent session](../../../src/backend/platform/agent-runner/agentSession.ts)
- [pipeline sequencer](../../../src/backend/platform/agent-runner/pipeline/sequencer.ts)
