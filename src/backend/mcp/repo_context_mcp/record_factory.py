"""QMD record creation, markdown builders, path helpers, and I/O wrappers."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .file_analysis import (
    detect_artifact_type,
    detect_path_kind,
    looks_like_entrypoint,
    normalize_language,
    read_preview,
)
from .utils import (
    ensure_path_within,
    load_json,
    read_existing_created_at,
    slugify_timestamp,
    unique_preserving_order,
    write_json_atomic,
    write_text_atomic,
)

logger = logging.getLogger(__name__)


def record_storage_path(scope_dir: Path, system_layer: str, repo_id: str, source_path: str) -> Path:
    # repo_id and source_path come from the untrusted plan manifest; assert the
    # composed path stays within scope_dir so a crafted value cannot escape it.
    composed = scope_dir / "estate" / system_layer / repo_id / "records" / Path(source_path + ".json")
    ensure_path_within(scope_dir, composed, "repo_id")
    return composed


def sidecar_record_path(markdown_path: Path) -> Path:
    return markdown_path.with_name(markdown_path.name + ".record.json")


def state_file_path(scope_dir: Path, repo_id: str) -> Path:
    composed = scope_dir / "operational" / "bootstrap" / repo_id / "seed-state.json"
    ensure_path_within(scope_dir, composed, "repo_id")
    return composed


def pack_seed_state_path(scope_dir: Path) -> Path:
    """Return the path to the pack-level seed-state file.

    This is the single top-level marker for whether the pack has been
    seeded.  It is distinct from :func:`state_file_path`, which returns
    the *per-repo* state file under operational/bootstrap/<repo_id>/.
    """
    return scope_dir / "seed-state.json"


def report_file_path(scope_dir: Path, run_timestamp: str) -> Path:
    return scope_dir / "operational" / "bootstrap" / "seed-runs" / f"seed-run-{slugify_timestamp(run_timestamp)}.json"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    write_json_atomic(path, payload)


def write_text(path: Path, content: str) -> None:
    write_text_atomic(path, content)


def invalidate_record(
    record_path: Path, indexed_at: str, reason: str,
) -> dict[str, Any] | None:
    """Invalidate a record on disk and return the modified payload, or None."""
    if not record_path.exists():
        return None
    try:
        payload = load_json(record_path)
    except ValueError:
        logger.warning(
            "Cannot invalidate record with malformed JSON: %s",
            record_path,
        )
        return None
    payload["freshness_status"] = "invalidated"
    payload["invalidated_at"] = indexed_at
    payload["invalidated_reason"] = reason
    payload["updated_at"] = indexed_at
    write_json(record_path, payload)
    return payload


def build_repo_summary_markdown(
    repo: dict[str, Any],
    source_root: Path,
    source_ref: str,
    source_paths: list[str],
    warnings: list[str],
    generated_at: str,
) -> str:
    lines = [
        f"# {repo['repo_name']} Repository Summary",
        "",
        f"- Generated At: {generated_at}",
        f"- Repo ID: {repo['repo_id']}",
        f"- Source Root: {source_root}",
        f"- Source Ref: {source_ref}",
        f"- System Layer: {repo['system_layer']}",
        f"- Bounded Context: {repo.get('bounded_context') or 'unassigned'}",
        f"- Languages: {', '.join(repo.get('languages', [])) or 'none declared'}",
        f"- Seeded Artifacts: {len(source_paths)}",
        "",
        "## High-Signal Files",
        "",
    ]
    for source_path in source_paths[:20]:
        lines.append(f"- {source_path}")
    if not source_paths:
        lines.append("- none")
    if warnings:
        lines.extend(["", "## Warnings", ""])
        for warning in warnings:
            lines.append(f"- {warning}")
    lines.append("")
    return "\n".join(lines)


def build_bootstrap_note_markdown(
    repo: dict[str, Any],
    source_root: Path,
    source_ref: str,
    seeded_count: int,
    invalidated_count: int,
    warnings: list[str],
    generated_at: str,
) -> str:
    lines = [
        f"# Initial Index for {repo['repo_name']}",
        "",
        f"- Generated At: {generated_at}",
        f"- Repo ID: {repo['repo_id']}",
        f"- Source Root: {source_root}",
        f"- Source Ref: {source_ref}",
        f"- Seeded Records: {seeded_count}",
        f"- Invalidated Records: {invalidated_count}",
        f"- Context Pack Scope: {repo['qmd_scope']}",
        "",
        "This note captures the most recent live bootstrap or refresh run for this repository.",
        "",
    ]
    if warnings:
        lines.append("## Warnings")
        lines.append("")
        for warning in warnings:
            lines.append(f"- {warning}")
        lines.append("")
    return "\n".join(lines)


def create_artifact_record(
    repo: dict[str, Any],
    source_root: Path,
    source_ref: str,
    source_path: str,
    indexed_at: str,
    record_path: Path,
    preview: str | None = None,
) -> dict[str, Any]:
    path = Path(source_path)
    language = normalize_language(path)
    artifact_type = detect_artifact_type(path)
    effective_layer = "documents" if artifact_type in {"architecture-doc", "runbook"} else repo["system_layer"]
    created_at = read_existing_created_at(record_path, indexed_at)
    if preview is None:
        preview = read_preview(source_root / source_path)
    tags = unique_preserving_order(
        repo.get("tags", [])
        + [
            f"repo:{repo['repo_id']}",
            f"layer:{effective_layer}",
            f"lang:{language}",
            f"artifact:{artifact_type}",
            f"path-kind:{detect_path_kind(path)}",
        ]
    )
    return {
        "schema_version": "qmd-record/v1",
        "record_id": f"{repo['repo_id']}:{source_path}",
        "record_type": "repo-artifact",
        "title": path.name,
        "repo_name": repo["repo_name"],
        "repo_owner": repo.get("owner") or "unknown",
        "source_path": source_path,
        "system_layer": effective_layer,
        "artifact_type": artifact_type,
        "language": language,
        "bounded_context": repo.get("bounded_context") or "unassigned",
        "service_name": repo["repo_name"],
        "tags": tags,
        "context_pack_id": repo["context_pack_id"],
        "qmd_scope": repo["qmd_scope"],
        "source_ref": source_ref,
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "source",
        "provenance_sources": [f"{repo['repo_name']}:{source_path}"],
        "review_status": "unreviewed",
        "summary": preview,
        "confidence": "medium",
        "path_kind": detect_path_kind(path),
        "is_entrypoint": looks_like_entrypoint(path),
        "is_public_surface": artifact_type in {"architecture-doc", "runbook"},
        "depends_on": [],
    }


def create_summary_record(
    repo: dict[str, Any],
    source_ref: str,
    indexed_at: str,
    record_path: Path,
    source_paths: list[str],
) -> dict[str, Any]:
    created_at = read_existing_created_at(record_path, indexed_at)
    return {
        "schema_version": "qmd-record/v1",
        "record_id": f"summary:{repo['context_pack_id']}:{repo['repo_id']}",
        "record_type": "canonical-summary",
        "title": f"{repo['repo_name']} repository summary",
        "repo_name": repo["repo_name"],
        "repo_owner": repo.get("owner") or "unknown",
        "source_path": ".qmd/repo-summary.md",
        "system_layer": repo["system_layer"],
        "artifact_type": "summary",
        "language": repo.get("languages", ["mixed"])[0] if repo.get("languages") else "mixed",
        "bounded_context": repo.get("bounded_context") or "unassigned",
        "service_name": repo["repo_name"],
        "tags": unique_preserving_order(repo.get("tags", []) + [f"repo:{repo['repo_id']}", "summary:repo"]),
        "context_pack_id": repo["context_pack_id"],
        "qmd_scope": repo["qmd_scope"],
        "source_ref": source_ref,
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": [f"{repo['repo_name']}:{path}" for path in source_paths[:20]],
        "review_status": "unreviewed",
        "summary": f"Repository summary for {repo['repo_name']} covering {len(source_paths)} indexed artifacts.",
        "confidence": "medium",
        "summary_scope": "repo",
        "summary_targets": source_paths[:50],
    }


def create_bootstrap_note_record(
    repo: dict[str, Any],
    source_ref: str,
    indexed_at: str,
    record_path: Path,
    source_paths: list[str],
) -> dict[str, Any]:
    created_at = read_existing_created_at(record_path, indexed_at)
    return {
        "schema_version": "qmd-record/v1",
        "record_id": f"bootstrap:{repo['context_pack_id']}:{repo['repo_id']}",
        "record_type": "operational-note",
        "title": f"{repo['repo_name']} live seed note",
        "repo_name": repo["repo_name"],
        "repo_owner": repo.get("owner") or "unknown",
        "source_path": ".qmd/initial-index.md",
        "system_layer": repo["system_layer"],
        "artifact_type": "runbook",
        "language": "markdown",
        "bounded_context": repo.get("bounded_context") or "unassigned",
        "service_name": repo["repo_name"],
        "tags": unique_preserving_order(repo.get("tags", []) + [f"repo:{repo['repo_id']}", "bootstrap:live-seed"]),
        "context_pack_id": repo["context_pack_id"],
        "qmd_scope": repo["qmd_scope"],
        "source_ref": source_ref,
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": [f"{repo['repo_name']}:{path}" for path in source_paths[:20]],
        "review_status": "unreviewed",
        "summary": f"Latest live bootstrap note for {repo['repo_name']}.",
        "confidence": "medium",
        "environment_scope": "shared",
        "runbook_type": "maintenance",
    }
