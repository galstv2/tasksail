"""Tests for reinforcement context rendering command."""
from __future__ import annotations

import json
import sys
from argparse import Namespace
from pathlib import Path

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.backend.scripts.python.lib.role_agent.reinforcement_cmds import (  # noqa: E402
    _count_unrewarded_successes,
    cmd_render_reinforcement_context,
)

CANONICAL_STORE = Path("AgentWorkSpace/qmd/global/reinforcement/store")
CANONICAL_SIDECARS = Path("AgentWorkSpace/qmd/global/reinforcement/agent-rewards")
LEGACY_STORE = Path("AgentWorkSpace/qmd/reinforcement")
LEGACY_SIDECARS = Path("AgentWorkSpace/qmd/global/agent-rewards")


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _make_agent_rewards(*agents: dict) -> dict:
    return {"schema_version": "1.0", "entries": list(agents)}


def _make_agent(
    agent_id: str = "software-engineer",
    role: str = "Software Engineer",
    multiplier: float = 1.50,
    lifetime_reward: int = 45000,
    unrewarded_task_count: int = 7,
    unrewarded_reward_total: int = 14000,
) -> dict:
    return {
        "agent_id": agent_id,
        "role": role,
        "multiplier": multiplier,
        "lifetime_reward": lifetime_reward,
        "unrewarded_task_count": unrewarded_task_count,
        "unrewarded_reward_total": unrewarded_reward_total,
    }


def _make_ledger(*entries: dict) -> dict:
    return {"schema_version": "1.0", "entries": list(entries)}


def _make_ledger_entry(
    task_id: str = "T-1",
    settlement_status: str = "unrewarded",
    quality_outcome: str = "success",
) -> dict:
    return {
        "task_id": task_id,
        "parent_task_id": "",
        "is_child": False,
        "difficulty": "medium",
        "base_reward": 2000,
        "effective_reward": 2000,
        "settlement_status": settlement_status,
        "quality_outcome": quality_outcome,
        "feedback_id": "",
        "settlement_id": "",
        "realignment_id": "",
        "created_at": "2026-01-01T00:00:00Z",
    }


def _make_settlement(
    settlement_id: str = "SETTLE-a1b2c3",
    trigger: str = "streak",
    per_agent_rewards: dict | None = None,
) -> dict:
    return {
        "settlement_id": settlement_id,
        "trigger": trigger,
        "tasks_included": ["T-1"],
        "per_agent_rewards": per_agent_rewards or {"software-engineer": 30000},
        "settled_at": "2026-03-10T00:00:00Z",
    }


def _make_feedback(
    task_id: str = "T-42",
    feedback_type: str = "positive",
    star_rating: int | None = 4,
    comment: str = "",
) -> dict:
    return {
        "feedback_id": f"FB-{task_id}",
        "task_id": task_id,
        "feedback_type": feedback_type,
        "star_rating": star_rating,
        "comment": comment,
        "created_at": "2026-01-01T00:00:00Z",
    }


def _make_global_doc(
    standing_expectations: list[str] | None = None,
    behavioral_guidance: list[str] | None = None,
    lessons_learned: list[str] | None = None,
    fairness_framing: list[str] | None = None,
) -> dict:
    return {
        "standing_expectations": standing_expectations or [],
        "behavioral_guidance": behavioral_guidance or [],
        "lessons_learned": lessons_learned or [],
        "fairness_framing": fairness_framing or [],
        "version": 1,
        "updated_at": "2026-01-01T00:00:00Z",
        "schema_version": "1.0",
    }


def _run(
    tmp_path: Path,
    agent_id: str = "software-engineer",
) -> tuple[int, str, str]:
    """Run the renderer and return (exit_code, markdown, export_text)."""
    output_path = tmp_path / "output.md"
    export_path = tmp_path / "output.env"
    args = Namespace(
        context_pack_dir=str(tmp_path / "pack"),
        repo_root=str(tmp_path),
        agent_id=agent_id,
        output_path=output_path,
        export_path=export_path,
    )
    rc = cmd_render_reinforcement_context(args)
    md = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    env = export_path.read_text(encoding="utf-8") if export_path.exists() else ""
    return rc, md, env


def _run_with_repo_root(
    tmp_path: Path,
    agent_id: str = "software-engineer",
) -> tuple[int, str, str]:
    """Run the renderer using repo_root for QMD-backed resolution."""
    output_path = tmp_path / "output.md"
    export_path = tmp_path / "output.env"
    args = Namespace(
        context_pack_dir=str(tmp_path / "pack"),
        repo_root=str(tmp_path),
        agent_id=agent_id,
        output_path=output_path,
        export_path=export_path,
    )
    rc = cmd_render_reinforcement_context(args)
    md = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    env = export_path.read_text(encoding="utf-8") if export_path.exists() else ""
    return rc, md, env


