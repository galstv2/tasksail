"""Workspace-level analysis: recursively count repos, folders, and files."""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.constants import SKIP_DIR_NAMES

logger = logging.getLogger(__name__)

# Cap total entries to avoid runaway scanning on massive monorepos.
_MAX_WALK_ENTRIES = 50_000
_GIT_LS_FILES_TIMEOUT_SECONDS = 30


def analyze_workspace_counts(
    manifest_data: dict[str, Any],
) -> dict[str, int]:
    """Count folders and files across every repository in the manifest.

    Uses ``git ls-files`` when available so that ``.gitignore`` rules are
    respected automatically.  Falls back to ``os.walk`` with
    ``SKIP_DIR_NAMES`` pruning when the repo root is not a git repository
    or git is unavailable.

    Returns ``{"repo_count": N, "folder_count": N, "file_count": N}``.
    """
    repos = manifest_data.get("repositories") or []
    repo_count = len(repos)
    total_folders = 0
    total_files = 0
    seen_roots: set[str] = set()

    for repo in repos:
        local_paths = repo.get("local_paths") or []
        for local_path in local_paths:
            root = Path(local_path).resolve()
            root_key = str(root)
            if root_key in seen_roots:
                continue
            seen_roots.add(root_key)
            if not root.is_dir():
                continue
            folders, files = _count_repo(root)
            total_folders += folders
            total_files += files

    return {
        "repo_count": repo_count,
        "folder_count": total_folders,
        "file_count": total_files,
    }


def _count_repo(root: Path) -> tuple[int, int]:
    """Count folders and files under *root*.

    Tries ``git ls-files`` first (respects ``.gitignore``).  Falls back
    to ``_walk_directory`` if git is not available or the directory is
    not a git repository.
    """
    try:
        return _count_git_tracked(root)
    except Exception:  # noqa: BLE001
        logger.debug(
            "git ls-files unavailable for %s, falling back to os.walk",
            root,
            exc_info=True,
        )
        return _walk_directory(root)


def _count_git_tracked(root: Path) -> tuple[int, int]:
    """Count tracked files and their containing folders via ``git ls-files``.

    Raises on any git failure so the caller can fall back.
    """
    result = subprocess.run(  # noqa: S603, S607
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=_GIT_LS_FILES_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git ls-files exited with code {result.returncode}")

    lines = result.stdout.splitlines()
    file_count = 0
    folders: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        file_count += 1
        parent = str(Path(stripped).parent)
        if parent and parent != ".":
            # Collect every ancestor directory.
            parts = Path(stripped).parts[:-1]
            for depth in range(1, len(parts) + 1):
                folders.add("/".join(parts[:depth]))

    return len(folders), file_count


def _walk_directory(root: Path) -> tuple[int, int]:
    """Fallback: count folders and files under *root* using ``os.walk``.

    Prunes directories in ``SKIP_DIR_NAMES`` (e.g. ``.git``,
    ``node_modules``).  Caps at ``_MAX_WALK_ENTRIES`` total entries to
    avoid runaway scanning; counts returned after the cap may be
    incomplete.
    """
    folder_count = 0
    file_count = 0
    entries_seen = 0

    for _dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIR_NAMES
        ]
        folder_count += len(dirnames)
        file_count += len(filenames)
        entries_seen += len(dirnames) + len(filenames)
        if entries_seen >= _MAX_WALK_ENTRIES:
            break

    return folder_count, file_count
