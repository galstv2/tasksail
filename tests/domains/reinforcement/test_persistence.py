"""Tests for ReinforcementStore persistence layer."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.reinforcement.models import (
    AgentRewardMemory,
    FeedbackEvent,
    GlobalRealignmentDocument,
    RealignmentSession,
    SettlementRecord,
)
from src.backend.mcp.reinforcement.persistence import ReinforcementStore

from .conftest import make_entry


@pytest.fixture()
def store(tmp_path: Path) -> ReinforcementStore:
    return ReinforcementStore(tmp_path)  # tmp_path acts as repo_root


class TestPersistence:
    def test_round_trip_serialization(self, store: ReinforcementStore) -> None:
        """Write each record type, read back, verify fields match."""
        cases = {
            "task_ledger": {
                "write": lambda: store.append_task_entry(make_entry()),
                "read": lambda: store.load_task_ledger(),
                "check": lambda loaded: (
                    len(loaded) == 1
                    and loaded[0].task_id == "T-1"
                    and loaded[0].effective_reward == 2000
                ),
            },
            "agent_reward": {
                "write": lambda: store.update_agent_reward(AgentRewardMemory(
                    agent_id="software-engineer", role="Software Engineer", multiplier=1.5,
                    lifetime_reward=0, unrewarded_task_count=0,
                    unrewarded_reward_total=0,
                )),
                "read": lambda: store.load_agent_rewards(),
                "check": lambda loaded: (
                    len(loaded) == 1 and loaded[0].agent_id == "software-engineer"
                ),
            },
            "settlement": {
                "write": lambda: store.append_settlement(SettlementRecord(
                    settlement_id="S-1", trigger="streak",
                    tasks_included=["T-1", "T-2"],
                    per_agent_rewards={"software-engineer": 2500},
                    settled_at="2026-01-01T00:00:00Z",
                )),
                "read": lambda: store.load_settlements(),
                "check": lambda loaded: (
                    len(loaded) == 1
                    and loaded[0].tasks_included == ["T-1", "T-2"]
                ),
            },
            "feedback_event": {
                "write": lambda: store.append_feedback_event(FeedbackEvent(
                    feedback_id="FB-1", task_id="T-1",
                    feedback_type="positive", star_rating=5,
                    comment="great", created_at="2026-01-01T00:00:00Z",
                )),
                "read": lambda: store.load_feedback_events(),
                "check": lambda loaded: (
                    len(loaded) == 1 and loaded[0].star_rating == 5
                ),
            },
            "realignment_session": {
                "write": lambda: store.save_realignment_session(
                    RealignmentSession(
                        realignment_id="RA-1", trigger_task_id="T-1",
                        trigger_feedback_id="FB-1",
                        participating_agents=["software-engineer", "qa"],
                        failure_analysis="", root_cause="",
                        corrective_actions=[], status="open",
                        meeting_notes="",
                        created_at="2026-01-01T00:00:00Z",
                    )
                ),
                "read": lambda: store.load_realignment_sessions(),
                "check": lambda loaded: (
                    len(loaded) == 1
                    and loaded[0].participating_agents == ["software-engineer", "qa"]
                ),
            },
            "global_realignment_document": {
                "write": lambda: store.save_global_realignment_document(
                    GlobalRealignmentDocument(
                        standing_expectations=["be precise"],
                        version=1,
                        updated_at="2026-01-01T00:00:00Z",
                    )
                ),
                "read": lambda: store.load_global_realignment_document(),
                "check": lambda loaded: (
                    loaded.standing_expectations == ["be precise"]
                    and loaded.version == 1
                ),
            },
        }
        for label, ops in cases.items():
            # Each case uses the same store, but types are independent files
            ops["write"]()
            loaded = ops["read"]()
            assert ops["check"](loaded), f"Round-trip failed for {label}"

    def test_missing_file_returns_empty(self, store: ReinforcementStore) -> None:
        """All collection-returning loaders return empty on missing file."""
        cases = {
            "task_ledger": store.load_task_ledger,
            "agent_rewards": store.load_agent_rewards,
            "settlements": store.load_settlements,
            "feedback_events": store.load_feedback_events,
            "realignment_sessions": store.load_realignment_sessions,
            "global_realignment_document": store.load_global_realignment_document,
        }
        for label, loader in cases.items():
            result = loader()
            if label == "global_realignment_document":
                assert result.version == 0, (
                    f"Expected default doc for {label}"
                )
            else:
                assert result == [], f"Expected empty list for {label}"

    def test_mark_tasks_rewarded_selective(
        self, store: ReinforcementStore,
    ) -> None:
        store.append_task_entry(make_entry("T-1"))
        store.append_task_entry(make_entry("T-2"))
        store.append_task_entry(make_entry("T-3"))
        store.mark_tasks_rewarded({"T-1", "T-3"}, "SETTLE-X")
        ledger = store.load_task_ledger()
        statuses = {e.task_id: e.settlement_status for e in ledger}
        assert statuses == {
            "T-1": "rewarded", "T-2": "unrewarded", "T-3": "rewarded",
        }
        assert ledger[0].settlement_id == "SETTLE-X"
        assert ledger[1].settlement_id == ""

    def test_upsert_existing_session(self, store: ReinforcementStore) -> None:
        session = RealignmentSession(
            realignment_id="RA-1", trigger_task_id="T-1",
            trigger_feedback_id="FB-1",
            participating_agents=["software-engineer"],
            failure_analysis="", root_cause="", corrective_actions=[],
            status="open", meeting_notes="",
            created_at="2026-01-01T00:00:00Z",
        )
        store.save_realignment_session(session)
        session.status = "reviewed"
        store.save_realignment_session(session)
        loaded = store.load_realignment_sessions()
        assert len(loaded) == 1
        assert loaded[0].status == "reviewed"
