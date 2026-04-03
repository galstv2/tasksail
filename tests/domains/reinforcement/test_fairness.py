"""Tests for FairnessManager."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.reinforcement.fairness import DEFAULT_FAIRNESS_FRAMING, FairnessManager, VersionConflictError
from src.backend.mcp.reinforcement.models import RealignmentSession
from src.backend.mcp.reinforcement.persistence import ReinforcementStore


@pytest.fixture()
def manager(tmp_path: Path) -> FairnessManager:
    return FairnessManager(ReinforcementStore(tmp_path))


class TestLoadGlobalDocument:
    def test_default_has_fairness_framing(
        self, manager: FairnessManager,
    ) -> None:
        doc = manager.load_global_document()
        assert doc.fairness_framing == list(DEFAULT_FAIRNESS_FRAMING)

    def test_version_zero_on_missing(
        self, manager: FairnessManager,
    ) -> None:
        doc = manager.load_global_document()
        assert doc.version == 0


class TestUpdateGlobalDocument:
    def test_increments_version(self, manager: FairnessManager) -> None:
        doc = manager.update_global_document({
            "standing_expectations": ["be precise"],
        })
        assert doc.version == 1
        assert doc.standing_expectations == ["be precise"]

    def test_multiple_updates(self, manager: FairnessManager) -> None:
        manager.update_global_document({"lessons_learned": ["lesson 1"]})
        doc = manager.update_global_document({"lessons_learned": ["lesson 2"]})
        assert doc.version == 2
        assert doc.lessons_learned == ["lesson 2"]

    def test_expected_version_match_succeeds(
        self, manager: FairnessManager,
    ) -> None:
        manager.update_global_document({"standing_expectations": ["v1"]})
        doc = manager.update_global_document({
            "expected_version": 1,
            "standing_expectations": ["v2"],
        })
        assert doc.version == 2
        assert doc.standing_expectations == ["v2"]

    def test_expected_version_mismatch_raises(
        self, manager: FairnessManager,
    ) -> None:
        manager.update_global_document({"standing_expectations": ["v1"]})
        with pytest.raises(VersionConflictError) as exc_info:
            manager.update_global_document({
                "expected_version": 0,
                "standing_expectations": ["stale"],
            })
        assert exc_info.value.expected == 0
        assert exc_info.value.actual == 1

    def test_no_expected_version_skips_check(
        self, manager: FairnessManager,
    ) -> None:
        manager.update_global_document({"standing_expectations": ["v1"]})
        doc = manager.update_global_document({
            "standing_expectations": ["v2"],
        })
        assert doc.version == 2


class TestInjectFairnessFraming:
    def test_returns_default_framing(self, manager: FairnessManager) -> None:
        lines = manager.inject_fairness_framing()
        assert len(lines) == 4
        assert "role function" in lines[-1].lower()


class TestApplyLessonsFromSession:
    def test_promotes_corrective_actions(
        self, manager: FairnessManager,
    ) -> None:
        session = RealignmentSession(
            realignment_id="RA-1", trigger_task_id="T-1",
            trigger_feedback_id="FB-1", participating_agents=["software-engineer"],
            failure_analysis="bug", root_cause="missing validation",
            corrective_actions=["add input validation"],
            status="archived", meeting_notes="",
            created_at="2026-01-01T00:00:00Z",
        )
        doc = manager.apply_lessons_from_session(session)
        assert "add input validation" in doc.lessons_learned
        assert "Avoid: missing validation" in doc.behavioral_guidance
        assert doc.version == 1

    def test_no_duplicate_lessons(self, manager: FairnessManager) -> None:
        session = RealignmentSession(
            realignment_id="RA-1", trigger_task_id="T-1",
            trigger_feedback_id="FB-1", participating_agents=[],
            failure_analysis="", root_cause="bad config",
            corrective_actions=["fix config"],
            status="archived", meeting_notes="",
            created_at="2026-01-01T00:00:00Z",
        )
        manager.apply_lessons_from_session(session)
        doc = manager.apply_lessons_from_session(session)
        assert doc.lessons_learned.count("fix config") == 1
