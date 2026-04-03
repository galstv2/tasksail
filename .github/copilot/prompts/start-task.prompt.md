Begin the workflow from the active task artifacts already present in the repository.

Use the repository instruction files as the source of truth.

Authoritative inputs:
- the active queued task in `AgentWorkSpace/pendingitems/` when present
- `AgentWorkSpace/handoffs/professional-task.md`
- the current repository state

Your job is to start the task at the correct role, fill the authoritative implementation slices first, and leave the workflow ready for Dalton or Ron as appropriate.

Do not invent workflow state. Let the role instructions define the exact write order and completion gate.

For the Product Manager role, treat the queued intake as raw source material for the slice plan. The authoritative handoff is the `AgentWorkSpace/ImplementationSteps/slice-N.md` set plus, when fleet Dalton execution is approved, `AgentWorkSpace/handoffs/parallel-ok.md`.

The handoff markdown files are already seeded. Update those seeded files in place; do not delete and recreate them. Use repo-local file editing, not shell redirection, for workflow artifact authoring.
Always create the needed `slice-N.md` placeholder file set first, even if there is only one slice, then go back and populate each slice. Do not leave the slice set partially created.
Scale slice verbosity to the task: keep simple slices lean, but increase detail for complex work where downstream guidance materially reduces ambiguity or risk.

Before you exit, verify that the final planned slice is runtime-ready and that `parallel-ok.md` explicitly records `Simple` or `Complex` accurately. Once that is true, stop immediately. Do not keep polishing optional upstream handoff docs.
