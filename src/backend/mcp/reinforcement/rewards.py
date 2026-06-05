"""Reward calculation: difficulty mapping, child-task halving, role multipliers."""
from __future__ import annotations

import uuid

from src.backend.scripts.python.lib.time import current_utc_timestamp

from .models import (
    AGENT_REWARD_MULTIPLIERS,
    CHILD_TASK_MULTIPLIER,
    DIFFICULTY_REWARDS,
    SETTLEMENT_STREAK_THRESHOLD,
    SettlementRecord,
    TaskLedgerEntry,
)


class RewardCalculator:
    """Stateless helpers for reward arithmetic."""

    @staticmethod
    def calculate_base_reward(difficulty: str) -> int:
        """Map a difficulty level to its base reward value.

        Raises ``ValueError`` for unknown difficulty.
        """
        reward = DIFFICULTY_REWARDS.get(difficulty)
        if reward is None:
            raise ValueError(
                f"Unknown difficulty '{difficulty}'. "
                f"Expected one of: {', '.join(sorted(DIFFICULTY_REWARDS))}"
            )
        return reward

    @staticmethod
    def calculate_effective_reward(base_reward: int, is_child: bool) -> int:
        """Apply the child-task halving rule."""
        if is_child:
            return int(base_reward * CHILD_TASK_MULTIPLIER)
        return base_reward

    @staticmethod
    def calculate_agent_settlement_reward(
        effective_sum: int,
        agent_id: str,
    ) -> int:
        """Apply role multiplier to an effective reward sum.

        Returns 0 for unknown agent IDs.
        """
        multiplier = AGENT_REWARD_MULTIPLIERS.get(agent_id, 0.0)
        return round(effective_sum * multiplier)

    @staticmethod
    def settle_tasks(
        unrewarded_entries: list[TaskLedgerEntry],
        agent_ids: list[str],
        trigger: str = "streak",
    ) -> SettlementRecord:
        """Build a settlement from up to 10 most recent unrewarded entries."""
        capped = unrewarded_entries[-SETTLEMENT_STREAK_THRESHOLD:]
        effective_sum = sum(e.effective_reward for e in capped)
        per_agent: dict[str, int] = {}
        for aid in agent_ids:
            per_agent[aid] = RewardCalculator.calculate_agent_settlement_reward(
                effective_sum, aid,
            )
        return SettlementRecord(
            settlement_id=f"SETTLE-{uuid.uuid4().hex[:12]}",
            trigger=trigger,
            tasks_included=[e.task_id for e in capped],
            per_agent_rewards=per_agent,
            settled_at=current_utc_timestamp(),
        )