class TestQmdPathResolution:
    """QMD-backed path is preferred over legacy context-pack-local path."""

    def test_qmd_path_preferred_over_legacy(self, tmp_path: Path) -> None:
        # Write data to both QMD and legacy paths.
        qmd_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        legacy_dir = tmp_path / "pack" / "reinforcement"

        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(lifetime_reward=99000),
        )
        _write_json(qmd_dir / "task-ledger.json", _make_ledger())

        _write_json(
            legacy_dir / "agent-rewards.json",
            _make_agent_rewards(_make_agent(lifetime_reward=1000)),
        )
        _write_json(legacy_dir / "task-ledger.json", _make_ledger())

        rc, md, _ = _run_with_repo_root(tmp_path)
        assert rc == 0
        assert "99,000" in md  # QMD data, not legacy 1,000
        assert "1,000" not in md

    def test_per_agent_json_preferred_over_shared(self, tmp_path: Path) -> None:
        """Per-agent JSON sidecar is read instead of shared agent-rewards.json."""
        qmd_dir = tmp_path / CANONICAL_STORE
        per_agent_dir = tmp_path / CANONICAL_SIDECARS

        # Per-agent JSON with distinct lifetime_reward.
        _write_json(
            per_agent_dir / "software-engineer.json",
            _make_agent(lifetime_reward=77000),
        )
        # Shared JSON with different value — should NOT be used.
        _write_json(
            qmd_dir / "agent-rewards.json",
            _make_agent_rewards(_make_agent(lifetime_reward=11000)),
        )
        _write_json(qmd_dir / "task-ledger.json", _make_ledger())

        rc, md, _ = _run_with_repo_root(tmp_path)
        assert rc == 0
        assert "77,000" in md
        assert "11,000" not in md

    def test_migrates_legacy_qmd_store_when_canonical_absent(
        self, tmp_path: Path,
    ) -> None:
        legacy_dir = tmp_path / LEGACY_STORE
        legacy_sidecars = tmp_path / LEGACY_SIDECARS
        _write_json(
            legacy_sidecars / "software-engineer.json",
            _make_agent(lifetime_reward=7500),
        )
        _write_json(legacy_dir / "task-ledger.json", _make_ledger())

        rc, md, _ = _run_with_repo_root(tmp_path)
        assert rc == 0
        assert "7,500" in md
        assert (tmp_path / CANONICAL_SIDECARS / "software-engineer.json").is_file()
        assert (tmp_path / LEGACY_SIDECARS / "software-engineer.json").is_file()

    def test_migrates_legacy_agent_sidecar_when_canonical_absent(
        self, tmp_path: Path,
    ) -> None:
        legacy_sidecars = tmp_path / LEGACY_SIDECARS
        legacy_store = tmp_path / LEGACY_STORE
        _write_json(
            legacy_sidecars / "software-engineer.json",
            _make_agent(lifetime_reward=88000),
        )
        _write_json(
            legacy_store / "agent-rewards.json",
            _make_agent_rewards(_make_agent(lifetime_reward=11000)),
        )
        _write_json(legacy_store / "task-ledger.json", _make_ledger())

        rc, md, _ = _run_with_repo_root(tmp_path)

        assert rc == 0
        assert "88,000" in md
        assert "11,000" not in md
        assert (tmp_path / CANONICAL_SIDECARS / "software-engineer.json").is_file()

    def test_ignores_context_pack_local_legacy_when_qmd_absent(
        self, tmp_path: Path,
    ) -> None:
        legacy_dir = tmp_path / "pack" / "reinforcement"
        _write_json(legacy_dir / "task-ledger.json", _make_ledger())

        rc, md, _ = _run(tmp_path)
        assert rc == 0
        assert "- Status: unavailable" in md
        assert "No private per-agent reinforcement data" in md


class TestHappyPath:
    def test_all_data_present(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(),
        )
        _write_json(
            r_dir / "task-ledger.json",
            _make_ledger(
                *[_make_ledger_entry(f"T-{i}") for i in range(1, 8)],
            ),
        )
        _write_json(
            r_dir / "settlements.json",
            {"schema_version": "1.0", "entries": [_make_settlement()]},
        )
        _write_json(
            r_dir / "feedback-events.json",
            {"schema_version": "1.0", "entries": [
                _make_feedback("T-41", "positive", 5, "strong outcome"),
                _make_feedback("T-42", "positive", 4),
            ]},
        )
        _write_json(
            r_dir / "global-realignment-doc.json",
            _make_global_doc(
                standing_expectations=["All roles must produce QA-passing artifacts."],
                behavioral_guidance=["Avoid: insufficient test edge-case coverage"],
                lessons_learned=["Missing fixture data should be caught in SDET review."],
                fairness_framing=["Role weighting reflects system design, not status."],
            ),
        )

        rc, md, env = _run(tmp_path)
        assert rc == 0
        assert "- Status: available" in md
        assert "- Agent: software-engineer (Dalton)" in md
        assert "- Role Multiplier: 1.50x" in md
        assert "## Your Reward Standing" in md
        assert "Lifetime Reward: 45,000" in md
        assert "7 of 10 successful tasks toward your next reward checkpoint" in md
        assert "Reward Pool" not in md
        assert "SETTLE-a1b2c3" not in md
        assert "## Recent Feedback" in md
        assert "## Standing Expectations" in md
        assert "## Behavioral Guidance" in md
        assert "## Lessons Learned" in md
        assert "## Fairness Framing" in md
        assert "CONTEXT_PACK_REINFORCEMENT_STATUS=available" in env
        assert "CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED=true" in env


