# Task Notifications Module

`task-notifications` stores and produces task notification records for the platform and desktop shell. It is a small support module used to surface task-level events without making the desktop shell own queue lifecycle.

## Sources of truth

- [notification producer](../../../src/backend/platform/task-notifications/producer.ts)
- [notification store](../../../src/backend/platform/task-notifications/store.ts)
- [notification types](../../../src/backend/platform/task-notifications/types.ts)
