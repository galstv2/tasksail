# CLI Provider Abstraction

TaskSail launches agent work through a CLI-provider abstraction. The abstraction owns provider identity, registry id mapping, command construction, model/reasoning support, MCP config rendering, planner transport, and provider-specific environment behavior.

GitHub Copilot CLI is the only provider shipped in this repository today. TaskSail was built to keep CLI-specific behavior compartmentalized so the platform can remain provider-aware rather than Copilot-shaped.

Copilot-specific logic belongs in the Copilot provider adapter and its tests. Queue state, workflow policy, context packs, QMD, task artifacts, and desktop contracts should stay provider-neutral unless they are explicitly modeling provider selection.

## Resolution

The active provider resolves from platform config or a temporary environment override and must match a registered provider. Agent ids are normalized through provider-aware metadata before launch.

## Launch Contract

The platform-owned wrapper remains the compliant entrypoint for agent launches. Raw provider CLI invocation is an internal implementation detail controlled by the provider adapter and agent runner.

Adding another provider should mean implementing the provider contract, registry metadata, command construction, model capability handling, MCP config rendering, and planner transport for that provider. It should not require rewriting the queue, QMD, or workflow-policy layers.

## Sources of truth

- [provider types](../../../src/backend/platform/cli-provider/types.ts)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
- [Copilot provider](../../../src/backend/platform/cli-provider/providers/copilot/copilotProvider.ts)
- [agent runner CLI](../../../src/backend/platform/agent-runner/cli.ts)
