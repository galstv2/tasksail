# Agent Roster And Autonomy

The agent roster is registry-owned. The current registry defines the shipped workflow agents and their human-facing names, registry ids, instruction files, profile files, autonomy profiles, timeout limits, allowed directories, and deny rules.

Provider-neutral workflow roles are planning, product management, software engineering, and QA. The current Copilot registry also includes a verification engineer entry. Treat that as a current provider registry entry, not as a universal provider-neutral role.

## Autonomy Boundaries

Autonomy profiles determine the broad class of operations an agent may attempt. Additional deny rules, allowed-directory constraints, task-scoped context, and workflow-policy checks narrow what is legal at runtime. Broad autonomous execution fails closed when there is no active authorized context pack for the work.

Model choice is source-owned by the agent registry and model catalog. Documentation should link those files instead of repeating model ids as static facts.

## Provider Boundary

GitHub Copilot is the shipped CLI provider in this repository today. The platform still resolves provider behavior through a provider abstraction so agent launch, model selection, MCP config rendering, and planner transport can stay provider-aware.

## Sources of truth

- [agent registry](../../../.github/agents/registry.json)
- [workflow role contract](../../../src/backend/platform/cli-provider/workflowContract.ts)
- [autonomy rules](../../../src/backend/platform/agent-runner/autonomy.ts)
- [provider registry](../../../src/backend/platform/cli-provider/registry.ts)
