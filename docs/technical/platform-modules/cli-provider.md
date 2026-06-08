# CLI Provider Module

`cli-provider` defines the provider interface and active provider registry. Provider adapters own command construction, model/reasoning capability detection, MCP config rendering, planner transport details, and provider-specific id mapping.

The current repository ships a Copilot adapter. The platform should still be described in provider-neutral terms where possible, because role ids, queue state, workflow policy, and QMD behavior are not Copilot-only concepts.

## Sources of truth

- [provider barrel](../../../src/backend/platform/cli-provider/index.ts)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
- [provider workflow contract](../../../src/backend/platform/cli-provider/workflowContract.ts)
- [Copilot provider implementation](../../../src/backend/platform/cli-provider/providers/copilot/copilotProvider.ts)
