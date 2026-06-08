"""Tests that file-task-archive.py reinforcement integration records entries."""
from __future__ import annotations

from pathlib import Path

import pytest

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.engine import ReinforcementEngine
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter


@pytest.fixture()
def store(tmp_path: Path) -> ReinforcementStore:
    return ReinforcementStore(tmp_path)  # tmp_path acts as repo_root


class TestArchiveIntegration:
    """Validates the reinforcement recording logic that file-task-archive.py
    invokes after a successful archival."""

    def test_record_after_archive(self, store: ReinforcementStore) -> None:
        """Simulate the inline reinforcement call from file-task-archive.py."""
        engine = ReinforcementEngine(store)
        result = engine.record_task_completion(
            task_id="TASK-ARCHIVE-1",
            difficulty="medium",
            parent_task_id="",
            quality_outcome="success",
        )
        assert result["status"] == "recorded"
        ledger = store.load_task_ledger()
        assert len(ledger) == 1
        assert ledger[0].task_id == "TASK-ARCHIVE-1"
        assert ledger[0].effective_reward == 2000

    def test_validation_error_returns_non_recorded_status(
        self, tmp_path: Path,
    ) -> None:
        """Engine returns validation_error for invalid input without raising.
        The archive script must check the returned status and treat
        non-recorded results as failures."""
        store = ReinforcementStore(tmp_path)
        engine = ReinforcementEngine(store)
        result = engine.record_task_completion(
            task_id="T-1",
            difficulty="invalid_difficulty",
        )
        assert result["status"] == "validation_error"

    def test_reinforcement_state_persisted(
        self, store: ReinforcementStore,
    ) -> None:
        """Verify that state survives across engine instances (file-based)."""
        engine1 = ReinforcementEngine(store)
        engine1.record_task_completion("T-1", "easy")
        engine2 = ReinforcementEngine(store)
        engine2.record_task_completion("T-2", "medium")
        ledger = store.load_task_ledger()
        assert len(ledger) == 2
        task_ids = {e.task_id for e in ledger}
        assert task_ids == {"T-1", "T-2"}


class TestLegacyMigration:
    """Tests that legacy QMD data migrates to canonical QMD root."""

    def test_migrate_from_legacy_path(self, tmp_path: Path) -> None:
        """When canonical root is empty but legacy QMD exists, data migrates."""
        repo_root = tmp_path / "repo"
        legacy_reinf = repo_root / "AgentWorkSpace" / "qmd" / "reinforcement"
        legacy_reinf.mkdir(parents=True)

        from src.backend.scripts.python.lib.io import atomic_write_json
        atomic_write_json(
            legacy_reinf / "task-ledger.json",
            {"schema_version": "1.0", "entries": [
                {"task_id": "LEGACY-1", "parent_task_id": "",
                 "is_child": False, "difficulty": "easy",
                 "base_reward": 1000, "effective_reward": 1000,
                 "settlement_status": "unrewarded",
                 "quality_outcome": "success", "feedback_id": "",
                 "settlement_id": "", "realignment_id": "",
                 "created_at": "2026-01-01T00:00:00Z"},
            ]},
        )

        store = ReinforcementStore(repo_root)
        ledger = store.load_task_ledger()
        assert len(ledger) == 1
        assert ledger[0].task_id == "LEGACY-1"
        assert (
            repo_root / "AgentWorkSpace" / "qmd" / "global"
            / "reinforcement" / "store" / "task-ledger.json"
        ).is_file()

    def test_no_migration_when_qmd_exists(self, tmp_path: Path) -> None:
        """If canonical QMD root already has data, legacy is ignored."""
        repo_root = tmp_path / "repo"
        canonical_reinf = (
            repo_root / "AgentWorkSpace" / "qmd" / "global"
            / "reinforcement" / "store"
        )
        canonical_reinf.mkdir(parents=True)

        from src.backend.scripts.python.lib.io import atomic_write_json
        atomic_write_json(
            canonical_reinf / "task-ledger.json",
            {"schema_version": "1.0", "entries": [
                {"task_id": "QMD-1", "parent_task_id": "",
                 "is_child": False, "difficulty": "medium",
                 "base_reward": 2000, "effective_reward": 2000,
                 "settlement_status": "unrewarded",
                 "quality_outcome": "success", "feedback_id": "",
                 "settlement_id": "", "realignment_id": "",
                 "created_at": "2026-01-01T00:00:00Z"},
            ]},
        )

        legacy_reinf = repo_root / "AgentWorkSpace" / "qmd" / "reinforcement"
        legacy_reinf.mkdir(parents=True)
        atomic_write_json(
            legacy_reinf / "task-ledger.json",
            {"schema_version": "1.0", "entries": [
                {"task_id": "LEGACY-IGNORED", "parent_task_id": "",
                 "is_child": False, "difficulty": "easy",
                 "base_reward": 1000, "effective_reward": 1000,
                 "settlement_status": "unrewarded",
                 "quality_outcome": "success", "feedback_id": "",
                 "settlement_id": "", "realignment_id": "",
                 "created_at": "2026-01-01T00:00:00Z"},
            ]},
        )

        store = ReinforcementStore(repo_root)
        ledger = store.load_task_ledger()
        assert len(ledger) == 1
        assert ledger[0].task_id == "QMD-1"


