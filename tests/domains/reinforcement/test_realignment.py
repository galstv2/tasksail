"""Tests for RealignmentManager."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager


@pytest.fixture()
def manager(tmp_path: Path) -> RealignmentManager:
    return RealignmentManager(ReinforcementStore(tmp_path))


class TestStartSession:
    def test_creates_open_session(self, manager: RealignmentManager) -> None:
        session = manager.start_session("T-1", "FB-1", ["software-engineer", "qa"])
        assert session.status == "open"
        assert session.trigger_task_id == "T-1"
        assert "software-engineer" in session.participating_agents

    def test_session_persisted(self, manager: RealignmentManager) -> None:
        manager.start_session("T-1", "FB-1", ["software-engineer"])
        sessions = manager.list_sessions()
        assert len(sessions) == 1


class TestUpdateSession:
    def test_apply_updates(self, manager: RealignmentManager) -> None:
        session = manager.start_session("T-1", "FB-1", ["software-engineer"])
        updated = manager.update_session(session.realignment_id, {
            "failure_analysis": "missed edge case",
            "root_cause": "incomplete spec",
            "corrective_actions": ["add edge case tests"],
            "status": "reviewed",
        })
        assert updated is not None
        assert updated.status == "reviewed"
        assert updated.failure_analysis == "missed edge case"

    def test_not_found(self, manager: RealignmentManager) -> None:
        assert manager.update_session("RA-NONE", {}) is None


class TestArchiveSession:
    def test_archives_and_writes_notes(
        self, manager: RealignmentManager,
    ) -> None:
        session = manager.start_session("T-1", "FB-1", ["software-engineer"])
        manager.update_session(session.realignment_id, {
            "failure_analysis": "bug",
            "root_cause": "missing test",
            "meeting_notes": "discussed at length",
        })
        result = manager.archive_session(session.realignment_id)
        assert result["status"] == "archived"
        notes_path = Path(result["notes_path"])
        assert notes_path.exists()
        content = notes_path.read_text()
        assert "discussed at length" in content

    def test_not_found(self, manager: RealignmentManager) -> None:
        assert manager.archive_session("RA-NONE")["status"] == "not_found"


class TestListSessions:
    def test_filter_by_status(self, manager: RealignmentManager) -> None:
        manager.start_session("T-1", "FB-1", ["software-engineer"])
        s2 = manager.start_session("T-2", "FB-2", ["qa"])
        manager.update_session(s2.realignment_id, {"status": "reviewed"})
        open_sessions = manager.list_sessions(status_filter="open")
        assert len(open_sessions) == 1
        reviewed = manager.list_sessions(status_filter="reviewed")
        assert len(reviewed) == 1
