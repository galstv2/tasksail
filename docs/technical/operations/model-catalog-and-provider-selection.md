# Model Catalog And Provider Selection

Provider and model selection are source-owned. The platform registry owns agent entries, and the model catalog owns available model choices. Docs should not repeat mutable role-specific model ids as product facts.

## Provider Selection

The shipped provider today is GitHub Copilot. Active provider selection resolves through platform config or a temporary provider override and must match a registered provider.

## Model Catalog

The model catalog is a config file consumed by provider-aware UI and platform flows. If the catalog changes, docs should continue to link the source instead of copying the list.

## Sources of truth

- [agent registry](../../../.github/agents/registry.json)
- [model catalog](../../../config/agent-model-catalog.default.json)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
- [desktop agent config contract](../../../src/frontend/desktop/src/shared/desktopContractAgentConfig.ts)
