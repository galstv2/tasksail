"""Bootstrap answer normalization and type-coercion helpers."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.constants import ALLOWED_LAYERS
from src.backend.mcp.context_estate.helpers import normalize_activation_priority
from src.backend.mcp.repo_context_mcp.utils import (
    ensure_non_empty_string,
    normalize_bool,
    normalize_optional_string,
    normalize_scope_mode,
    slugify,
    titleize_segment,
    utc_now,
)


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            normalized = normalize_optional_string(item)
            if normalized:
                result.append(normalized)
        return result
    raise ValueError("Expected a string or list of strings.")


def _int(value: Any, *, default: int = 0) -> int:
    return normalize_activation_priority(value, default=default)


def _normalize_layer(value: Any) -> str:
    normalized = normalize_optional_string(value).lower() or "shared"
    if normalized not in ALLOWED_LAYERS:
        raise ValueError(f"Unsupported system_layer: {normalized}")
    return normalized


def _repo_role_for_layer(system_layer: str) -> str:
    return {
        "backend": "backend-service",
        "frontend": "frontend",
        "infrastructure": "infra",
        "database": "database",
    }.get(system_layer, "shared")


def _normalize_focus_area_overrides(value: Any) -> list[dict[str, Any]]:
    if value in (None, []):
        return []
    if not isinstance(value, list):
        raise ValueError("focusable_areas must be a list when provided")

    result: list[dict[str, Any]] = []
    for raw_area in value:
        if not isinstance(raw_area, dict):
            raise ValueError("focusable_areas entries must be objects")
        result.append(
            {
                "focus_id": normalize_optional_string(raw_area.get("focus_id") or raw_area.get("focusId")),
                "relative_path": normalize_optional_string(raw_area.get("relative_path") or raw_area.get("relativePath")),
                "path": normalize_optional_string(raw_area.get("path")),
                "focus_name": normalize_optional_string(raw_area.get("focus_name") or raw_area.get("focusName")),
                "focus_type": normalize_optional_string(raw_area.get("focus_type") or raw_area.get("focusType")),
                "group": normalize_optional_string(raw_area.get("group")),
                "default_focusable": normalize_bool(
                    raw_area.get("default_focusable") if "default_focusable" in raw_area else raw_area.get("defaultFocusable")
                ),
                "activation_priority": _int(
                    raw_area.get("activation_priority") if "activation_priority" in raw_area else raw_area.get("activationPriority"),
                    default=0,
                ),
                "adjacent_focus_area_ids": _string_list(
                    raw_area.get("adjacent_focus_area_ids")
                    or raw_area.get("adjacentFocusAreaIds")
                ),
            }
        )
    return result


def normalize_bootstrap_answers(payload: dict[str, Any]) -> dict[str, Any]:
    context_pack_id = slugify(
        ensure_non_empty_string(
            payload.get("context_pack_id") or payload.get("contextPackId"),
            "context_pack_id",
        )
    )
    estate_name = (
        normalize_optional_string(payload.get("estate_name") or payload.get("estateName"))
        or titleize_segment(context_pack_id)
    )

    raw_repositories = payload.get("repositories")
    if not isinstance(raw_repositories, list) or not raw_repositories:
        raise ValueError("Bootstrap answers require a non-empty repositories list")

    repositories: list[dict[str, Any]] = []
    for index, raw_repo in enumerate(raw_repositories):
        if not isinstance(raw_repo, dict):
            raise ValueError("Bootstrap repository entries must be objects")

        repo_root = Path(
            ensure_non_empty_string(
                raw_repo.get("repo_root")
                or raw_repo.get("repoRoot")
                or raw_repo.get("local_path")
                or raw_repo.get("localPath")
                or raw_repo.get("local_root")
                or raw_repo.get("localRoot"),
                f"repositories[{index}].repo_root",
            )
        ).expanduser().resolve()
        repo_name = normalize_optional_string(raw_repo.get("repo_name") or raw_repo.get("repoName")) or titleize_segment(
            repo_root.name
        )

        repositories.append(
            {
                "repo_id": slugify(
                    normalize_optional_string(raw_repo.get("repo_id") or raw_repo.get("repoId"))
                    or repo_name
                ),
                "repo_name": repo_name,
                "repo_root": str(repo_root),
                "owner": normalize_optional_string(raw_repo.get("owner")),
                "system_layer": _normalize_layer(raw_repo.get("system_layer") or raw_repo.get("systemLayer")),
                "languages": _string_list(raw_repo.get("languages")),
                "artifact_roots": _string_list(raw_repo.get("artifact_roots") or raw_repo.get("artifactRoots")),
                "document_paths": _string_list(raw_repo.get("document_paths") or raw_repo.get("documentPaths")),
                "bounded_context": normalize_optional_string(raw_repo.get("bounded_context") or raw_repo.get("boundedContext")),
                "service_name": normalize_optional_string(raw_repo.get("service_name") or raw_repo.get("serviceName")),
                "repo_role": normalize_optional_string(raw_repo.get("repo_role") or raw_repo.get("repoRole")),
                "repository_type": (
                    normalize_optional_string(
                        raw_repo.get("repository_type")
                        or raw_repo.get("repositoryType")
                    )
                    or ""
                ).lower()
                or None,
                "workspace_activation_group": normalize_optional_string(
                    raw_repo.get("workspace_activation_group")
                    or raw_repo.get("workspaceActivationGroup")
                ),
                "default_focusable": normalize_bool(
                    raw_repo.get("default_focusable") if "default_focusable" in raw_repo else raw_repo.get("defaultFocusable"),
                    default=index == 0,
                ),
                "activation_priority": _int(
                    raw_repo.get("activation_priority") if "activation_priority" in raw_repo else raw_repo.get("activationPriority"),
                    default=max(0, 100 - (index * 10)),
                ),
                "adjacent_repo_ids": _string_list(
                    raw_repo.get("adjacent_repo_ids") or raw_repo.get("adjacentRepoIds")
                ),
                "depends_on_repo_ids": _string_list(
                    raw_repo.get("depends_on_repo_ids") or raw_repo.get("dependsOnRepoIds")
                ),
                "used_by_repo_ids": _string_list(
                    raw_repo.get("used_by_repo_ids") or raw_repo.get("usedByRepoIds")
                ),
            }
        )

    return {
        "questionnaire_version": "context-pack-bootstrap/v1",
        "captured_at": utc_now(),
        "context_pack_id": context_pack_id,
        "estate_name": estate_name,
        "repository_count": len(repositories),
        "default_scope_mode": normalize_scope_mode(
            payload.get("default_scope_mode") or payload.get("defaultScopeMode")
        ),
        "discovery_mode": normalize_optional_string(
            payload.get("discovery_mode") or payload.get("discoveryMode")
        )
        or "auto",
        "estate_type": normalize_optional_string(payload.get("estate_type") or payload.get("estateType")),
        "primary_working_repo_ids": _string_list(
            payload.get("primary_working_repo_ids")
            or payload.get("primaryWorkingRepoIds")
        ),
        "primary_focus_area_ids": _string_list(
            payload.get("primary_focus_area_ids")
            or payload.get("primaryFocusAreaIds")
        ),
        "focusable_areas": payload.get("focusable_areas") or payload.get("focusableAreas") or [],
        "repositories": repositories,
    }
