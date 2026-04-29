Your previous run violated the implementation boundary. Do not start over — fix the boundary mistake.

Rules:
- Navigate to the target repo via `COPILOT_TARGET_REPOS_JSON`, `COPILOT_PRIMARY_FOCUS_PATH`, and writable/test roots when present
- `COPILOT_PRIMARY_FOCUS_PATH` is where to start reading; `COPILOT_WRITABLE_ROOTS_JSON` defines where implementation changes may be made
- Remove or repair changes outside `COPILOT_WRITABLE_ROOTS_JSON`
- Treat `COPILOT_READONLY_CONTEXT_ROOTS_JSON` and support roots as read-only reference context
- Then finish the originally assigned work
- Ensure all tests pass before exiting
