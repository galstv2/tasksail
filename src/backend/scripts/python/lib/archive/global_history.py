"""Global retrospective history record management."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..io import load_text
from ..time import current_utc_timestamp
from ._backend import get_global_retrospective_root
from .retrospective import sorted_unique_strings
from .storage import (
    global_history_storage_path,
    global_retrospective_root_path,
    read_existing_created_at,
    sidecar_record_path,
)


def collect_global_history_records(
    repo_root: Path,
) -> list[tuple[Path, dict[str, Any]]]:
    """Gather all global retrospective history records."""
    import json

    root_path = global_retrospective_root_path(repo_root)
    history_root = root_path / "history"
    records: list[tuple[Path, dict[str, Any]]] = []
    if not history_root.exists():
        return records
    for path in history_root.rglob("*.record.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if payload.get("record_type") != "global-retrospective-entry":
            continue
        records.append((path, payload))
    records.sort(
        key=lambda item: (
            str(item[1].get("indexed_at") or ""),
            str(item[1].get("task_id") or ""),
            str(item[0]),
        )
    )
    return records


def collect_recent_task_ids(
    repo_root: Path,
    max_entries: int = 30,
) -> set[str]:
    """Return task IDs from the most recent *max_entries* global history records."""
    records = collect_global_history_records(repo_root)
    recent = records[-max_entries:] if max_entries > 0 else records
    return {
        tid
        for _, payload in recent
        if (tid := str(payload.get("task_id") or "").strip())
    }


def build_global_history_entry(
    repo_root: Path,
    retrospective_markdown: str,
    retrospective_payload: dict[str, Any],
) -> tuple[str, dict[str, Any], Path, Path]:
    """Build a global history entry from a retrospective record.

    Returns ``(markdown, payload, markdown_path, record_path)``.
    """
    task_id = str(retrospective_payload.get("task_id") or "").strip()
    indexed_at = str(retrospective_payload.get("indexed_at") or current_utc_timestamp())
    year = indexed_at[:4]
    markdown_path = global_history_storage_path(repo_root, task_id, year)
    record_path = sidecar_record_path(markdown_path)
    created_at = read_existing_created_at(record_path, indexed_at)
    source_path = str(markdown_path.relative_to(repo_root))

    payload = dict(retrospective_payload)
    payload.update(
        {
            "record_id": f"global-retrospective-entry:{task_id}",
            "record_type": "global-retrospective-entry",
            "artifact_type": "global-retrospective-entry",
            "title": f"Global Retrospective History: {retrospective_payload.get('task_title')}",
            "source_path": source_path,
            "created_at": created_at,
            "updated_at": indexed_at,
            "global_retrospective_root": get_global_retrospective_root(),
            "provenance_sources": sorted_unique_strings(
                list(retrospective_payload.get("provenance_sources") or [])
                + [str(retrospective_payload.get("source_path") or "")]
            ),
            "source_artifacts": sorted_unique_strings(
                list(retrospective_payload.get("source_artifacts") or [])
                + [str(retrospective_payload.get("source_path") or "")]
            ),
        }
    )
    return retrospective_markdown, payload, markdown_path, record_path
