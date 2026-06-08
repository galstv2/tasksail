# Queue Module

`queue` owns TaskSail task intake, pending and active state, activation, closeout, repair, task registry, error items, branch/worktree protection, child-task chains, and queue status reporting.

## State Model

The queue supports more than one active task. Active markers, activating markers, kill requests, queue order, task registry entries, and error items are separate state surfaces. Closeout must specify a task id when the active set is ambiguous.

## Recovery

Repair commands handle interrupted publish, inconsistent queue state, stuck closeout, branch conflicts, stale worktree metadata, and error-item cleanup. These commands repair known state shapes; they do not replace normal closeout requirements.

## Sources of truth

- [queue CLI](../../../src/backend/platform/queue/cli.ts)
- [queue operations](../../../src/backend/platform/queue/operations.ts)
- [queue paths](../../../src/backend/platform/queue/paths.ts)
- [complete pending item](../../../src/backend/platform/queue/completePendingItem.ts)
