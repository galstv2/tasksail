"""Context-pack conventions loading, rendering, and record creation
extracted from app.py (slice 01)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ..config import RepoContextConfig
from ..utils import (
    load_json,
    read_existing_created_at,
    resolve_path,
    resolve_path_within,
    unique_preserving_order,
)
from .discovery_service import (
    _build_backend_signal_lines,
    _build_ui_standards_lines,
    _collect_declared_values,
    _collect_sample_paths,
    _find_path_patterns,
    _find_per_repo_test_infrastructure,
    _format_declared_list,
)

logger = logging.getLogger(__name__)

_DEFAULT_MANIFEST = RepoContextConfig.from_env().default_manifest


def _resolve_context_pack_runtime_dir(context_pack_dir: str) -> Path:
    workspace_root = Path.cwd()
    raw_path = Path(context_pack_dir)
    if raw_path.is_absolute():
        return resolve_path(workspace_root, context_pack_dir)
    return resolve_path_within(
        workspace_root,
        context_pack_dir,
        "context_pack_dir",
    )


def _context_pack_conventions_scope(
    context_pack_path: Path,
) -> tuple[str, str, Path]:
    manifest_path = context_pack_path / _DEFAULT_MANIFEST
    context_pack_id = context_pack_path.name
    qmd_scope = f"qmd/context-packs/{context_pack_id}"
    if manifest_path.exists():
        manifest = load_json(manifest_path)
        context_pack_id = (
            str(manifest.get("context_pack_id") or context_pack_id).strip()
            or context_pack_id
        )
        qmd_scope = (
            str(
                manifest.get("qmd_scope_root")
                or f"qmd/context-packs/{context_pack_id}"
            ).strip()
            or f"qmd/context-packs/{context_pack_id}"
        )
    scope_dir = resolve_path_within(
        context_pack_path,
        qmd_scope,
        "qmd_scope_root",
    )
    return (
        context_pack_id,
        scope_dir.relative_to(context_pack_path).as_posix(),
        scope_dir,
    )


def _infer_conventions_summary_status(scope_dir: Path) -> str:
    markdown_path = (
        scope_dir
        / "canonical"
        / "context-pack"
        / "codebase-conventions.md"
    )
    record_path = markdown_path.with_name(
        "codebase-conventions.md.record.json"
    )
    if markdown_path.exists() or record_path.exists():
        return "available"

    context_pack_index_path = scope_dir / "indexes" / "context-pack-index.json"
    if context_pack_index_path.exists():
        try:
            payload = load_json(context_pack_index_path)
        except ValueError:
            logger.warning("Failed to load context-pack index at %s", context_pack_index_path)
            payload = {}
        status = str(payload.get("conventions_summary_status") or "").strip()
        if status:
            return status

    repositories_index_path = scope_dir / "indexes" / "repositories.json"
    if repositories_index_path.exists():
        try:
            repositories_index = load_json(repositories_index_path)
        except ValueError:
            logger.warning("Failed to load repositories index at %s", repositories_index_path)
            repositories_index = {}
        repositories = repositories_index.get("repositories")
        if isinstance(repositories, list):
            seeded_count = sum(
                1
                for repo in repositories
                if str(
                    repo.get("seed_status") or repo.get("status") or ""
                ).strip()
                == "seeded"
            )
            return "missing" if seeded_count > 0 else "deferred"

    return "deferred"


def _conventions_summary_reason(status: str) -> str:
    if status == "available":
        return "Context-pack conventions memo is available."
    if status == "missing":
        return (
            "Context-pack seed data exists, but no conventions memo is present "
            "yet."
        )
    return (
        "Conventions memo generation is deferred until a repository seeds "
        "successfully."
    )


def load_context_pack_conventions_summary(
    *,
    context_pack_dir: str,
) -> dict[str, Any]:
    context_pack_path = _resolve_context_pack_runtime_dir(context_pack_dir)
    context_pack_id, qmd_scope, scope_dir = _context_pack_conventions_scope(
        context_pack_path
    )
    conventions_summary_path = (
        f"{qmd_scope}/canonical/context-pack/codebase-conventions.md"
    )
    conventions_summary_record_path = (
        f"{conventions_summary_path}.record.json"
    )
    markdown_path = (
        scope_dir
        / "canonical"
        / "context-pack"
        / "codebase-conventions.md"
    )
    record_path = markdown_path.with_name(
        "codebase-conventions.md.record.json"
    )
    status = _infer_conventions_summary_status(scope_dir)

    summary: dict[str, Any] = {
        "context_pack_id": context_pack_id,
        "context_pack_dir": str(context_pack_path),
        "qmd_scope": qmd_scope,
        "conventions_summary_status": status,
        "conventions_summary_path": conventions_summary_path,
        "conventions_summary_record_path": conventions_summary_record_path,
        "conventions_summary_reason": _conventions_summary_reason(status),
        "conventions_summary_markdown": "",
        "conventions_summary_record": None,
    }

    if markdown_path.exists():
        summary["conventions_summary_markdown"] = markdown_path.read_text(
            encoding="utf-8"
        )

    if record_path.exists():
        try:
            summary["conventions_summary_record"] = load_json(record_path)
        except ValueError as exc:
            summary["conventions_summary_record_error"] = str(exc)

    record = summary.get("conventions_summary_record")
    if isinstance(record, dict):
        if "testing_infrastructure_detected" in record:
            summary["testing_infrastructure_detected"] = bool(
                record["testing_infrastructure_detected"]
            )
        if isinstance(record.get("testing_infrastructure_per_repo"), dict):
            summary["testing_infrastructure_per_repo"] = (
                record["testing_infrastructure_per_repo"]
            )

    summary["rendered_summary_markdown"] = (
        render_context_pack_conventions_summary(summary)
    )
    return summary


def render_context_pack_conventions_summary(summary: dict[str, Any]) -> str:
    markdown = str(summary.get("conventions_summary_markdown") or "")
    if markdown.strip():
        return markdown

    lines = [
        "# Context-Pack Conventions Summary",
        "",
        f"- Context Pack ID: {summary.get('context_pack_id') or 'unknown'}",
        f"- QMD Scope: {summary.get('qmd_scope') or ''}",
        (
            "- Status: "
            + str(summary.get("conventions_summary_status") or "unknown")
        ),
        (
            "- Summary Path: "
            + str(summary.get("conventions_summary_path") or "")
        ),
        (
            "- Reason: "
            + str(summary.get("conventions_summary_reason") or "")
        ),
        "",
    ]
    return "\n".join(lines)


def _context_pack_estate_shape(repositories: list[dict[str, Any]]) -> str:
    return "distributed-estate" if len(repositories) > 1 else "monolith-estate"


def build_context_pack_conventions_markdown(
    context_pack_id: str,
    repositories: list[dict[str, Any]],
    generated_at: str,
) -> str:
    languages = _collect_declared_values(repositories, "languages")
    system_layers = _collect_declared_values(repositories, "system_layer")
    bounded_contexts = _collect_declared_values(
        repositories,
        "bounded_context",
    )
    service_names = _collect_declared_values(repositories, "service_name")
    repo_roles = _collect_declared_values(repositories, "repo_role")
    framework_signals = [
        tag
        for tag in _collect_declared_values(repositories, "tags")
        if tag.lower().startswith("framework:")
    ]
    path_patterns = _find_path_patterns(repositories)
    ui_standards_lines = _build_ui_standards_lines(repositories)
    backend_signal_lines = _build_backend_signal_lines(repositories)
    warnings = unique_preserving_order(
        [
            str(warning).strip()
            for repo in repositories
            for warning in (repo.get("warnings") or [])
            if str(warning).strip()
        ]
    )

    lines = [
        f"# {context_pack_id} Codebase Conventions",
        "",
        f"- Generated At: {generated_at}",
        f"- Context Pack ID: {context_pack_id}",
        f"- Repository Count: {len(repositories)}",
        f"- Estate Shape: {_context_pack_estate_shape(repositories)}",
        (
            "- Declared Languages: "
            + _format_declared_list(languages, "none declared")
        ),
        (
            "- System Layers: "
            + _format_declared_list(system_layers, "shared")
        ),
        "",
        "## Architectural Shape",
        "",
        (
            "- Bounded contexts appear to center on: "
            + _format_declared_list(bounded_contexts, "unassigned")
            + "."
        ),
        (
            "- Service and subsystem naming signals include: "
            + _format_declared_list(service_names, "no explicit service names")
            + "."
        ),
        (
            "- Declared repo-role signals: "
            + _format_declared_list(repo_roles, "none declared")
            + "."
        ),
        (
            "- Framework and stack signals: "
            + _format_declared_list(
                framework_signals,
                "no explicit framework tags",
            )
            + "."
        ),
        "",
        "## Coding and Layout Signals",
        "",
        (
            "- Common top-level working areas include: "
            + _format_declared_list(
                path_patterns["top_level_areas"],
                "no bounded source layout declared yet",
            )
            + "."
        ),
        (
            "- Test placement signals include: "
            + _format_declared_list(
                path_patterns["test_patterns"],
                "no consistent test paths observed in the bounded sample",
            )
            + "."
        ),
        (
            "- Configuration surfaces include: "
            + _format_declared_list(
                path_patterns["config_patterns"],
                "no configuration files surfaced in the bounded sample",
            )
            + "."
        ),
        (
            "- Documentation surfaces include: "
            + _format_declared_list(
                path_patterns["doc_patterns"],
                "no documentation paths surfaced in the bounded sample",
            )
            + "."
        ),
    ]

    if ui_standards_lines:
        lines.extend(["", *ui_standards_lines])

    if backend_signal_lines:
        lines.extend(["", *backend_signal_lines])

    per_repo_tests = _find_per_repo_test_infrastructure(repositories)

    lines.extend(["", "## Repository Coverage", ""])

    for repo in repositories[:8]:
        repo_name = str(
            repo.get("repo_name") or repo.get("repo_id") or "unknown"
        )
        repo_id = str(repo.get("repo_id") or repo_name)
        layer = str(repo.get("system_layer") or "shared")
        repo_languages = _format_declared_list(
            _collect_declared_values([repo], "languages"),
            "none declared",
        )
        bounded_context = str(repo.get("bounded_context") or "unassigned")
        test_label = (
            "has test infrastructure"
            if per_repo_tests.get(repo_id, False)
            else "no test infrastructure detected"
        )
        lines.append(
            "- "
            + f"{repo_name} ({repo_id}) uses layer {layer}, "
            + f"declares {repo_languages}, "
            + f"maps to context {bounded_context}, "
            + f"{test_label}."
        )
    if not repositories:
        lines.append("- none")
    if len(repositories) > 8:
        lines.append(
                "- Additional repositories omitted from this concise memo: "
                + f"{len(repositories) - 8}."
        )

    if warnings:
        lines.extend(["", "## Warnings and Caveats", ""])
        for warning in warnings[:10]:
            lines.append(f"- {warning}")
        if len(warnings) > 10:
            lines.append(
                f"- Additional warnings omitted: {len(warnings) - 10}."
            )

    lines.append("")
    return "\n".join(lines)


def create_context_pack_conventions_record(
    context_pack_id: str,
    qmd_scope: str,
    indexed_at: str,
    record_path: Path,
    repositories: list[dict[str, Any]],
) -> dict[str, Any]:
    created_at = read_existing_created_at(record_path, indexed_at)
    repo_ids = unique_preserving_order(
        [
            str(repo.get("repo_id") or repo.get("repo_name") or "").strip()
            for repo in repositories
            if str(repo.get("repo_id") or repo.get("repo_name") or "").strip()
        ]
    )
    provenance_sources: list[str] = []
    for repo in repositories:
        repo_id = str(
            repo.get("repo_id") or repo.get("repo_name") or ""
        ).strip()
        if repo_id:
            provenance_sources.append(f"repo:{repo_id}")
        for source_path in _collect_sample_paths(repo)[:3]:
            provenance_sources.append(
                f"{repo_id or context_pack_id}:{source_path}"
            )
    provenance_sources = unique_preserving_order(provenance_sources)[:20]

    source_refs = unique_preserving_order(
        [
            str(repo.get("source_ref") or "").strip()
            for repo in repositories
            if str(repo.get("source_ref") or "").strip()
        ]
    )
    source_ref = source_refs[0] if len(source_refs) == 1 else "multiple-repos"

    path_patterns = _find_path_patterns(repositories)
    testing_infrastructure_detected = bool(path_patterns["test_patterns"])
    testing_infrastructure_per_repo = _find_per_repo_test_infrastructure(
        repositories,
    )

    return {
        "schema_version": "qmd-record/v1",
        "record_id": f"summary:{context_pack_id}:context-pack-conventions",
        "record_type": "canonical-summary",
        "title": f"{context_pack_id} codebase conventions",
        "repo_name": context_pack_id,
        "repo_owner": context_pack_id,
        "source_path": ".qmd/codebase-conventions.md",
        "system_layer": "shared",
        "artifact_type": "summary",
        "language": "markdown",
        "bounded_context": "context-pack",
        "service_name": context_pack_id,
        "tags": unique_preserving_order(
            [
                "summary:context-pack-style",
                "summary:context-pack",
                f"context-pack:{context_pack_id}",
            ]
            + [f"repo:{repo_id}" for repo_id in repo_ids[:10]]
        ),
        "context_pack_id": context_pack_id,
        "qmd_scope": qmd_scope,
        "source_ref": source_ref,
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": provenance_sources,
        "review_status": "unreviewed",
        "summary": (
            f"High-level codebase conventions memo for {context_pack_id} "
            f"covering {len(repo_ids)} repositories."
        ),
        "confidence": "medium",
        "summary_scope": "context-pack",
        "summary_targets": repo_ids[:50],
        "testing_infrastructure_detected": testing_infrastructure_detected,
        "testing_infrastructure_per_repo": testing_infrastructure_per_repo,
    }
