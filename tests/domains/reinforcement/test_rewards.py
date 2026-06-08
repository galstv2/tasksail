"""Tests for RewardCalculator."""
from __future__ import annotations

import pytest

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.rewards import RewardCalculator

from .conftest import make_entry


class TestRewardCalculator:
    def test_base_reward_by_difficulty(self) -> None:
        cases = [
            ("easy", 1000),
            ("medium", 2000),
            ("hard", 3000),
        ]
        for difficulty, expected in cases:
            result = RewardCalculator.calculate_base_reward(difficulty)
            assert result == expected, (
                f"Expected {expected} for {difficulty}, got {result}"
            )
        with pytest.raises(ValueError, match="Unknown difficulty"):
            RewardCalculator.calculate_base_reward("extreme")

    def test_effective_reward(self) -> None:
        cases = [
            ("standard", 2000, False, 2000),
            ("child_halved", 2000, True, 1000),
            ("child_odd_base", 3000, True, 1500),
        ]
        for label, base, is_child, expected in cases:
            result = RewardCalculator.calculate_effective_reward(base, is_child)
            assert result == expected, (
                f"Expected {expected} for {label}, got {result}"
            )

    def test_settle_tasks(self) -> None:
        # Cap at 10 tasks
        entries = [make_entry(f"T-{i}") for i in range(15)]
        settlement = RewardCalculator.settle_tasks(
            entries, ["software-engineer"], trigger="streak",
        )
        assert len(settlement.tasks_included) == 10
        assert settlement.tasks_included[0] == "T-5"

        # Includes all agents
        entries = [make_entry("T-1")]
        settlement = RewardCalculator.settle_tasks(
            entries, ["software-engineer", "qa"], trigger="five_star",
        )
        assert "software-engineer" in settlement.per_agent_rewards
        assert "qa" in settlement.per_agent_rewards
        assert settlement.trigger == "five_star"
