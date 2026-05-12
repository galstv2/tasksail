"""Canonical I/O helpers for pack management.

This module is the import home for:
- Atomic write helpers (Phase 1): write_text_atomic, write_json_atomic
- Multi-path resolution helpers (Phase 3): resolve_first_existing, SkippedPath
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path as _Path
from typing import Literal, Sequence

from src.backend.mcp.repo_context_mcp.utils import write_json_atomic as write_json_atomic
from src.backend.mcp.repo_context_mcp.utils import write_text_atomic as write_text_atomic

__all__ = [
    "write_text_atomic",
    "write_json_atomic",
    "SkipReason",
    "SkippedPath",
    "NoExistingPathError",
    "resolve_first_existing",
]

SkipReason = Literal["missing", "unreadable", "not-selected"]


@dataclass(slots=True, frozen=True)
class SkippedPath:
    path: _Path
    reason: SkipReason


class NoExistingPathError(Exception):
    """Raised when no entry in the candidate list exists and is readable."""


def resolve_first_existing(
    local_paths: Sequence[_Path | str],
) -> tuple[_Path, list[SkippedPath]]:
    """Pick the first existing readable directory; return it and a structured skip list.

    - chosen is the first entry that Path.is_dir() and os.access(path, os.R_OK).
    - Every entry preceding chosen is SkippedPath(reason="missing")
      if it does not exist, or reason="unreadable" if it exists but is not readable.
    - Every entry *after* chosen is SkippedPath(reason="not-selected").
    - Raises NoExistingPathError(local_paths) if no entry qualifies.
    """
    paths = [_Path(p) for p in local_paths]
    chosen_index: int | None = None
    pre_skipped: list[SkippedPath] = []
    for i, p in enumerate(paths):
        if p.is_dir() and os.access(p, os.R_OK):
            chosen_index = i
            break
        reason: SkipReason = "unreadable" if p.exists() else "missing"
        pre_skipped.append(SkippedPath(path=p, reason=reason))
    if chosen_index is None:
        raise NoExistingPathError(local_paths)
    chosen = paths[chosen_index]
    post_skipped = [
        SkippedPath(path=paths[j], reason="not-selected")
        for j in range(chosen_index + 1, len(paths))
    ]
    return chosen, pre_skipped + post_skipped
