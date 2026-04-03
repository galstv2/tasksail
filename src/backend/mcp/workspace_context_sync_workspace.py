"""Workspace folder management helpers for workspace context sync.

Extracted from WorkspaceContextSyncService to keep the main service module
under the 500-line limit.  Functions are parameterized on the paths they
need rather than depending on instance state.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from src.backend.mcp.repo_context_mcp.utils import (
    resolve_path_within,
    unique_preserving_order,
)


@dataclass(frozen=True)
class WorkspaceFolderEntry:
    """A single folder entry from a VS Code workspace file."""

    raw_entry: dict[str, Any]
    normalized_path: str


def normalize_any_path(candidate: Path) -> Path:
    """Resolve *candidate*, falling back to non-strict if the path is missing."""
    try:
        return candidate.resolve(strict=True)
    except FileNotFoundError:
        return candidate.resolve(strict=False)


def normalize_workspace_entry_path(
    raw_path: str,
    workspace_file: Path,
) -> str:
    """Normalize a workspace folder entry path relative to the workspace file."""
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = workspace_file.parent / candidate
    return normalize_any_path(candidate).as_posix()


def load_workspace_entries(
    workspace_payload: dict[str, Any],
    workspace_file: Path,
) -> list[WorkspaceFolderEntry]:
    """Parse the ``folders`` list from a workspace payload."""
    folders = workspace_payload.get("folders")
    if not isinstance(folders, list):
        raise ValueError("Workspace file must include a folders list")

    entries: list[WorkspaceFolderEntry] = []
    for index, folder in enumerate(folders):
        if isinstance(folder, str):
            raw_entry = {"path": folder}
        elif isinstance(folder, dict):
            raw_entry = dict(folder)
        else:
            raise ValueError(
                "Workspace folder entry "
                f"#{index + 1} must be a string or object"
            )

        raw_path = raw_entry.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ValueError(
                "Workspace folder entry "
                f"#{index + 1} requires a non-empty path"
            )
        normalized_path = normalize_workspace_entry_path(
            raw_path, workspace_file
        )
        entries.append(
            WorkspaceFolderEntry(
                raw_entry=raw_entry,
                normalized_path=normalized_path,
            )
        )
    return entries


def build_sync_preview(
    *,
    workspace_entries: list[WorkspaceFolderEntry],
    state: dict[str, Any],
    target_folder_paths: list[Path],
) -> dict[str, Any]:
    """Compute the folder delta between current workspace and target state."""
    current_workspace_paths = [
        entry.normalized_path for entry in workspace_entries
    ]
    current_workspace_set = set(current_workspace_paths)
    current_managed_set = set(state.get("managed_folders", []))
    current_nonmanaged_set = current_workspace_set - current_managed_set

    target_paths = [
        normalize_any_path(path).as_posix()
        for path in target_folder_paths
    ]
    deduped_target_paths = unique_preserving_order(target_paths)
    next_managed_set: set[str] = set()

    next_managed_folders: list[str] = []
    for target_path in deduped_target_paths:
        if target_path in current_nonmanaged_set:
            continue
        next_managed_folders.append(target_path)
        next_managed_set.add(target_path)

    folders_to_add = [
        path
        for path in next_managed_folders
        if path not in current_workspace_set
    ]
    folders_to_remove = [
        entry.normalized_path
        for entry in workspace_entries
        if entry.normalized_path in current_managed_set
        and entry.normalized_path not in next_managed_set
    ]

    preserved_entries = [
        entry.raw_entry
        for entry in workspace_entries
        if entry.normalized_path not in current_managed_set
    ]
    preserved_paths = {
        entry.normalized_path
        for entry in workspace_entries
        if entry.normalized_path not in current_managed_set
    }
    existing_entry_map = {
        entry.normalized_path: entry.raw_entry
        for entry in workspace_entries
    }

    result_folders = list(preserved_entries)
    for target_path in deduped_target_paths:
        if target_path in preserved_paths:
            continue
        if target_path in existing_entry_map:
            result_folders.append(existing_entry_map[target_path])
        else:
            result_folders.append({"path": target_path})

    return {
        "folders_to_add": folders_to_add,
        "folders_to_remove": folders_to_remove,
        "managed_folders": next_managed_folders,
        "result_folders": result_folders,
    }


def resolve_manifest_target_path(
    context_pack_dir: Path,
    raw_path: str,
) -> Path | None:
    """Resolve a manifest local_paths entry to a real path, or ``None``."""
    candidate = Path(raw_path).expanduser()
    if candidate.is_absolute():
        resolved = candidate.resolve(strict=False)
    else:
        resolved = resolve_path_within(
            context_pack_dir,
            raw_path,
            "local_paths",
        )
    if not resolved.exists():
        return None
    return resolved


def dedupe_paths(paths: list[Path]) -> list[Path]:
    """Remove duplicate paths, preserving insertion order."""
    ordered: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        normalized = normalize_any_path(path).as_posix()
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(Path(normalized))
    return ordered
