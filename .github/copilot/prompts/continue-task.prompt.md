Continue the current task from the active workflow artifacts in the repository.

Use the repository instruction files as the source of truth.

Authoritative inputs:
- `$COPILOT_HANDOFFS_DIR/` (absolute path to handoff artifacts)
- `$COPILOT_IMPL_STEPS_DIR/` (absolute path to implementation slices)
- the active repository state

Determine the next valid role from the current artifacts, perform only that role's work, and update only the artifacts that role owns.

Do not invent missing state. Do not skip workflow boundaries. Let the role instructions define what must be written before handoff.

Before you exit, verify that your role-owned artifacts are complete enough for the next workflow role to proceed. Do not leave placeholder-only handoffs. For implementation work, this includes finishing the testing and validation handoff artifacts you own before handing off to QA. Alice's slice defines the required validation evidence. For QA work, use code-changes.diff, orchestrator test results, and your own validation commands to verify the delivered code.
