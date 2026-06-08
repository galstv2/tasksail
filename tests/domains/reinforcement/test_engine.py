"""Tests for ReinforcementEngine."""
from __future__ import annotations

from pathlib import Path

import pytest

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.engine import ReinforcementEngine
from src.backend.mcp.reinforcement.models import AgentRewardMemory
from src.backend.mcp.reinforcement.persistence import ReinforcementStore


@pytest.fixture()
def engine(tmp_path: Path) -> ReinforcementEngine:
    return ReinforcementEngine(ReinforcementStore(tmp_path))


class TestRecordTaskCompletion:
    def test_basic_recording(self, engine: ReinforcementEngine) -> None:
        result = engine.record_task_completion("T-1", "medium")
        assert result["status"] == "recorded"
        assert result["entry"]["effective_reward"] == 2000

    def test_child_task_half_reward(self, engine: ReinforcementEngine) -> None:
        result = engine.record_task_completion(
            "T-1", "hard", parent_task_id="T-0",
        )
        assert result["entry"]["is_child"] is True
        assert result["entry"]["effective_reward"] == 1500

    def test_duplicate_rejected(self, engine: ReinforcementEngine) -> None:
        engine.record_task_completion("T-1", "easy")
        result = engine.record_task_completion("T-1", "easy")
        assert result["status"] == "duplicate"

    def test_invalid_difficulty(self, engine: ReinforcementEngine) -> None:
        result = engine.record_task_completion("T-1", "extreme")
        assert result["status"] == "validation_error"


class TestAutoSettlement:
    def test_10_task_trigger(self, engine: ReinforcementEngine) -> None:
        for i in range(9):
            result = engine.record_task_completion(f"T-{i}", "easy")
            assert "settlement" not in result
        result = engine.record_task_completion("T-9", "easy")
        assert "settlement" in result
        settlement = result["settlement"]
        assert len(settlement["tasks_included"]) == 10
        assert settlement["trigger"] == "streak"

    def test_rewarded_tasks_excluded(self, engine: ReinforcementEngine) -> None:
        """After a settlement, rewarded tasks are not included in the next one."""
        for i in range(10):
            engine.record_task_completion(f"T-{i}", "easy")
        # First 10 are now rewarded. Add 10 more.
        for i in range(10, 20):
            engine.record_task_completion(f"T-{i}", "easy")
        unrewarded = engine.get_unrewarded_tasks()
        assert len(unrewarded) == 0  # second settlement happened at T-19

    def test_error_tasks_dont_count(self, engine: ReinforcementEngine) -> None:
        for i in range(9):
            engine.record_task_completion(f"T-{i}", "easy")
        result = engine.record_task_completion(
            "T-9", "easy", quality_outcome="error",
        )
        assert "settlement" not in result
        assert len(engine.get_unrewarded_tasks()) == 9

    def test_settlement_refreshes_existing_role_multiplier(
        self, tmp_path: Path,
    ) -> None:
        store = ReinforcementStore(tmp_path)
        store.update_agent_reward(AgentRewardMemory(
            agent_id="planning-agent",
            role="Planning Specialist",
            multiplier=0.5,
            lifetime_reward=7500,
            unrewarded_task_count=0,
            unrewarded_reward_total=0,
        ))
        engine = ReinforcementEngine(store)

        for i in range(10):
            engine.record_task_completion(f"T-{i}", "easy")

        planning_reward = next(
            r for r in store.load_agent_rewards()
            if r.agent_id == "planning-agent"
        )
        assert planning_reward.multiplier == 1.0
        assert planning_reward.lifetime_reward == 17500


class TestFeedback:
    def test_five_star_triggers_settlement(
        self, engine: ReinforcementEngine,
    ) -> None:
        engine.record_task_completion("T-1", "medium")
        result = engine.record_feedback("T-1", "positive", star_rating=5)
        assert result["status"] == "recorded"
        assert "settlement" in result

    def test_negative_low_rating_recommends_realignment(
        self, engine: ReinforcementEngine,
    ) -> None:
        engine.record_task_completion("T-1", "medium")
        result = engine.record_feedback("T-1", "negative", star_rating=1)
        assert result.get("realignment_recommended") is True

    def test_positive_no_realignment(
        self, engine: ReinforcementEngine,
    ) -> None:
        result = engine.record_feedback("T-1", "positive", star_rating=4)
        assert result.get("realignment_recommended") is not True

    def test_invalid_feedback(self, engine: ReinforcementEngine) -> None:
        result = engine.record_feedback("T-1", "bad")
        assert result["status"] == "validation_error"


class TestReadAccessors:
    def test_get_settlement_history(
        self, engine: ReinforcementEngine,
    ) -> None:
        for i in range(10):
            engine.record_task_completion(f"T-{i}", "easy")
        history = engine.get_settlement_history()
        assert len(history) == 1
