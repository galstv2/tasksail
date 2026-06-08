"""Index-writing and conventions-memo helpers for SeedingService.

Functions receive the SeedingService instance as ``service`` (duck-typed) to
access injected callables without introducing a new class hierarchy.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .scope import resolve_path_in_context_pack

if TYPE_CHECKING:
    from .seeding_service import SeedingService

logger = logging.getLogger(__name__)


def write_scope_indexes(
    service: "SeedingService",
    *,
    context_pack_dir: Path,
    scope_dir: Path,
    plan: dict[str, Any],
    repositories: list[dict[str, Any]],
    latest_seed_run_path: str | None,
) -> dict[str, str]:
    """Build and persist the four QMD index files; return their paths."""
    service.qmd_index_service.invalidate_descriptor_cache(scope_dir)
    repository_index = service.qmd_index_service.build_repository_index(
        scope_dir=scope_dir,
        repositories=repositories,
    )
    task_index = service.qmd_index_service.build_glopml_task_index(scope_dir=scope_dir)
    lineage_index = service.qmd_index_service.build_top_level_lineage_index(scope_dir=scope_dir)
    context_pack_index = service.qmd_index_service.build_context_pack_index(
        scope_dir=scope_dir,
        repository_entries=repository_index["repositories"],
        task_entries=task_index["tasks"],
        lineage_entries=lineage_index["lineage_roots"],
        latest_seed_run_path=latest_seed_run_path,
    )

    repositories_index_path = resolve_path_in_context_pack(
        context_pack_dir,
        f"{plan['qmd_scope_root']}/indexes/repositories.json",
        "qmd_scope_root",
    )
    tasks_index_path = resolve_path_in_context_pack(
        context_pack_dir,
        f"{plan['qmd_scope_root']}/indexes/tasks.json",
        "qmd_scope_root",
    )
    lineage_index_path = resolve_path_in_context_pack(
        context_pack_dir,
        f"{plan['qmd_scope_root']}/indexes/lineage.json",
        "qmd_scope_root",
    )
    context_pack_index_path = resolve_path_in_context_pack(
        context_pack_dir,
        f"{plan['qmd_scope_root']}/indexes/context-pack-index.json",
        "qmd_scope_root",
    )

    service.write_json(context_pack_index_path, context_pack_index)
    service.write_json(repositories_index_path, repository_index)
    service.write_json(tasks_index_path, task_index)
    service.write_json(lineage_index_path, lineage_index)

    return {
        "context_pack_index": str(context_pack_index_path),
        "repositories_index": str(repositories_index_path),
        "tasks_index": str(tasks_index_path),
        "lineage_index": str(lineage_index_path),
    }


def context_pack_conventions_paths(
    service: "SeedingService",
    *,
    context_pack_dir: Path,
    plan: dict[str, Any],
) -> tuple[Path, Path]:
    """Return ``(markdown_path, record_path)`` for the conventions memo."""
    markdown_path = resolve_path_in_context_pack(
        context_pack_dir,
        (
            f"{plan['qmd_scope_root']}/canonical/context-pack/"
            "codepmse-conventions.md"
        ),
        "qmd_scope_root",
    )
    return markdown_path, service.sidecar_record_path(markdown_path)


def maybe_write_context_pack_conventions(
    service: "SeedingService",
    *,
    context_pack_dir: Path,
    plan: dict[str, Any],
    repositories: list[dict[str, Any]],
    indexed_at: str,
) -> dict[str, Any]:
    """Write the conventions memo if it does not yet exist; return status dict."""
    markdown_path, record_path = context_pack_conventions_paths(
        service,
        context_pack_dir=context_pack_dir,
        plan=plan,
    )
    result: dict[str, Any] = {
        "status": "existing",
        "markdown_path": str(markdown_path),
        "record_path": str(record_path),
    }

    if markdown_path.exists() or record_path.exists():
        result["reason"] = "Context-pack conventions memo already exists."
        return result

    if not repositories:
        result["status"] = "deferred"
        result["reason"] = (
            "Conventions memo generation is deferred until at least one "
            "repository seeds successfully."
        )
        return result

    if not any(repo.get("source_paths") for repo in repositories):
        result["status"] = "insufficient-inputs"
        result["reason"] = (
            "Conventions memo generation was skipped because no bounded "
            "source paths were observed in the successful seed inputs."
        )
        return result

    markdown = service.build_context_pack_conventions_markdown(
        context_pack_id=plan["context_pack_id"],
        repositories=repositories,
        generated_at=indexed_at,
    )
    service.write_text(markdown_path, markdown)
    record = service.create_context_pack_conventions_record(
        context_pack_id=plan["context_pack_id"],
        qmd_scope=plan["qmd_scope_root"],
        indexed_at=indexed_at,
        record_path=record_path,
        repositories=repositories,
    )
    service.write_json(record_path, record)
    result["status"] = "created"
    result["reason"] = (
        "Context-pack conventions memo was created from the first "
        "successful live seed inputs."
    )
    return result
