from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal


def logs_dir(repo_root: str | None = None) -> Path:
    override = os.getenv("LOG_DIR")
    if override:
        return Path(override)
    return _repo_root(repo_root) / ".platform-state" / "logs"


def log_file(
    level: Literal["info", "warn", "error"],
    date: datetime,
    repo_root: str | None = None,
) -> Path:
    stamp = _utc_date(date).strftime("%Y%m%d")
    return logs_dir(repo_root) / level / f"backend-py-{stamp}.jsonl"


def task_agent_log_file(
    task_id: str,
    agent_id: str,
    repo_root: str | None = None,
) -> Path:
    return logs_dir(repo_root) / "agent" / task_id / f"{agent_id}.jsonl"


def log_file_with_suffix(base_path: Path, suffix: int) -> Path:
    if base_path.suffix == ".jsonl":
        return base_path.with_name(f"{base_path.stem}.{suffix}.jsonl")
    return base_path.with_name(f"{base_path.name}.{suffix}.jsonl")


def _repo_root(repo_root: str | None) -> Path:
    if repo_root:
        return Path(repo_root)

    for candidate in Path(__file__).resolve().parents:
        if (candidate / ".git").exists():
            return candidate

    env_root = os.getenv("TASKSAIL_REPO_ROOT")
    if env_root:
        return Path(env_root)

    fallback = Path.cwd()
    sys.stderr.write(f"[logging] repo root discovery failed; using cwd={fallback}\n")
    return fallback


def _utc_date(date: datetime) -> datetime:
    if date.tzinfo is None:
        return date.replace(tzinfo=UTC)
    return date.astimezone(UTC)


__all__ = [
    "logs_dir",
    "log_file",
    "task_agent_log_file",
    "log_file_with_suffix",
]
