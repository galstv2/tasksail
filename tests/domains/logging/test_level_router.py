from __future__ import annotations

import json
import logging
from pathlib import Path

from src.backend.scripts.python.lib.level_router import LevelRouter


def test_warning_routes_to_warn_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    handler = LevelRouter()
    record = logging.LogRecord("src.backend.mcp.service", logging.WARNING, __file__, 1, "warn", (), None)

    handler.emit(record)
    handler.close()

    assert _lines(_one(tmp_path / "warn", "backend-py-*.jsonl")) == ["warn"]
    assert not list((tmp_path / "info").glob("backend-py-*.jsonl"))
    assert not list((tmp_path / "error").glob("backend-py-*.jsonl"))


def test_debug_routes_to_info_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    handler = LevelRouter()
    record = logging.LogRecord("src.backend.mcp.service", logging.DEBUG, __file__, 1, "debug", (), None)

    handler.emit(record)
    handler.close()

    assert _levels(_one(tmp_path / "info", "backend-py-*.jsonl")) == ["debug"]


def test_task_agent_fanout_writes_level_and_shard(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    handler = LevelRouter()
    record = logging.LogRecord("src.backend.mcp.service", logging.WARNING, __file__, 1, "warn", (), None)
    record.task_id = "t1"
    record.agent_id = "a1"

    handler.emit(record)
    handler.close()

    assert _lines(_one(tmp_path / "warn", "backend-py-*.jsonl")) == ["warn"]
    assert _lines(tmp_path / "agent" / "t1" / "a1.jsonl") == ["warn"]


def test_size_rotation_creates_suffix_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("TASKSAIL_LOG_MAX_BYTES", "512")
    handler = LevelRouter()

    for index in range(50):
        record = logging.LogRecord(
            "src.backend.mcp.service",
            logging.INFO,
            __file__,
            1,
            "info %s",
            (index,),
            None,
        )
        handler.emit(record)
    handler.close()

    assert list((tmp_path / "info").glob("backend-py-*.1.jsonl"))


def test_warn_and_error_are_mirrored_to_stderr(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    handler = LevelRouter()
    record = logging.LogRecord("src.backend.mcp.service", logging.ERROR, __file__, 1, "error", (), None)

    handler.emit(record)
    handler.close()

    assert "error" in capsys.readouterr().err


def _lines(path: Path) -> list[str]:
    return [json.loads(line)["msg"] for line in path.read_text().splitlines()]


def _levels(path: Path) -> list[str]:
    return [json.loads(line)["level"] for line in path.read_text().splitlines()]


def _one(root: Path, pattern: str) -> Path:
    matches = list(root.glob(pattern))
    assert len(matches) == 1
    return matches[0]
