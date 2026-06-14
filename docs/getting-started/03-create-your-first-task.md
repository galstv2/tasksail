# Create Your First Task

Start from the desktop app.

## Select A Context Pack

A context pack tells TaskSail which codebase and files the agents may use.

1. Open the context-pack sidebar.
2. Select an existing context pack, or start the guided create flow.
3. Preview the workspace scope.
4. Apply the approved context pack.

The planner stays locked until a context pack is active. This prevents broad agent work without a bounded source context.

## Draft The Task Spec

1. Open the planner.
2. Describe the change or bug in normal language.
3. Review the generated task spec.
4. Finalize it when the scope and expected result look right.

TaskSail publishes the spec into the local queue. The task board shows pending and active work, and the terminal feed shows platform and agent progress.

## Watch The Work

Keep the app open while the agents work. Alice prepares the implementation plan, Dalton performs the code work, and Ron verifies the result. If Ron finds a problem, the task routes back through the implementation loop instead of silently closing.

For command-line smoke checks, these are valid from the repository root:

```bash
pnpm run plan-dropbox-task -- --title "Starter" --summary "Create a small starter task."
pnpm run queue-status
```

Use the desktop flow for normal first-task operation.

Continue with [Troubleshooting](04-troubleshooting.md).
