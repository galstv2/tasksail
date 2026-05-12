"""Tests for pack_io re-export and semantic preservation."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.backend.mcp.pack_io import write_json_atomic, write_text_atomic


def test_write_text_atomic_creates_file(tmp_path: Path) -> None:
    target = tmp_path / "test.txt"
    write_text_atomic(target, "hello\n")
    assert target.read_text() == "hello\n"


def test_write_text_atomic_replaces_existing(tmp_path: Path) -> None:
    target = tmp_path / "test.txt"
    target.write_text("old content")
    write_text_atomic(target, "new content\n")
    assert target.read_text() == "new content\n"


def test_write_json_atomic_produces_valid_json(tmp_path: Path) -> None:
    target = tmp_path / "data.json"
    write_json_atomic(target, {"b": 2, "a": 1})
    parsed = json.loads(target.read_text())
    assert parsed == {"b": 2, "a": 1}


def test_write_json_atomic_preserves_insertion_order(tmp_path: Path) -> None:
    """write_json_atomic uses sort_keys=False — insertion order is preserved."""
    target = tmp_path / "data.json"
    write_json_atomic(target, {"z": 1, "a": 2})
    raw = target.read_text()
    assert raw.index('"z"') < raw.index('"a"'), "Insertion order should be preserved"


def test_write_text_atomic_crash_safety(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """If os.replace fails, the original file is preserved and the temp file is cleaned up."""
    target = tmp_path / "manifest.json"
    target.write_text("original content")

    original_replace = os.replace
    call_count = 0

    def failing_replace(src, dst):  # type: ignore[no-untyped-def]
        nonlocal call_count
        call_count += 1
        os.unlink(src)  # clean up temp file manually
        raise OSError("simulated crash")

    monkeypatch.setattr(os, "replace", failing_replace)
    with pytest.raises(OSError, match="simulated crash"):
        write_text_atomic(target, "new content\n")

    assert target.read_text() == "original content"
    # No temp files left
    temp_files = list(tmp_path.glob(".manifest.json.*.tmp"))
    assert not temp_files
