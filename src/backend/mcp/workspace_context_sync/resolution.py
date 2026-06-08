"""Distributed and monolith scope resolution for workspace context sync.

Extracted from WorkspaceContextSyncService to keep the main service module
under the 500-line limit.  All functions are stateless — they accept the
data they need rather than reading instance attributes.
"""
from __future__ import annotations

from typing import Any

from src.backend.mcp.repo_context_mcp.utils import (
    ensure_non_empty_string,
    unique_preserving_order,
)


def resolve_distributed_repo_selection(
    repositories: list[Any],
    *,
    selected_repo_order: list[str],
    primary_working_repo_ids: list[str],
) -> tuple[list[str], set[str]]:
    """Resolve which repos should be activated in a distributed estate."""
    ordered_repositories = [
        repo for repo in repositories if isinstance(repo, dict)
    ]

    effective_selected_repo_ids = (
        selected_repo_order
        if selected_repo_order
        else [
            select_default_distributed_repo_id(
                ordered_repositories,
                primary_working_repo_ids,
            )
        ]
    )
    effective_selected_repo_ids = [
        repo_id
        for repo_id in effective_selected_repo_ids
        if repo_id
    ]

    if not effective_selected_repo_ids:
        raise ValueError(
            "Distributed focused activation requires at least one repo "
            "declared in the manifest"
        )

    return effective_selected_repo_ids, set(effective_selected_repo_ids)


def select_default_distributed_repo_id(
    repositories: list[dict[str, Any]],
    primary_working_repo_ids: list[str],
) -> str:
    """Pick the best default repo for a distributed estate activation."""
    known_repo_ids = {
        ensure_non_empty_string(repo.get("repo_id"), "repo_id")
        for repo in repositories
    }
    for repo_id in primary_working_repo_ids:
        if repo_id in known_repo_ids:
            return repo_id

    ranked_repositories = sorted(
        repositories,
        key=lambda repo: (
            not bool(repo.get("default_focusable")),
            -int(repo.get("activation_priority") or 0),
            str(
                repo.get("service_name")
                or repo.get("repo_name")
                or repo.get("repo_id")
                or ""
            ),
        ),
    )
    if not ranked_repositories:
        return ""
    return ensure_non_empty_string(
        ranked_repositories[0].get("repo_id"),
        "repo_id",
    )


def resolve_monolith_focus_selection(
    manifest: dict[str, Any],
    *,
    selected_focus_ids: list[str],
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Resolve which focus areas should be activated in a monolith estate."""
    focusable_areas = manifest.get("focusable_areas")
    if not isinstance(focusable_areas, list) or not focusable_areas:
        raise ValueError(
            "Monolith manifest requires a non-empty focusable_areas list"
        )

    focus_area_by_id: dict[str, dict[str, Any]] = {}
    for raw_area in focusable_areas:
        if not isinstance(raw_area, dict):
            raise ValueError(
                "Manifest focusable_areas entries must be JSON objects"
            )
        focus_id = ensure_non_empty_string(
            raw_area.get("focus_id"),
            "focus_id",
        )
        focus_area_by_id[focus_id] = raw_area

    unknown_focus_ids = sorted(
        set(selected_focus_ids) - set(focus_area_by_id)
    )
    if unknown_focus_ids:
        raise ValueError(
            "Selected focus ids are not declared in the manifest: "
            + ", ".join(unknown_focus_ids)
        )
    if selected_focus_ids:
        return selected_focus_ids, focus_area_by_id

    primary_focus_ids = unique_preserving_order(
        [str(item) for item in manifest.get("primary_focus_area_ids", [])]
    )
    for focus_id in primary_focus_ids:
        if focus_id in focus_area_by_id:
            return [focus_id], focus_area_by_id

    ranked_focus_areas = sorted(
        focus_area_by_id.values(),
        key=lambda area: (
            not bool(area.get("default_focusable")),
            -int(area.get("activation_priority") or 0),
            str(
                area.get("focus_name")
                or area.get("relative_path")
                or area.get("focus_id")
                or ""
            ),
        ),
    )
    if not ranked_focus_areas:
        return [], focus_area_by_id
    return [
        ensure_non_empty_string(
            ranked_focus_areas[0].get("focus_id"),
            "focus_id",
        )
    ], focus_area_by_id
