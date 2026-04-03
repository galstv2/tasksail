"""Parent archive lookup and update operations."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..locking import acquire_file_lock, release_file_lock
from ._backend import get_resolve_path_within, write_json_via_backend


def find_parent_archive(
    context_pack_dir: Path,
    parent_qmd_scope: str,
    parent_qmd_record_id: str,
    parent_task_id: str,
) -> tuple[Path, dict[str, Any]] | None:
    """Locate a parent archive by record ID or task ID.

    Returns ``(path, payload)`` if exactly one match is found, else ``None``.
    """
    resolve_path_within = get_resolve_path_within()
    scope_dir = resolve_path_within(
        context_pack_dir,
        parent_qmd_scope,
        "parent_qmd_scope",
    )
    if not scope_dir.exists():
        return None
    matches: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(scope_dir.rglob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("record_type") != "task-archive":
            continue
        if parent_qmd_record_id and payload.get("record_id") == parent_qmd_record_id:
            matches.append((path, payload))
            continue
        if not parent_qmd_record_id and parent_task_id and payload.get("task_id") == parent_task_id:
            matches.append((path, payload))
    if len(matches) != 1:
        return None
    return matches[0]


def append_followup_ref(record: dict[str, Any], ref: str) -> bool:
    """Add a followup reference to a record if not already present.

    Returns ``True`` if the reference was added, ``False`` if it was
    already present.
    """
    refs = record.get("followup_refs")
    if not isinstance(refs, list):
        refs = []
    normalized = [str(item).strip() for item in refs if str(item).strip()]
    if ref in normalized:
        record["followup_refs"] = normalized
        return False
    normalized.append(ref)
    record["followup_refs"] = normalized
    return True


def update_parent_archive(
    parent_path: Path,
    child_task_id: str,
    indexed_at: str,
) -> None:
    """Lock, update followup_refs, and write the parent archive."""
    lock_path = parent_path.with_suffix(".lock")
    lock_fd = acquire_file_lock(lock_path)
    try:
        parent_record = json.loads(parent_path.read_text(encoding="utf-8"))
        if append_followup_ref(parent_record, child_task_id):
            parent_record["updated_at"] = indexed_at
            write_json_via_backend(parent_path, parent_record)
    finally:
        release_file_lock(lock_fd)
