Close the task only from the repository's completed workflow artifacts.

Use the repository instruction files as the source of truth.

Authoritative inputs:
- `$COPILOT_HANDOFFS_DIR/issues.md`
- `$COPILOT_HANDOFFS_DIR/final-summary.md`
- `$COPILOT_HANDOFFS_DIR/retrospective-input.md`

Verify that the workflow is in a closeout-ready state, then perform only the QA and closeout work required for task completion.

Do not close the task with unresolved blocking findings. Do not run archival or cleanup scripts manually.
