"""Bounded filesystem helpers shared by the repo_category probe.

These are the low-level, side-effect-free filesystem primitives used by the
category detectors. They are kept in their own module so the detection logic in
``repo_category_probe`` stays focused on classification rather than I/O, and so
both stay comfortably under the file-size limit.
"""
from __future__ import annotations

import fnmatch
import json
import os
from pathlib import Path
from typing import Any


def _is_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def _glob_any(root: Path, pattern: str) -> bool:
    try:
        return any(True for _ in root.glob(pattern))
    except OSError:
        return False


# Heavy directories that never hold project changelog files; descending into
# them is what makes an unbounded recursive scan pathological on large repos.
_RGLOB_SKIP_DIRS = frozenset(
    {
        "node_modules", ".git", ".hg", ".svn", ".venv", "venv",
        "__pycache__", "dist", "build", "target", ".next", ".cache",
        "vendor",
    }
)


def _rglob_any(root: Path, pattern: str, *, scan_limit: int = 5000) -> bool:
    """Bounded recursive filename match.

    Unlike ``Path.rglob`` this skips heavy build/dependency directories and
    stops after ``scan_limit`` entries, so a pattern with no match cannot
    trigger a full-tree walk on a large repository.
    """
    examined = 0
    stack = [root]
    while stack:
        try:
            entries = list(os.scandir(stack.pop()))
        except OSError:
            continue
        for entry in entries:
            examined += 1
            if examined > scan_limit:
                return False
            try:
                if entry.is_dir(follow_symlinks=False):
                    if (
                        entry.name not in _RGLOB_SKIP_DIRS
                        and not entry.name.startswith(".")
                    ):
                        stack.append(Path(entry.path))
                elif fnmatch.fnmatch(entry.name, pattern):
                    return True
            except OSError:
                continue
    return False


def _read_text_safe(path: Path, max_bytes: int = 4096) -> str:
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            return f.read(max_bytes)
    except OSError:
        return ""


def _read_json_object(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if isinstance(data, dict):
        return data
    return None


def _iter_files(root: Path, patterns: tuple[str, ...], *, limit: int = 20) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        try:
            for path in root.glob(pattern):
                if path.is_file():
                    paths.append(path)
                    if len(paths) >= limit:
                        return paths
        except OSError:
            continue
    return paths
