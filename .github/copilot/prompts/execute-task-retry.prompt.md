Your previous run wrote outside the allowed boundary. Re-read your writable boundary contract in your instructions, then re-attempt the slice.

Authoritative reference: `COPILOT_WRITABLE_ROOTS_JSON` defines what you may write; `COPILOT_READONLY_CONTEXT_ROOTS_JSON` defines what you may read. Both are JSON arrays of `{ path, kind, reason }` objects.

Stop when the slice's Acceptance Criteria and Validation Commands pass.
