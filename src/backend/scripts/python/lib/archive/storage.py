"""Path resolution and data integrity helpers for task archives."""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from ..text import slugify
from ._backend import get_global_retrospective_root, get_resolve_path_within

logger = logging.getLogger(__name__)


def sidecar_record_path(markdown_path: Path) -> Path:
    """Generate the ``.record.json`` sidecar path for a markdown file."""
    return markdown_path.with_name(markdown_path.name + ".record.json")


def global_retrospective_root_path(repo_root: Path) -> Path:
    """Resolve the global retrospective root directory."""
    configured = str(get_global_retrospective_root()).strip() or "AgentWorkSpace/qmd/global/retrospectives"
    resolve_path_within = get_resolve_path_within()
    return resolve_path_within(
        repo_root,
        configured,
        "QMD_GLOBAL_RETROSPECTIVE_ROOT",
    )


def resolve_scope_path(context_pack_dir: Path, qmd_scope: str) -> Path:
    """Resolve QMD scope within a context pack directory."""
    resolve_path_within = get_resolve_path_within()
    return resolve_path_within(context_pack_dir, qmd_scope, "qmd_scope")


def archive_storage_path(
    context_pack_dir: Path,
    qmd_scope: str,
    repo_name: str,
    task_id: str,
    year: str,
) -> Path:
    """Return the storage path for a task archive JSON file."""
    del repo_name
    return task_archive_json_path(context_pack_dir, qmd_scope, year, task_id)


def task_archive_dir(
    context_pack_dir: Path,
    qmd_scope: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the canonical task archive directory for a task/year pair."""
    return (
        resolve_scope_path(context_pack_dir, qmd_scope)
        / "archive"
        / "tasks"
        / year
        / slugify(task_id)
    )


def task_archive_json_path(
    context_pack_dir: Path,
    qmd_scope: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the canonical task archive JSON path."""
    return task_archive_dir(context_pack_dir, qmd_scope, year, task_id) / "archive.json"


def task_archive_markdown_path(
    context_pack_dir: Path,
    qmd_scope: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the canonical task archive markdown path."""
    return task_archive_dir(context_pack_dir, qmd_scope, year, task_id) / "archive.md"


def task_archive_terminal_events_path(
    context_pack_dir: Path,
    qmd_scope: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the canonical task archive terminal events path."""
    return task_archive_dir(context_pack_dir, qmd_scope, year, task_id) / "terminal-events.json"


def task_archive_planner_focus_snapshot_path(
    context_pack_dir: Path,
    qmd_scope: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the canonical task archive planner-focus snapshot path."""
    return task_archive_dir(context_pack_dir, qmd_scope, year, task_id) / "planner-focus-snapshot.json"


def agent_mirror_task_archive_dir(
    repo_root: Path,
    context_pack_name: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the AgentWorkSpace mirror task archive directory."""
    return (
        repo_root
        / "AgentWorkSpace"
        / "qmd"
        / "context-packs"
        / context_pack_name
        / "archive"
        / "tasks"
        / year
        / slugify(task_id)
    )


def agent_mirror_task_archive_json_path(
    repo_root: Path,
    context_pack_name: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the AgentWorkSpace mirror task archive JSON path."""
    return agent_mirror_task_archive_dir(repo_root, context_pack_name, year, task_id) / "archive.json"


def agent_mirror_task_archive_markdown_path(
    repo_root: Path,
    context_pack_name: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the AgentWorkSpace mirror task archive markdown path."""
    return agent_mirror_task_archive_dir(repo_root, context_pack_name, year, task_id) / "archive.md"


def agent_mirror_task_archive_terminal_events_path(
    repo_root: Path,
    context_pack_name: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the AgentWorkSpace mirror terminal events path."""
    return agent_mirror_task_archive_dir(repo_root, context_pack_name, year, task_id) / "terminal-events.json"


def agent_mirror_task_archive_planner_focus_snapshot_path(
    repo_root: Path,
    context_pack_name: str,
    year: str,
    task_id: str,
) -> Path:
    """Return the AgentWorkSpace mirror planner-focus snapshot path."""
    return (
        agent_mirror_task_archive_dir(repo_root, context_pack_name, year, task_id)
        / "planner-focus-snapshot.json"
    )


def retrospective_storage_path(
    context_pack_dir: Path,
    qmd_scope: str,
    repo_name: str,
    task_id: str,
    year: str,
) -> Path:
    """Return the storage path for a retrospective markdown file."""
    return (
        resolve_scope_path(context_pack_dir, qmd_scope)
        / "archive"
        / "retrospectives"
        / repo_name
        / year
        / slugify(task_id)
        / "retrospective.md"
    )


def global_history_storage_path(
    repo_root: Path,
    task_id: str,
    year: str,
) -> Path:
    """Return the storage path for a global history markdown entry."""
    return (
        global_retrospective_root_path(repo_root)
        / "history"
        / year
        / slugify(task_id)
        / "retrospective.md"
    )


def shared_memory_storage_path(repo_root: Path) -> Path:
    """Return the storage path for the shared retrospective memory."""
    return global_retrospective_root_path(repo_root) / "shared-retrospective-memory.md"


def correction_memo_storage_path(
    context_pack_dir: Path,
    qmd_scope: str,
) -> Path:
    """Return the storage path for the behavior correction memo."""
    return (
        resolve_scope_path(context_pack_dir, qmd_scope)
        / "canonical" / "context-pack" / "behavior-correction-memo.md"
    )


def previous_correction_memo_path(
    context_pack_dir: Path,
    qmd_scope: str,
) -> Path:
    """Return the storage path for the previous cycle's correction memo."""
    base = correction_memo_storage_path(context_pack_dir, qmd_scope)
    return base.with_name(base.stem + ".previous.md")


def read_existing_created_at(path: Path, fallback: str) -> str:
    """Read ``created_at`` from an existing JSON file, or return *fallback*."""
    try:
        import json
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, FileNotFoundError):
        logger.debug("Could not read created_at from %s, using fallback", path)
        return fallback
    created_at = existing.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        return created_at.strip()
    return fallback


def detect_source_ref(repo_root: Path) -> str:
    """Return the current git HEAD SHA, or a fallback sentinel."""
    try:
        completed = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "workspace-unversioned"
    return completed.stdout.strip() or "workspace-unversioned"