class TestUnavailable:
    def test_no_agent_reward_entry(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        _write_json(
            r_dir / "agent-rewards.json",
            _make_agent_rewards(_make_agent(agent_id="qa", role="QA and Closeout", multiplier=1.0)),
        )

        rc, md, env = _run(tmp_path, agent_id="software-engineer")
        assert rc == 0
        assert "- Status: unavailable" in md
        assert "No private per-agent reinforcement data has been generated yet." in md
        assert "CONTEXT_PACK_REINFORCEMENT_STATUS=unavailable" in env
        assert "CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED=false" in env

    def test_no_reinforcement_directory(self, tmp_path: Path) -> None:
        pack = tmp_path / "pack"
        pack.mkdir(parents=True)
        # No reinforcement/ dir at all — renderer receives the pack dir,
        # and agent-rewards.json will be missing.
        rc, md, env = _run(tmp_path)
        assert rc == 0
        assert "malformed" in md or "unavailable" in md
        assert "CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED=false" in env


class TestGracefulDegradation:
    def test_without_global_doc_or_settlements(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(),
        )
        _write_json(
            r_dir / "task-ledger.json",
            _make_ledger(_make_ledger_entry("T-1")),
        )

        rc, md, env = _run(tmp_path)
        assert rc == 0
        assert "- Status: available" in md
        assert "## Your Reward Standing" in md
        assert "## Standing Expectations" not in md
        assert "## Behavioral Guidance" not in md
        assert "## Fairness Framing" not in md
        assert "CONTEXT_PACK_REINFORCEMENT_STATUS=available" in env
        assert "CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED=true" in env


class TestDataIsolation:
    def test_agent_sees_only_own_data(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(
                agent_id="software-engineer",
                lifetime_reward=45000,
            ),
        )
        _write_json(
            sidecar_dir / "qa.json",
            _make_agent(
                agent_id="qa",
                role="QA and Closeout",
                multiplier=1.0,
                lifetime_reward=20000,
                unrewarded_task_count=3,
                unrewarded_reward_total=6000,
            ),
        )
        _write_json(
            r_dir / "task-ledger.json",
            _make_ledger(_make_ledger_entry("T-1")),
        )

        rc, md, _ = _run(tmp_path, agent_id="software-engineer")
        assert rc == 0
        assert "software-engineer" in md
        assert "Dalton" in md
        assert "qa" not in md.lower().split("status:")[1]
        assert "20,000" not in md


class TestStreakCalculation:
    def test_consecutive_unrewarded_successes(self, tmp_path: Path) -> None:
        entries = [
            {"settlement_status": "rewarded", "quality_outcome": "success"},
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
        ]
        assert _count_unrewarded_successes(entries) == 3

    def test_broken_by_error(self, tmp_path: Path) -> None:
        entries = [
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
            {"settlement_status": "unrewarded", "quality_outcome": "error"},
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
            {"settlement_status": "unrewarded", "quality_outcome": "success"},
        ]
        assert _count_unrewarded_successes(entries) == 2

    def test_empty_ledger(self) -> None:
        assert _count_unrewarded_successes([]) == 0

    def test_all_rewarded(self) -> None:
        entries = [
            {"settlement_status": "rewarded", "quality_outcome": "success"},
            {"settlement_status": "rewarded", "quality_outcome": "success"},
        ]
        assert _count_unrewarded_successes(entries) == 0


class TestExportFormat:
    def test_export_file_has_all_keys(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(),
        )
        _write_json(
            r_dir / "task-ledger.json",
            _make_ledger(),
        )

        rc, _, env = _run(tmp_path)
        assert rc == 0
        assert "export CONTEXT_PACK_REINFORCEMENT_STATUS=" in env
        assert "export CONTEXT_PACK_REINFORCEMENT_REASON=" in env
        assert "export CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED=" in env
        assert "export CONTEXT_PACK_REINFORCEMENT_CONTEXT_FILE=" in env

    def test_export_values_are_shell_safe(self, tmp_path: Path) -> None:
        r_dir = tmp_path / CANONICAL_STORE
        sidecar_dir = tmp_path / CANONICAL_SIDECARS
        _write_json(
            sidecar_dir / "software-engineer.json",
            _make_agent(),
        )
        _write_json(r_dir / "task-ledger.json", _make_ledger())

        _, _, env = _run(tmp_path)
        for line in env.strip().splitlines():
            assert line.startswith("export ")
            key_val = line[len("export "):]
            assert "=" in key_val
