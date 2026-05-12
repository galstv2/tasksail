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
from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter

from .conftest import make_entry

CANONICAL_STORE = Path("AgentWorkSpace/qmd/global/reinforcement/store")
CANONICAL_SIDECARS = Path("AgentWorkSpace/qmd/global/reinforcement/agent-rewards")
LEGACY_STORE = Path("AgentWorkSpace/qmd/reinforcement")
LEGACY_SIDECARS = Path("AgentWorkSpace/qmd/global/agent-rewards")


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

    def test_writes_use_canonical_store_only(self, tmp_path: Path) -> None:
        store = ReinforcementStore(tmp_path)
        store.append_task_entry(make_entry("T-CANONICAL"))

        assert (tmp_path / CANONICAL_STORE / "task-ledger.json").is_file()
        assert not (tmp_path / LEGACY_STORE / "task-ledger.json").exists()

    def test_migrates_legacy_store_when_canonical_absent(self, tmp_path: Path) -> None:
        legacy_file = tmp_path / LEGACY_STORE / "task-ledger.json"
        legacy_file.parent.mkdir(parents=True, exist_ok=True)
        legacy_file.write_text(
            '{"schema_version": "1.0", "entries": ['
            '{"task_id": "T-LEGACY", "parent_task_id": "", "is_child": false,'
            '"difficulty": "medium", "base_reward": 2000,'
            '"effective_reward": 2000, "settlement_status": "unrewarded",'
            '"quality_outcome": "success", "feedback_id": "",'
            '"settlement_id": "", "realignment_id": "",'
            '"created_at": "2026-01-01T00:00:00Z"}]}',
            encoding="utf-8",
        )

        store = ReinforcementStore(tmp_path)

        assert (tmp_path / CANONICAL_STORE / "task-ledger.json").is_file()
        assert store.load_task_ledger()[0].task_id == "T-LEGACY"
        assert legacy_file.is_file()

    def test_does_not_overwrite_existing_canonical_store(
        self, tmp_path: Path,
    ) -> None:
        canonical_file = tmp_path / CANONICAL_STORE / "task-ledger.json"
        legacy_file = tmp_path / LEGACY_STORE / "task-ledger.json"
        canonical_file.parent.mkdir(parents=True, exist_ok=True)
        legacy_file.parent.mkdir(parents=True, exist_ok=True)
        canonical_file.write_text(
            '{"schema_version": "1.0", "entries": []}',
            encoding="utf-8",
        )
        legacy_file.write_text(
            '{"schema_version": "1.0", "entries": ['
            '{"task_id": "T-LEGACY"}]}',
            encoding="utf-8",
        )

        store = ReinforcementStore(tmp_path)

        assert store.load_task_ledger() == []

    def test_agent_sidecar_writer_uses_canonical_dir_only(
        self, tmp_path: Path,
    ) -> None:
        writer = QmdRewardWriter(tmp_path)
        md_path = writer.write_agent_reward(AgentRewardMemory(
            agent_id="software-engineer", role="Software Engineer",
            multiplier=1.5, lifetime_reward=0,
            unrewarded_task_count=0, unrewarded_reward_total=0,
        ))

        assert md_path == tmp_path / CANONICAL_SIDECARS / "software-engineer.md"
        assert (tmp_path / CANONICAL_SIDECARS / "software-engineer.json").is_file()
        assert not (tmp_path / LEGACY_SIDECARS).exists()

    def test_migrates_legacy_agent_sidecars_when_canonical_absent(
        self, tmp_path: Path,
    ) -> None:
        legacy_json = tmp_path / LEGACY_SIDECARS / "software-engineer.json"
        legacy_md = tmp_path / LEGACY_SIDECARS / "software-engineer.md"
        legacy_json.parent.mkdir(parents=True, exist_ok=True)
        legacy_json.write_text('{"agent_id": "software-engineer"}', encoding="utf-8")
        legacy_md.write_text("# Legacy", encoding="utf-8")

        QmdRewardWriter(tmp_path)

        assert (tmp_path / CANONICAL_SIDECARS / "software-engineer.json").is_file()
        assert (tmp_path / CANONICAL_SIDECARS / "software-engineer.md").is_file()
        assert legacy_json.is_file()

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

    def test_error_status_round_trips(self, store: ReinforcementStore) -> None:
        session = RealignmentSession(
            realignment_id="RA-ERROR", trigger_task_id="T-1",
            trigger_feedback_id="FB-1",
            participating_agents=["software-engineer"],
            failure_analysis="", root_cause="", corrective_actions=[],
            status="error", meeting_notes="failed analysis",
            created_at="2026-01-01T00:00:00Z",
        )
        store.save_realignment_session(session)
        loaded = store.load_realignment_sessions()
        assert len(loaded) == 1
        assert loaded[0].status == "error"
        assert loaded[0].meeting_notes == "failed analysis"
