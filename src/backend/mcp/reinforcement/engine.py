"""Core reinforcement engine: task recording, settlement, feedback."""
from __future__ import annotations

import uuid
from typing import Any

from src.backend.scripts.python.lib.time import current_utc_timestamp

from .feedback import FeedbackInterpreter
from .models import (
    AGENT_REWARD_MULTIPLIERS,
    AGENT_ROLES,
    SETTLEMENT_STREAK_THRESHOLD,
    AgentRewardMemory,
    FeedbackEvent,
    SettlementRecord,
    TaskLedgerEntry,
)
from .persistence import ReinforcementStore
from .qmd_writer import QmdRewardWriter
from .rewards import RewardCalculator
from .validation import (
    validate_feedback,
    validate_no_double_reward,
    validate_task_completion,
)


class ReinforcementEngine:
    """Orchestrates task completion recording, settlements, and feedback."""

    def __init__(
        self,
        store: ReinforcementStore,
        qmd_writer: QmdRewardWriter | None = None,
    ) -> None:
        self._store = store
        self._qmd_writer = qmd_writer

    def record_task_completion(
        self,
        task_id: str,
        difficulty: str,
        parent_task_id: str = "",
        quality_outcome: str = "success",
    ) -> dict[str, Any]:
        """Record a completed task and trigger settlement if eligible.

        Returns a result dict with ``status``, ``entry``, and optionally
        ``settlement``.

        The entire duplicate-check → append → settlement sequence is
        held under a single ledger lock to prevent concurrent callers
        from duplicating entries or double-triggering settlements.
        """
        payload: dict[str, object] = {
            "task_id": task_id,
            "difficulty": difficulty,
            "quality_outcome": quality_outcome,
        }
        errors = validate_task_completion(payload)
        if errors:
            return {"status": "validation_error", "errors": errors}

        with self._store.ledger_lock():
            ledger = self._store.load_task_ledger_held()
            dup_err = validate_no_double_reward(task_id, ledger)
            if dup_err:
                return {"status": "duplicate", "error": dup_err}

            is_child = bool(parent_task_id)
            base_reward = RewardCalculator.calculate_base_reward(difficulty)
            effective_reward = RewardCalculator.calculate_effective_reward(
                base_reward, is_child,
            )

            entry = TaskLedgerEntry(
                task_id=task_id,
                parent_task_id=parent_task_id,
                is_child=is_child,
                difficulty=difficulty,
                base_reward=base_reward,
                effective_reward=effective_reward,
                settlement_status="unrewarded",
                quality_outcome=quality_outcome,
                feedback_id="",
                settlement_id="",
                realignment_id="",
                created_at=current_utc_timestamp(),
            )
            self._store.append_task_entry_held(entry)

            result: dict[str, Any] = {
                "status": "recorded",
                "entry": entry.as_dict(),
            }

            if quality_outcome == "success":
                settlement = self._maybe_trigger_settlement_held()
                if settlement is not None:
                    result["settlement"] = settlement.as_dict()

            return result

    def _maybe_trigger_settlement_held(self) -> SettlementRecord | None:
        """Trigger settlement if threshold reached. Caller holds ledger_lock."""
        unrewarded = self._unrewarded_success_entries_held()
        if len(unrewarded) < SETTLEMENT_STREAK_THRESHOLD:
            return None
        return self._execute_settlement_held(unrewarded, trigger="streak")

    def trigger_settlement(self, trigger: str = "streak") -> dict[str, Any]:
        """Manually trigger a settlement (e.g. from a 5-star rating)."""
        with self._store.ledger_lock():
            unrewarded = self._unrewarded_success_entries_held()
            if not unrewarded:
                return {"status": "no_unrewarded_tasks"}
            settlement = self._execute_settlement_held(unrewarded, trigger=trigger)
            return {"status": "settled", "settlement": settlement.as_dict()}

    def _execute_settlement_held(
        self,
        unrewarded: list[TaskLedgerEntry],
        trigger: str,
    ) -> SettlementRecord:
        """Execute settlement. Caller holds ledger_lock."""
        agent_ids = list(AGENT_REWARD_MULTIPLIERS.keys())
        settlement = RewardCalculator.settle_tasks(unrewarded, agent_ids, trigger)
        task_id_set = set(settlement.tasks_included)
        self._store.mark_tasks_rewarded_held(task_id_set, settlement.settlement_id)
        self._store.append_settlement(settlement)
        self._update_agent_rewards(settlement)
        return settlement

    def _update_agent_rewards(self, settlement: SettlementRecord) -> None:
        """Update per-agent lifetime rewards after a settlement (bulk).

        Also emits per-agent QMD reward memory markdown when a
        :class:`QmdRewardWriter` is available.
        """
        existing = {r.agent_id: r for r in self._store.load_agent_rewards()}
        updated: list[AgentRewardMemory] = []
        for agent_id, reward_amount in settlement.per_agent_rewards.items():
            if agent_id in existing:
                mem = existing[agent_id]
                mem.role = AGENT_ROLES.get(agent_id, agent_id)
                mem.multiplier = AGENT_REWARD_MULTIPLIERS.get(agent_id, 0.0)
                mem.lifetime_reward += reward_amount
            else:
                mem = AgentRewardMemory(
                    agent_id=agent_id,
                    role=AGENT_ROLES.get(agent_id, agent_id),
                    multiplier=AGENT_REWARD_MULTIPLIERS.get(agent_id, 0.0),
                    lifetime_reward=reward_amount,
                    unrewarded_task_count=0,
                    unrewarded_reward_total=0,
                )
            updated.append(mem)
        self._store.bulk_update_agent_rewards(updated)
        if self._qmd_writer is not None:
            self._qmd_writer.write_agent_rewards(updated)

    def _unrewarded_success_entries_held(self) -> list[TaskLedgerEntry]:
        """Return unrewarded success entries. Caller holds ledger_lock."""
        return [
            e for e in self._store.load_task_ledger_held()
            if e.settlement_status == "unrewarded" and e.quality_outcome == "success"
        ]

    def record_feedback(
        self,
        task_id: str,
        feedback_type: str,
        star_rating: int | None = None,
        comment: str = "",
    ) -> dict[str, Any]:
        """Record operator feedback and dispatch downstream triggers."""
        payload: dict[str, object] = {
            "task_id": task_id,
            "feedback_type": feedback_type,
            "star_rating": star_rating,
        }
        errors = validate_feedback(payload)
        if errors:
            return {"status": "validation_error", "errors": errors}

        event = FeedbackEvent(
            feedback_id=f"FB-{uuid.uuid4().hex[:12]}",
            task_id=task_id,
            feedback_type=feedback_type,
            star_rating=star_rating,
            comment=comment,
            created_at=current_utc_timestamp(),
        )
        self._store.append_feedback_event(event)

        interpretation = FeedbackInterpreter.interpret(event)
        result: dict[str, Any] = {
            "status": "recorded",
            "event": event.as_dict(),
        }

        if interpretation["action"] == "settlement_trigger":
            settlement_result = self.trigger_settlement(trigger="five_star")
            if settlement_result.get("settlement"):
                result["settlement"] = settlement_result["settlement"]

        if interpretation["state"] == "corrective":
            result["realignment_recommended"] = True

        return result

    def get_unrewarded_tasks(self) -> list[dict[str, Any]]:
        with self._store.ledger_lock():
            return [e.as_dict() for e in self._unrewarded_success_entries_held()]

    def get_agent_rewards(self) -> list[dict[str, Any]]:
        return [r.as_dict() for r in self._store.load_agent_rewards()]

    def get_settlement_history(self) -> list[dict[str, Any]]:
        return [s.as_dict() for s in self._store.load_settlements()]

    def get_agent_rewards_history(self, agent_id: str) -> dict[str, Any]:
        for mem in self._store.load_agent_rewards():
            if mem.agent_id == agent_id:
                return mem.as_dict()
        return {}