class TestQmdRewardWriter:
    """Tests for per-agent reward markdown emission."""

    def test_write_agent_reward_md(self, tmp_path: Path) -> None:
        """Per-agent .md and JSON sidecar emitted to canonical agent-rewards."""
        from src.backend.mcp.reinforcement.models import AgentRewardMemory
        writer = QmdRewardWriter(tmp_path)
        reward = AgentRewardMemory(
            agent_id="software-engineer",
            role="Software Engineer",
            multiplier=1.50,
            lifetime_reward=5000,
            unrewarded_task_count=0,
            unrewarded_reward_total=0,
        )
        md_path = writer.write_agent_reward(reward)
        assert md_path.exists()
        content = md_path.read_text()
        assert "software-engineer" in content
        assert "5,000" in content
        assert md_path.name == "software-engineer.md"
        assert (
            "AgentWorkSpace/qmd/global/reinforcement/agent-rewards"
            in str(md_path.parent)
        )

        # JSON sidecar contains full structured data for launch-time reading.
        import json
        json_path = md_path.with_suffix(".json")
        assert json_path.exists()
        data = json.loads(json_path.read_text())
        assert data["agent_id"] == "software-engineer"
        assert data["lifetime_reward"] == 5000
        assert data["multiplier"] == 1.50

    def test_launch_context_sees_only_own_agent(self, tmp_path: Path) -> None:
        """Each agent's file contains only its own reward memory."""
        from src.backend.mcp.reinforcement.models import AgentRewardMemory
        writer = QmdRewardWriter(tmp_path)
        rewards = [
            AgentRewardMemory(
                agent_id="software-engineer", role="Software Engineer", multiplier=1.5,
                lifetime_reward=3000, unrewarded_task_count=0,
                unrewarded_reward_total=0,
            ),
            AgentRewardMemory(
                agent_id="qa", role="QA", multiplier=1.0,
                lifetime_reward=2000, unrewarded_task_count=0,
                unrewarded_reward_total=0,
            ),
        ]
        paths = writer.write_agent_rewards(rewards)
        assert len(paths) == 2
        engineer_content = paths[0].read_text()
        qa_content = paths[1].read_text()
        assert "software-engineer" in engineer_content
        assert "qa" not in engineer_content
        assert "qa" in qa_content
        assert "software-engineer" not in qa_content

    def test_patch_task_archive_md(self, tmp_path: Path) -> None:
        """## Reward Received section is appended to task archive markdown."""
        from src.backend.mcp.reinforcement.models import SettlementRecord
        writer = QmdRewardWriter(tmp_path)
        md_path = tmp_path / "archive.md"
        md_path.write_text("# Test Task\n\n## Task Metadata\n\n- ID: T-1\n")
        settlement = SettlementRecord(
            settlement_id="S-1",
            trigger="streak",
            tasks_included=["T-1", "T-2"],
            per_agent_rewards={"software-engineer": 2500, "qa": 2000},
            settled_at="2026-03-22T00:00:00Z",
        )
        writer.patch_task_archive_md(md_path, settlement)
        content = md_path.read_text()
        assert "## Reward Received" in content
        assert "4,500" in content  # aggregate = 2500 + 2000
        assert "software-engineer: 2,500" in content

    def test_patch_replaces_existing_section(self, tmp_path: Path) -> None:
        """Re-patching replaces the managed section, not appends."""
        from src.backend.mcp.reinforcement.models import SettlementRecord
        writer = QmdRewardWriter(tmp_path)
        md_path = tmp_path / "archive.md"
        md_path.write_text("# Test\n\n## Reward Received\n\n- Old data\n")
        settlement = SettlementRecord(
            settlement_id="S-2",
            trigger="five_star",
            tasks_included=["T-1"],
            per_agent_rewards={"software-engineer": 5000},
            settled_at="2026-03-22T12:00:00Z",
        )
        writer.patch_task_archive_md(md_path, settlement)
        content = md_path.read_text()
        assert content.count("## Reward Received") == 1
        assert "Old data" not in content
        assert "S-2" in content
