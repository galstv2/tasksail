# CLI Provider Abstraction

TaskSail launches agent work through a CLI-provider abstraction. The abstraction owns provider identity, registry id mapping, command construction, model/reasoning support, MCP config rendering, planner transport, and provider-specific environment behavior.

GitHub Copilot is the provider shipped in this repository today. Docs should say that plainly without turning provider-specific details into universal platform rules.

## Resolution

The active provider resolves from platform config or a temporary environment override and must match a registered provider. Agent ids are normalized through provider-aware metadata before launch.

## Launch Contract

The platform-owned wrapper remains the compliant entrypoint for agent launches. Raw provider CLI invocation is an internal implementation detail controlled by the provider adapter and agent runner.

## Sources of truth

- [provider types](../../../src/backend/platform/cli-provider/types.ts)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
- [Copilot provider](../../../src/backend/platform/cli-provider/providers/copilot/copilotProvider.ts)
- [agent runner CLI](../../../src/backend/platform/agent-runner/cli.ts)
