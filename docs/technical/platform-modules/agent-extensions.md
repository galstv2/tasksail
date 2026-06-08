# Agent Extensions Module

`agent-extensions` manages extension assignment, materialization, metadata, source manifests, stages, locking, and reconciliation for agent launch support. It keeps extension state separate from provider launch code so assignments can be validated and materialized before an agent session needs them.

Use this module when documenting extension lifecycle or launch-time extension availability. Do not document generated extension files as source truth.

## Sources of truth

- [agent extensions index](../../../src/backend/platform/agent-extensions/index.ts)
- [extension materialization](../../../src/backend/platform/agent-extensions/materialize.ts)
- [extension assignment](../../../src/backend/platform/agent-extensions/assignment.ts)
- [extension types](../../../src/backend/platform/agent-extensions/types.ts)
