"""Tests for registry-sourced agent_reward_multipliers."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

REGISTRY_PATH = ROOT / ".github" / "agents" / "registry.json"


def _clear_caches() -> None:
    from src.backend.scripts.python.lib import registry
    registry._load_agents.cache_clear()
    registry.agent_reward_multipliers.cache_clear()


def _write_registry(path: Path, agents: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schema_version": 1, "agents": agents}),
        encoding="utf-8",
    )


class TestAgentRewardMultipliersAccessor:
    """Tests for registry.agent_reward_multipliers()."""

    def setup_method(self) -> None:
        _clear_caches()

    def teardown_method(self) -> None:
        _clear_caches()

    def test_reads_reward_multiplier_field(self, tmp_path: Path) -> None:
        """Accessor returns the value declared in the registry."""
        reg = tmp_path / "registry.json"
        _write_registry(reg, [
            {
                "agent_id": "test-agent",
                "role_name": "Test",
                "human_name": "Tester",
                "workflow_order": 1,
                "reward_multiplier": 1.5,
            }
        ])
        with mock.patch.dict(
            os.environ,
            {"TASKSAIL_AGENT_REGISTRY_PATH": str(reg)},
            clear=False,
        ):
            from src.backend.scripts.python.lib.registry import agent_reward_multipliers
            result = agent_reward_multipliers()
        assert result["test-agent"] == 1.5

    def test_missing_field_defaults_to_1_0(self, tmp_path: Path) -> None:
        """An agent entry without reward_multiplier defaults to 1.0."""
        reg = tmp_path / "registry.json"
        _write_registry(reg, [
            {
                "agent_id": "no-multiplier-agent",
                "role_name": "Role",
                "human_name": "Human",
                "workflow_order": 1,
            }
        ])
        with mock.patch.dict(
            os.environ,
            {"TASKSAIL_AGENT_REGISTRY_PATH": str(reg)},
            clear=False,
        ):
            from src.backend.scripts.python.lib.registry import agent_reward_multipliers
            result = agent_reward_multipliers()
        assert result["no-multiplier-agent"] == 1.0

    def test_behavioral_equivalence_against_real_registry(self) -> None:
        """Registry-sourced multipliers match the previously hardcoded values."""
        with mock.patch.dict(
            os.environ,
            {"TASKSAIL_AGENT_REGISTRY_PATH": str(REGISTRY_PATH)},
            clear=False,
        ):
            from src.backend.scripts.python.lib.registry import agent_reward_multipliers
            result = agent_reward_multipliers()

        assert result["planning-agent"] == 1.0
        assert result["product-manager"] == 1.5
        assert result["software-engineer"] == 1.5
        assert result["qa"] == 1.0

    def test_software_engineer_verify_is_zero(self) -> None:
        """software-engineer-verify has an explicit 0.0 multiplier."""
        with mock.patch.dict(
            os.environ,
            {"TASKSAIL_AGENT_REGISTRY_PATH": str(REGISTRY_PATH)},
            clear=False,
        ):
            from src.backend.scripts.python.lib.registry import agent_reward_multipliers
            result = agent_reward_multipliers()

        assert result["software-engineer-verify"] == 0.0
