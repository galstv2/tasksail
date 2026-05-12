"""Plan construction and loading helpers for SeedingService.

Extracted from seeding_service.py (Phase 6 Gate G1).  These functions hold
the ``build_plan`` / ``load_plan`` / ``get_live_plan`` logic that was
previously on the class.  They receive ``normalize_repo_entry`` as an
explicit parameter so the injection contract is preserved.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from src.backend.mcp.pack_constants import qmd_scope_root_for
from src.backend.mcp.pack_schemas import validate_plan as _validate_plan_schema
from src.backend.mcp.path_resolution import ContainerPathMissing

from ..utils import ensure_non_empty_string, load_json
from .scope import normalize_qmd_scope_root

logger = logging.getLogger(__name__)


def build_plan(
    context_pack_dir: Path,
    manifest_path: Path,
    *,
    normalize_repo_entry: Callable[[Path, dict[str, Any], str], dict[str, Any]],
) -> dict[str, Any]:
    """Build a live-seed plan from the manifest at *manifest_path*."""
    manifest = load_json(manifest_path)
    context_pack_id = ensure_non_empty_string(
        manifest.get("context_pack_id") or context_pack_dir.name,
        "context_pack_id",
    )
    qmd_scope_root = ensure_non_empty_string(
        manifest.get("qmd_scope_root") or qmd_scope_root_for(context_pack_id),
        "qmd_scope_root",
    )
    qmd_scope_root = normalize_qmd_scope_root(context_pack_dir, qmd_scope_root)
    repositories = manifest.get("repositories")
    if not isinstance(repositories, list) or not repositories:
        raise ValueError("Manifest requires a non-empty 'repositories' list")

    repo_plans: list[dict[str, Any]] = []
    seen_repo_ids: set[str] = set()
    for raw_entry in repositories:
        if not isinstance(raw_entry, dict):
            raise ValueError("Each repository entry must be a JSON object")
        try:
            normalized = normalize_repo_entry(
                context_pack_dir,
                raw_entry,
                qmd_scope_root,
            )
        except ContainerPathMissing as exc:
            repo_id = str(
                raw_entry.get("repo_id") or raw_entry.get("repo_name") or "unknown"
            )
            repo_name = str(
                raw_entry.get("repo_name") or raw_entry.get("repo_id") or "unknown"
            )
            logger.warning(
                "seeding.container-path-missing",
                extra={
                    "event": "seeding.container-path-missing",
                    "repo_id": repo_id,
                    "host": exc.host,
                    "manifest_path": str(manifest_path),
                    "remediation": "Run `pnpm run upgrade-pack-schema` on this pack.",
                },
            )
            normalized = {
                "repo_id": repo_id,
                "repo_name": repo_name,
                "owner": None,
                "bounded_context": None,
                "system_layer": "shared",
                "languages": [],
                "tags": [],
                "existing_roots": [],
                "missing_roots": [exc.host],
                "scan_targets": [],
                "qmd_targets": {},
                "status": "blocked",
                "warnings": [],
                "errors": [str(exc)],
                "source_root": exc.host,
            }
        repo_id = normalized["repo_id"]
        if repo_id in seen_repo_ids:
            raise ValueError(
                f"Duplicate repository repo_id detected in manifest: {repo_id}"
            )
        seen_repo_ids.add(repo_id)
        repo_plans.append(normalized)

    warning_count = sum(len(repo["warnings"]) for repo in repo_plans)
    ready_count = sum(1 for repo in repo_plans if repo["status"] == "ready")
    blocked_count = sum(1 for repo in repo_plans if repo["status"] == "blocked")

    return {
        "plan_type": "qmd-seeding-live-input",
        "plan_version": "qmd-seeding-live-input/v1",
        "context_pack_id": context_pack_id,
        "context_pack_dir": str(context_pack_dir),
        "manifest_path": str(manifest_path),
        "qmd_scope_root": qmd_scope_root,
        "repository_count": len(repo_plans),
        "ready_count": ready_count,
        "blocked_count": blocked_count,
        "warning_count": warning_count,
        "repositories": repo_plans,
    }


def load_plan(plan_path: Path) -> dict[str, Any]:
    """Load and schema-validate an existing dry-run plan file."""
    plan = load_json(plan_path)
    _validate_plan_schema(plan, path=str(plan_path))
    repositories = plan.get("repositories")
    if not isinstance(repositories, list) or not repositories:
        raise ValueError("Plan file requires a non-empty 'repositories' list")
    return plan


def get_live_plan(
    context_pack_dir: Path,
    manifest_path: Path,
    plan_path: Path,
    plan_mode: str,
    *,
    normalize_repo_entry: Callable[[Path, dict[str, Any], str], dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    """Return ``(plan, plan_source)`` using the appropriate loading strategy."""
    if plan_mode in {"prefer-plan", "require-plan"} and plan_path.exists():
        plan = load_plan(plan_path)
        plan["qmd_scope_root"] = normalize_qmd_scope_root(
            context_pack_dir,
            ensure_non_empty_string(plan.get("qmd_scope_root"), "qmd_scope_root"),
        )
        return plan, "dry-run-plan"
    if plan_mode == "require-plan":
        raise ValueError(
            f"Approved dry-run plan is required but missing: {plan_path}"
        )
    return (
        build_plan(
            context_pack_dir,
            manifest_path,
            normalize_repo_entry=normalize_repo_entry,
        ),
        "manifest",
    )
