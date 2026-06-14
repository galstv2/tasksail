# CLI Provider Module

`cli-provider` defines the provider interface and active provider registry. Provider adapters own command construction, model/reasoning capability detection, MCP config rendering, planner transport details, and provider-specific id mapping.

The current repository ships only a GitHub Copilot CLI adapter. The platform should still be described in provider-neutral terms where possible, because role ids, queue state, workflow policy, context packs, task artifacts, and QMD behavior are not Copilot-only concepts.

Provider-specific behavior should stay inside adapter implementations and provider tests. A future provider adapter should satisfy the same module contract instead of spreading provider checks through queue, workflow, QMD, or desktop state.

## Sources of truth

- [provider barrel](../../../src/backend/platform/cli-provider/index.ts)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
- [provider workflow contract](../../../src/backend/platform/cli-provider/workflowContract.ts)
- [Copilot provider implementation](../../../src/backend/platform/cli-provider/providers/copilot/copilotProvider.ts)
