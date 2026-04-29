Begin the workflow from the active task artifacts already present in the repository.

Use the repository instruction files as the source of truth.

Authoritative inputs:
- `$COPILOT_HANDOFFS_DIR/intake.md` when present (canonical operator intake for this task)
- `$COPILOT_HANDOFFS_DIR/professional-task.md`
- the current repository state

Your job is to start the task at the correct role and leave the workflow ready for Dalton or Ron as appropriate. For the Product Manager role, complete `$COPILOT_HANDOFFS_DIR/implementation-spec.md` first, then create the full `slice-N.md` placeholder set as verbatim copies of `AgentWorkSpace/templates/slice-template.md`, then populate each slice from the completed implementation spec.

Do not invent workflow state. Let the role instructions define the exact write order and completion gate.

For the Product Manager role, treat the queued intake as raw source material for the slice plan. The authoritative Dalton handoff is the `$COPILOT_IMPL_STEPS_DIR/slice-N.md` set plus, when fleet Dalton execution is approved, `$COPILOT_HANDOFFS_DIR/parallel-ok.md`, but `$COPILOT_HANDOFFS_DIR/implementation-spec.md` must be completed before the slice set is created and handed off.

The handoff markdown files are already seeded. Update those seeded files in place; do not delete and recreate them. Use repo-local file editing, not shell redirection, for workflow artifact authoring.
For the Product Manager role, after the implementation spec is complete, always create the full needed `slice-N.md` placeholder file set next, even if there is only one slice, as verbatim copies of `AgentWorkSpace/templates/slice-template.md`, then go back and populate each slice from the completed implementation spec. Do not leave the slice set partially created.
Scale slice verbosity to the task: keep simple slices lean, but increase detail for complex work where downstream guidance materially reduces ambiguity or risk.

Before you exit, verify that the implementation spec is complete, the final planned slice is runtime-ready, and `parallel-ok.md` explicitly records `Simple` or `Complex` accurately. Once that is true, stop immediately. Do not keep polishing only-optional upstream handoff docs.
