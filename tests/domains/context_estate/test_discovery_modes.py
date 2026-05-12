"""Tests for discover_estate mode widening (G4)."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.context_estate.discovery import discover_estate


def test_distributed_platform_mode_accepted(tmp_path: Path) -> None:
    """discover_estate must accept 'distributed-platform' without raising."""
    (tmp_path / "repo-a").mkdir()
    (tmp_path / "repo-a" / ".git").mkdir()
    result = discover_estate(tmp_path, mode="distributed-platform", allow_missing=False)
    assert result["estate_type"] == "distributed-platform"


def test_monolith_platform_mode_accepted(tmp_path: Path) -> None:
    """discover_estate must accept 'monolith-platform' without raising."""
    result = discover_estate(tmp_path, mode="monolith-platform", allow_missing=True)
    assert result["estate_type"] == "monolith-platform"


def test_bogus_mode_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Unsupported discovery mode"):
        discover_estate(tmp_path, mode="bogus", allow_missing=True)


def test_distributed_platform_scans_like_distributed(tmp_path: Path) -> None:
    """distributed-platform should use the distributed scan branch (candidate_repos populated)."""
    (tmp_path / "repo-a").mkdir()
    (tmp_path / "repo-a" / ".git").mkdir()
    result = discover_estate(tmp_path, mode="distributed-platform", allow_missing=False)
    assert "candidate_repos" in result


def test_monolith_platform_scans_like_monolith(tmp_path: Path) -> None:
    """monolith-platform should use the monolith scan branch (candidate_focus_areas populated)."""
    result = discover_estate(tmp_path, mode="monolith-platform", allow_missing=True)
    assert "candidate_focus_areas" in result
