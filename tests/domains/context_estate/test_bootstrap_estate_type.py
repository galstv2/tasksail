"""Tests that estate_type round-trips through the bootstrap pipeline."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.backend.mcp.context_estate.bootstrap import (
    _determine_estate_mode,
    bootstrap_context_pack,
)


class TestDetermineEstateMode:
    def test_explicit_distributed_passthrough(self) -> None:
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "distributed")
        assert result == "distributed"

    def test_explicit_distributed_platform_passthrough(self) -> None:
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "distributed-platform")
        assert result == "distributed-platform"

    def test_explicit_monolith_passthrough(self) -> None:
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "monolith")
        assert result == "monolith"

    def test_explicit_monolith_platform_passthrough(self) -> None:
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "monolith-platform")
        assert result == "monolith-platform"

    def test_auto_with_multi_repo_infers_distributed(self) -> None:
        answers = {"repositories": [{}, {}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "auto")
        assert result == "distributed"

    def test_auto_with_focus_areas_infers_monolith(self) -> None:
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        discovery = {"candidate_focus_areas": [{"focus_id": "api"}]}
        result = _determine_estate_mode(answers, discovery, "auto")
        assert result == "monolith"

    def test_distributed_never_promoted_to_platform(self) -> None:
        """Anti-corruption: explicit 'distributed' must not be auto-promoted to 'distributed-platform'."""
        answers = {"repositories": [{}, {}], "discovery_mode": None, "estate_type": None}
        result = _determine_estate_mode(answers, {}, "distributed")
        assert result == "distributed"
        assert result != "distributed-platform"

    def test_monolith_never_promoted_to_platform(self) -> None:
        """Anti-corruption: explicit 'monolith' must not be auto-promoted to 'monolith-platform'."""
        answers = {"repositories": [{}], "discovery_mode": None, "estate_type": None}
        discovery = {"candidate_focus_areas": [{"focus_id": "api"}]}
        result = _determine_estate_mode(answers, discovery, "monolith")
        assert result == "monolith"
        assert result != "monolith-platform"


@pytest.mark.parametrize(
    "requested_mode",
    ["distributed", "distributed-platform", "monolith", "monolith-platform"],
)
def test_bootstrap_manifest_preserves_explicit_estate_type(
    tmp_path: Path,
    requested_mode: str,
) -> None:
    discovery_root = tmp_path / "workspace"
    context_pack_dir = tmp_path / "contexts" / requested_mode
    repo_root = discovery_root / "main-repo"
    repo_root.mkdir(parents=True)
    (repo_root / ".git").mkdir()

    answers = {
        "context_pack_id": f"{requested_mode}-pack",
        "estate_name": f"{requested_mode} Pack",
        "repositories": [
            {
                "repo_root": str(repo_root),
                "repo_name": "Main Repo",
                "repo_id": "main-repo",
                "system_layer": "shared" if requested_mode.startswith("monolith") else "backend",
                "repository_type": "primary",
            }
        ],
        "primary_working_repo_ids": ["main-repo"],
    }
    if requested_mode.startswith("monolith"):
        answers["focusable_areas"] = [
            {
                "focus_id": "core",
                "focus_name": "Core",
                "relative_path": ".",
                "path": str(repo_root),
                "focus_type": "service",
                "default_focusable": True,
                "activation_priority": 100,
            }
        ]
        answers["primary_focus_area_ids"] = ["core"]

    payload = bootstrap_context_pack(
        context_pack_dir,
        answers,
        discovery_root,
        requested_mode=requested_mode,
    )
    manifest = json.loads(Path(payload["manifest_path"]).read_text(encoding="utf-8"))

    assert payload["estate_type"] == requested_mode
    assert manifest["estate_type"] == requested_mode
