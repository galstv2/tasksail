"""Pack-level seed-state schema: model and validator.

The pack seed-state file lives at <qmd_scope_root>/seed-state.json —
the top-level of the scope root, not under any per-repo subdirectory.
It is distinct from the per-repo state file written by
record_factory.state_file_path (which lives under
operational/bootstrap/<repo_id>/seed-state.json).

Both files happen to share the basename ``seed-state.json``; only their
paths, shapes, owners, and lifecycles differ.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

logger = logging.getLogger(__name__)

PACK_SEED_STATE_VALUES = frozenset({"seeded", "bootstrap-empty"})


@dataclass(slots=True)
class PackSeedState:
    """Validated representation of a pack-level seed-state record."""

    state: Literal["seeded", "bootstrap-empty"]
    # Empty-scope fields written by write_empty_scope_tree.
    created_at: str | None = None
    reason: str | None = None
    details: dict[str, Any] | None = None
    # Real-seed fields written by seeding_service.
    last_seed_at: str | None = None
    last_seed_run_id: str | None = None
    last_failure_at: str | None = None
    last_failure_reason: str | None = None
    last_failure_run_id: str | None = None


def validate_pack_seed_state(d: Any) -> PackSeedState:
    """Validate a raw dict loaded from seed-state.json into a PackSeedState.

    - Unknown top-level keys are silently ignored (forward-compat).
    - An unknown or missing ``state`` value defaults to ``"seeded"`` with a
      warning, so a future state value seen by an old client never falsely
      shows the "needs population" badge for a healthy pack.
    """
    if not isinstance(d, dict):
        logger.warning(
            "pack_seed_state: expected a JSON object, got %s — defaulting to seeded",
            type(d).__name__,
        )
        return PackSeedState(state="seeded")

    raw_state = d.get("state")
    if raw_state not in PACK_SEED_STATE_VALUES:
        logger.warning(
            "pack_seed_state: unknown or missing state value %r — defaulting to seeded",
            raw_state,
        )
        state: Literal["seeded", "bootstrap-empty"] = "seeded"
    else:
        state = raw_state  # type: ignore[assignment]

    def _opt_str(key: str) -> str | None:
        v = d.get(key)
        return v if isinstance(v, str) else None

    def _opt_dict(key: str) -> dict[str, Any] | None:
        v = d.get(key)
        return v if isinstance(v, dict) else None

    return PackSeedState(
        state=state,
        created_at=_opt_str("created_at"),
        reason=_opt_str("reason"),
        details=_opt_dict("details"),
        last_seed_at=_opt_str("last_seed_at"),
        last_seed_run_id=_opt_str("last_seed_run_id"),
        last_failure_at=_opt_str("last_failure_at"),
        last_failure_reason=_opt_str("last_failure_reason"),
        last_failure_run_id=_opt_str("last_failure_run_id"),
    )
