Your previous run violated the implementation boundary. Do not start over — fix the boundary mistake.

Rules:
- Navigate to the target repo via `COPILOT_TARGET_REPOS_JSON`, `COPILOT_PRIMARY_FOCUS_PATH`, and `COPILOT_TEST_TARGET_PATH` when present
- If `COPILOT_PRIMARY_FOCUS_TARGET_KIND=file`, only that exact file is writable inside the primary boundary
- Keep only changes that belong in the selected primary implementation boundary
- Then finish the originally assigned work
- Ensure all tests pass before exiting
