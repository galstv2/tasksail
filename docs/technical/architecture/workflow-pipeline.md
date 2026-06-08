# Workflow Pipeline

TaskSail turns operator input into queue items, activates eligible work, launches role agents, and closes tasks through workflow-policy checks. The user-facing names are Lily, Alice, Dalton, Dalton Verify, and Ron, but runtime routing is driven by registry ids and workflow order.

## Queue To Pipeline

New work enters through the queue CLI or the desktop planner. Published items move through dropbox, pending, active, and completion states. Parallel task support uses task-specific active markers and activation markers, so closeout must disambiguate the task id when more than one task is active.

The agent pipeline runs from the canonical role-agent entrypoint. The direct package aliases expose a single-agent run and the unattended pipeline. The lower-level parser also supports kill and clear-kill subcommands, but those are direct parser commands rather than package aliases.

## Handoffs And Closeout

Alice prepares professional task and implementation artifacts. Dalton implements the work. Ron verifies the result and either routes issues back to Dalton or allows closeout. Closeout is guarded by workflow-policy rules and task artifacts; runtime code owns the exact artifact names and rule set.

## Failure Handling

The queue has repair surfaces for interrupted publishes, closeout recovery, branch/worktree conflicts, error items, and stuck mid-completion states. Docs should describe these as recovery tools rather than promising that every failure is automatically repaired.

## Sources of truth

- [queue CLI](../../../src/backend/platform/queue/cli.ts)
- [queue operations](../../../src/backend/platform/queue/operations.ts)
- [agent runner CLI](../../../src/backend/platform/agent-runner/cli.ts)
- [workflow policy CLI](../../../src/backend/platform/workflow-policy/cli.ts)
