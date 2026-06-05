"""Index writing for task archives and global retrospectives."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..locking import acquire_file_lock, release_file_lock
from ..paths import assert_safe_path_segment
from ._backend import get_global_retrospective_root, get_qmd_index_service, write_json_via_backend
from .storage import global_retrospective_root_path, resolve_scope_path


def write_archive_indexes(  # Archive-index lock: held
    context_pack_dir: Path,
    qmd_scope: str,
    payload: dict[str, Any],
    *,
    parent_record_path: Path | None,
) -> dict[str, str]:
    """Build and write task archive indexes.

    Acquires a per-context-pack file lock at ``<scope_dir>/.indexes.lock``
    before the scan+write cycle to serialise concurrent callers.

    Returns a dict mapping index names to their written file paths.
    """
    QmdIndexService = get_qmd_index_service()
    scope_dir = resolve_scope_path(context_pack_dir, qmd_scope)
    index_lock_path = scope_dir / ".indexes.lock"
    lock_fd = acquire_file_lock(index_lock_path)
    try:
        index_service = QmdIndexService(workspace_root=context_pack_dir.parent)

        tasks_index = index_service.build_global_task_index(scope_dir=scope_dir)
        lineage_index = index_service.build_top_level_lineage_index(scope_dir=scope_dir)
        repo_task_index = index_service.build_repo_task_index(
            scope_dir=scope_dir,
            repo_name=str(payload.get("repo_name") or "").strip(),
        )

        tasks_index_path = scope_dir / "indexes" / "tasks.json"
        lineage_index_path = scope_dir / "indexes" / "lineage.json"
        repo_task_index_path = (
            scope_dir
            / "archive"
            / "indexes"
            / "by-repo"
            / str(payload.get("repo_name") or "").strip()
            / "tasks.json"
        )
        write_json_via_backend(tasks_index_path, tasks_index)
        write_json_via_backend(lineage_index_path, lineage_index)
        write_json_via_backend(repo_task_index_path, repo_task_index)

        written_paths = {
            "tasks_index": str(tasks_index_path),
            "lineage_index": str(lineage_index_path),
            "repo_task_index": str(repo_task_index_path),
        }

        root_task_id = str(payload.get("root_task_id") or "").strip()
        if root_task_id:
            root_lineage_index = index_service.build_root_lineage_index(
                scope_dir=scope_dir,
                root_task_id=root_task_id,
            )
            root_lineage_index_path = (
                scope_dir
                / "archive"
                / "indexes"
                / "by-root-task"
                / assert_safe_path_segment(root_task_id, "root_task_id")
                / "lineage.json"
            )
            write_json_via_backend(root_lineage_index_path, root_lineage_index)
            written_paths["root_lineage_index"] = str(root_lineage_index_path)

        parent_task_id = str(payload.get("parent_task_id") or "").strip()
        if parent_task_id and parent_record_path is not None:
            parent_children_index = index_service.build_parent_children_index(
                scope_dir=scope_dir,
                parent_task_id=parent_task_id,
            )
            parent_children_index_path = (
                scope_dir
                / "archive"
                / "indexes"
                / "by-parent-task"
                / assert_safe_path_segment(parent_task_id, "parent_task_id")
                / "children.json"
            )
            write_json_via_backend(parent_children_index_path, parent_children_index)
            written_paths["parent_children_index"] = str(parent_children_index_path)

        return written_paths
    finally:
        release_file_lock(lock_fd)


def write_global_retrospective_indexes(  # Archive-index lock: inherited (shared_memory_lock_path)
    repo_root: Path,
) -> dict[str, str]:
    """Build and write the 3 global retrospective QMD indexes.

    Returns a dict mapping index names to their written file paths.
    """
    QmdIndexService = get_qmd_index_service()
    index_service = QmdIndexService(
        workspace_root=repo_root,
        global_retrospective_root=get_global_retrospective_root(),
    )
    root_path = global_retrospective_root_path(repo_root)

    history_index = index_service.build_retrospective_history_index(
        repo_root=repo_root,
    )
    action_items_index = index_service.build_retrospective_action_items_index(
        repo_root=repo_root,
    )
    theme_index = index_service.build_retrospective_theme_index(
        repo_root=repo_root,
    )

    history_index_path = root_path / "indexes" / "history.json"
    action_items_index_path = root_path / "indexes" / "action-items.json"
    theme_index_path = root_path / "indexes" / "themes.json"

    write_json_via_backend(history_index_path, history_index)
    write_json_via_backend(action_items_index_path, action_items_index)
    write_json_via_backend(theme_index_path, theme_index)
    return {
        "retrospective_history_index": str(history_index_path),
        "retrospective_action_items_index": str(action_items_index_path),
        "retrospective_theme_index": str(theme_index_path),
    }
