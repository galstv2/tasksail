"""SEC-PY-01: path containment for QMD record storage builders.

record_storage_path / state_file_path interpolate the untrusted manifest
repo_id (and source_path) into a filesystem path. A crafted value must not be
able to escape the context-pack scope dir.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.repo_context_mcp.record_factory import (
    record_storage_path,
    state_file_path,
)

# Enough parent hops to climb above ``scope`` regardless of nesting depth.
_ESCAPE = "../" * 12 + "etc/evil"


def test_record_storage_path_valid_stays_within_scope(tmp_path: Path) -> None:
    scope = tmp_path / "scope"
    result = record_storage_path(scope, "shared", "svc-a", "src/main.py")
    assert result == scope / "estate" / "shared" / "svc-a" / "records" / "src/main.py.json"


def test_record_storage_path_rejects_repo_id_escape(tmp_path: Path) -> None:
    scope = tmp_path / "scope"
    with pytest.raises(ValueError):
        record_storage_path(scope, "shared", _ESCAPE, "x.py")


def test_record_storage_path_rejects_source_path_escape(tmp_path: Path) -> None:
    # The same containment guard also covers a crafted source_path.
    scope = tmp_path / "scope"
    with pytest.raises(ValueError):
        record_storage_path(scope, "shared", "svc-a", _ESCAPE)


def test_record_storage_path_rejects_absolute_repo_id(tmp_path: Path) -> None:
    # An absolute repo_id replaces the join base in Python; the guard must
    # still reject it.
    scope = tmp_path / "scope"
    with pytest.raises(ValueError):
        record_storage_path(scope, "shared", "/etc/passwd", "x.py")


def test_state_file_path_valid_stays_within_scope(tmp_path: Path) -> None:
    scope = tmp_path / "scope"
    result = state_file_path(scope, "svc-a")
    assert result == scope / "operational" / "bootstrap" / "svc-a" / "seed-state.json"


def test_state_file_path_rejects_repo_id_escape(tmp_path: Path) -> None:
    scope = tmp_path / "scope"
    with pytest.raises(ValueError):
        state_file_path(scope, _ESCAPE)
