"""Shared fixtures and helpers for reinforcement tests."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.backend.mcp.reinforcement.models import TaskLedgerEntry

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def make_entry(
    task_id: str = "T-1",
    difficulty: str = "medium",
    effective_reward: int = 2000,
    base_reward: int = 2000,
    settlement_status: str = "unrewarded",
    quality_outcome: str = "success",
) -> TaskLedgerEntry:
    """Factory for ``TaskLedgerEntry`` with sensible defaults."""
    from src.backend.mcp.reinforcement.models import TaskLedgerEntry

    return TaskLedgerEntry(
        task_id=task_id,
        parent_task_id="",
        is_child=False,
        difficulty=difficulty,
        base_reward=base_reward,
        effective_reward=effective_reward,
        settlement_status=settlement_status,
        quality_outcome=quality_outcome,
        feedback_id="",
        settlement_id="",
        realignment_id="",
        created_at="2026-01-01T00:00:00Z",
    )
