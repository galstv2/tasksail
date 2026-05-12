"""Tests for resolve_first_existing helper."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from src.backend.mcp.pack_io import (
    NoExistingPathError,
    SkippedPath,
    resolve_first_existing,
)


def test_first_of_two_existing(tmp_path: Path) -> None:
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    chosen, skipped = resolve_first_existing([a, b])
    assert chosen == a
    assert len(skipped) == 1
    assert skipped[0].path == b
    assert skipped[0].reason == "not-selected"


def test_first_missing_second_chosen(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    existing = tmp_path / "existing"
    existing.mkdir()
    chosen, skipped = resolve_first_existing([missing, existing])
    assert chosen == existing
    assert len(skipped) == 1
    assert skipped[0].path == missing
    assert skipped[0].reason == "missing"


def test_multi_path_mixed(tmp_path: Path) -> None:
    a = tmp_path / "a"
    b = tmp_path / "b"
    c = tmp_path / "c"
    b.mkdir()
    c.mkdir()
    # a is missing, b is chosen, c is not-selected
    chosen, skipped = resolve_first_existing([a, b, c])
    assert chosen == b
    assert skipped[0] == SkippedPath(path=a, reason="missing")
    assert skipped[1] == SkippedPath(path=c, reason="not-selected")


def test_all_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(NoExistingPathError):
        resolve_first_existing([tmp_path / "x", tmp_path / "y"])


def test_single_path_no_skipped(tmp_path: Path) -> None:
    d = tmp_path / "only"
    d.mkdir()
    chosen, skipped = resolve_first_existing([d])
    assert chosen == d
    assert skipped == []


def test_unreadable_skipped_as_unreadable(tmp_path: Path) -> None:
    unreadable = tmp_path / "unreadable"
    readable = tmp_path / "readable"
    unreadable.mkdir()
    readable.mkdir()
    os.chmod(unreadable, 0o000)
    try:
        chosen, skipped = resolve_first_existing([unreadable, readable])
        assert chosen == readable
        assert skipped[0].reason == "unreadable"
    finally:
        os.chmod(unreadable, 0o755)
