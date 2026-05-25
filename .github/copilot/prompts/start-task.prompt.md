Inputs for this run are at the paths provided in your launch context (intake, target handoffs directory, target ImplementationSteps directory).

Before authoring artifacts, read `.github/copilot/instructions/product-manager.instructions.md` and follow it. That file is your full operational contract; this prompt repeats the non-negotiable gates for this launch.

This launch is non-interactive. You will not receive follow-up input, clarification, confirmation, or permission during this run.

Before inspecting source code, resolve task source roots from `TASKSAIL_TASK_WORKTREES_FILE` or `TASKSAIL_TASK_WORKTREES`. Use only each entry's `worktreeRoot` as source code. Never inspect `contextpacks/...` paths as source code; those paths are metadata/reference context only.

Update seeded files in place; do not invent workflow state. Complete `implementation-spec.md` first, create every `slice-N.md` as a copy of `AgentWorkSpace/templates/slice-template.md`, preserve every seeded `##` and `###` heading, populate content only under seeded headings, then write `parallel-ok.md` last.

Do not exit with a prose-only status such as "I will complete this next." After source inspection, immediately begin the artifact sequence by writing `implementation-spec.md`; then continue to create and populate every planned `slice-N.md`, and write `parallel-ok.md` last. Do not report that you will write artifacts next. Stop only after the implementation spec is complete, every planned slice is runtime-ready, and `parallel-ok.md` records `Decision: Simple` or `Decision: Complex`.
