from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

from .json_formatter import JsonFormatter
from .log_paths import log_file, log_file_with_suffix, task_agent_log_file

DEFAULT_MAX_BYTES = 52_428_800


class LevelRouter(logging.Handler):
    def __init__(
        self,
        *,
        repo_root: str | None = None,
        max_bytes: int | None = None,
    ) -> None:
        super().__init__()
        self.repo_root = repo_root
        self.max_bytes = max_bytes or _env_int(
            "TASKSAIL_LOG_MAX_BYTES",
            DEFAULT_MAX_BYTES,
        )
        self.formatter = JsonFormatter()
        self._handles: dict[Path, TextIO] = {}

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
            destinations = [self._level_path(record)]
            task_id = getattr(record, "task_id", None)
            agent_id = getattr(record, "agent_id", None)
            if task_id and agent_id:
                destinations.append(
                    task_agent_log_file(str(task_id), str(agent_id), self.repo_root)
                )

            for destination in destinations:
                self._write(destination, line)

            if record.levelno >= logging.WARNING:
                sys.stderr.write(f"{line}\n")
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        for handle in self._handles.values():
            handle.close()
        self._handles.clear()
        super().close()

    def _level_path(self, record: logging.LogRecord) -> Path:
        if record.levelno >= logging.ERROR:
            level = "error"
        elif record.levelno >= logging.WARNING:
            level = "warn"
        else:
            level = "info"
        date = datetime.fromtimestamp(record.created, UTC)
        return log_file(level, date, self.repo_root)

    def _write(self, base_path: Path, line: str) -> None:
        path = self._rotated_path(base_path)
        handle = self._handle_for(path)
        handle.write(f"{line}\n")
        handle.flush()

    def _handle_for(self, path: Path) -> TextIO:
        handle = self._handles.get(path)
        if handle is not None:
            return handle

        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a", encoding="utf-8")
        self._handles[path] = handle
        return handle

    def _rotated_path(self, base_path: Path) -> Path:
        if not _over_limit(base_path, self.max_bytes):
            return base_path

        suffix = 1
        while True:
            candidate = log_file_with_suffix(base_path, suffix)
            if not candidate.exists() or not _over_limit(candidate, self.max_bytes):
                return candidate
            suffix += 1


def _over_limit(path: Path, max_bytes: int) -> bool:
    try:
        return path.stat().st_size > max_bytes
    except OSError:
        return False


def _env_int(key: str, default: int) -> int:
    try:
        value = int(os.getenv(key, ""))
    except ValueError:
        return default
    return value if value > 0 else default


__all__ = ["LevelRouter"]
