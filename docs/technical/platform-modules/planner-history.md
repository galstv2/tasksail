# Planner History Module

`planner-history` stores planner history and session artifacts. It is a support module for the desktop planner and provider transport path, not the owner of queue execution or workflow policy.

Use this module when documenting where planner interaction metadata is persisted and how desktop planner state is separated from task queue lifecycle.

## Sources of truth

- [planner history store](../../../src/backend/platform/planner-history/store.ts)
- [planner history paths](../../../src/backend/platform/planner-history/paths.ts)
- [planner history types](../../../src/backend/platform/planner-history/types.ts)
