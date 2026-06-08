"""Heavy normalization functions for manifest approval.

These are the internal helpers called by ``manifest.build_approved_manifest``
to normalize distributed repositories, monolith repositories, and focusable
areas against their draft-discovered candidates.
"""
from __future__ import annotations

from typing import Any

from src.backend.mcp.context_estate.constants import (
    ALLOWED_FOCUS_TYPES,
    ALLOWED_REPO_ROLES,
    DEFAULT_REPOSITORY_TYPE,
    REPOSITORY_TYPES,
)
from src.backend.mcp.context_estate.helpers import (
    FOCUS_KEY_FIELDS,
    REPO_KEY_FIELDS,
    build_candidate_map,
    normalize_activation_priority,
    resolve_candidate,
)
from src.backend.mcp.pack.constants import ALLOWED_REPO_CATEGORIES
from src.backend.mcp.probes.git_roots import local_path_entry
from src.backend.mcp.repo_context_mcp.utils import (
    ensure_non_empty_string,
    normalize_bool,
    normalize_layer,
    normalize_optional_string,
    normalize_string_list,
    unique_preserving_order,
)


def _normalize_repo_role(value: Any) -> str:
    normalized = normalize_optional_string(value)
    if not normalized:
        return ""
    if normalized not in ALLOWED_REPO_ROLES:
        raise ValueError(f"Unsupported repo_role: {normalized}")
    return normalized


def _normalize_repository_type(
    value: Any,
    *,
    default: str | None = None,
) -> str | None:
    normalized = normalize_optional_string(value)
    if not normalized:
        return default
    if normalized not in REPOSITORY_TYPES:
        return DEFAULT_REPOSITORY_TYPE
    return normalized


def _normalize_repo_category(value: Any) -> str | None:
    normalized = normalize_optional_string(value)
    if not normalized:
        return None
    if normalized not in ALLOWED_REPO_CATEGORIES:
        return "unknown"
    return normalized


def _is_authored_repository_type(raw_repo: dict[str, Any]) -> bool:
    marker = raw_repo.get("repository_type_authored")
    if marker is None:
        marker = raw_repo.get("_authored_repository_type")
    if marker is None:
        # Absent marker means the value was system-derived (probe/discovery), not
        # operator-authored. Defaulting to authored=True caused spurious manifest
        # rejections when a derived repository_type disagreed with primary IDs.
        return False
    return normalize_bool(marker, default=False)


def _normalize_focus_type(value: Any) -> str:
    normalized = normalize_optional_string(value)
    if not normalized:
        return "general"
    if normalized not in ALLOWED_FOCUS_TYPES:
        raise ValueError(f"Unsupported focus_type: {normalized}")
    return normalized


def _normalize_distributed_repositories(
    repositories: Any,
    draft_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(repositories, list) or not repositories:
        raise ValueError(
            "Approved distributed manifest requires a non-empty "
            "repositories list"
        )

    candidate_map = build_candidate_map(
        draft_payload.get("candidate_repos", []),
        REPO_KEY_FIELDS,
    )
    approved_entries: list[dict[str, Any]] = []
    seen_repo_ids: set[str] = set()

    for raw_repo in repositories:
        if not isinstance(raw_repo, dict):
            raise ValueError(
                "Approved repository entries must be JSON objects"
            )
        candidate = resolve_candidate(
            raw_repo,
            candidate_map,
            REPO_KEY_FIELDS,
            error_label="distributed repository entry",
        )
        repo_id = ensure_non_empty_string(
            raw_repo.get("repo_id") or candidate.get("repo_id"),
            "repo_id",
        )
        if repo_id in seen_repo_ids:
            raise ValueError(f"Duplicate approved repo_id: {repo_id}")
        seen_repo_ids.add(repo_id)

        repo_name = ensure_non_empty_string(
            raw_repo.get("repo_name") or candidate.get("repo_name"),
            "repo_name",
        )
        repo_entry: dict[str, Any] = {
            "repo_id": repo_id,
            "repo_name": repo_name,
            "local_paths": [local_path_entry(
                ensure_non_empty_string(candidate.get("path"), "path")
            )],
            "system_layer": normalize_layer(raw_repo.get("system_layer")),
        }

        optional_list_fields = {
            "languages": normalize_string_list(raw_repo.get("languages")),
            "artifact_roots": normalize_string_list(
                raw_repo.get("artifact_roots")
            ),
            "document_paths": normalize_string_list(
                raw_repo.get("document_paths")
            ),
            "depends_on_repo_ids": normalize_string_list(
                raw_repo.get("depends_on_repo_ids")
            ),
            "used_by_repo_ids": normalize_string_list(
                raw_repo.get("used_by_repo_ids")
            ),
            "adjacent_repo_ids": normalize_string_list(
                raw_repo.get("adjacent_repo_ids")
            ),
            "exposes_services": normalize_string_list(
                raw_repo.get("exposes_services")
            ),
            "consumes_services": normalize_string_list(
                raw_repo.get("consumes_services")
            ),
            "owns_domains": normalize_string_list(
                raw_repo.get("owns_domains")
            ),
            "integration_points": normalize_string_list(
                raw_repo.get("integration_points")
            ),
        }
        for field_name, values in optional_list_fields.items():
            if values:
                repo_entry[field_name] = unique_preserving_order(values)

        optional_string_fields = {
            "owner": raw_repo.get("owner"),
            "bounded_context": raw_repo.get("bounded_context"),
            "service_name": raw_repo.get("service_name"),
            "workspace_activation_group": raw_repo.get(
                "workspace_activation_group"
            ),
        }
        for field_name, raw_value in optional_string_fields.items():
            normalized = normalize_optional_string(raw_value)
            if normalized:
                repo_entry[field_name] = normalized

        repo_role = _normalize_repo_role(raw_repo.get("repo_role"))
        if repo_role:
            repo_entry["repo_role"] = repo_role

        repo_entry["default_focusable"] = normalize_bool(
            raw_repo.get("default_focusable"),
            default=False,
        )
        if "activation_priority" in raw_repo:
            repo_entry["activation_priority"] = normalize_activation_priority(
                raw_repo["activation_priority"]
            )
        repository_type = _normalize_repository_type(
            raw_repo.get("repository_type")
        )
        if repository_type is not None:
            repo_entry["repository_type"] = repository_type
            repo_entry["_authored_repository_type"] = _is_authored_repository_type(raw_repo)

        repo_focus = _normalize_repository_type(raw_repo.get("repo_focus"))
        if repo_focus is not None:
            repo_entry["repo_focus"] = repo_focus
        if raw_repo.get("repo_focus_authored") is not None:
            repo_entry["repo_focus_authored"] = normalize_bool(
                raw_repo.get("repo_focus_authored"),
                default=False,
            )
        repo_category = _normalize_repo_category(raw_repo.get("repo_category"))
        if repo_category is not None:
            repo_entry["repo_category"] = repo_category
        if raw_repo.get("repo_category_authored") is not None:
            repo_entry["repo_category_authored"] = normalize_bool(
                raw_repo.get("repo_category_authored"),
                default=False,
            ) and repo_category is not None

        approved_entries.append(repo_entry)

    from src.backend.mcp.context_estate.helpers import _normalize_repo_id_list

    known_repo_ids = {entry["repo_id"] for entry in approved_entries}
    for entry in approved_entries:
        for field_name in (
            "depends_on_repo_ids",
            "used_by_repo_ids",
            "adjacent_repo_ids",
        ):
            if field_name in entry:
                entry[field_name] = _normalize_repo_id_list(
                    entry[field_name],
                    known_repo_ids,
                )

    approved_entries.sort(key=lambda item: item["repo_id"])
    return approved_entries


def _normalize_monolith_repository(
    repository: Any,
    draft_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(repository, dict):
        raise ValueError(
            "Approved monolith manifest requires a repository object"
        )

    repo_id = ensure_non_empty_string(repository.get("repo_id"), "repo_id")
    repo_name = ensure_non_empty_string(
        repository.get("repo_name"),
        "repo_name",
    )
    root_path = ensure_non_empty_string(
        draft_payload.get("root_path"),
        "root_path",
    )

    repo_entry: dict[str, Any] = {
        "repo_id": repo_id,
        "repo_name": repo_name,
        "local_paths": [local_path_entry(root_path)],
        "system_layer": normalize_layer(repository.get("system_layer")),
    }

    for field_name in (
        "owner",
        "bounded_context",
        "service_name",
    ):
        normalized = normalize_optional_string(repository.get(field_name))
        if normalized:
            repo_entry[field_name] = normalized

    for field_name in ("languages", "artifact_roots", "document_paths"):
        normalized_values = normalize_string_list(repository.get(field_name))
        if normalized_values:
            repo_entry[field_name] = normalized_values

    repo_entry["default_focusable"] = True
    repository_type = _normalize_repository_type(repository.get("repository_type"))
    if repository_type is not None:
        repo_entry["repository_type"] = repository_type
        repo_entry["_authored_repository_type"] = True

    repo_focus = _normalize_repository_type(repository.get("repo_focus"))
    if repo_focus is not None:
        repo_entry["repo_focus"] = repo_focus
    if repository.get("repo_focus_authored") is not None:
        repo_entry["repo_focus_authored"] = normalize_bool(
            repository.get("repo_focus_authored"),
            default=False,
        )
    repo_category = _normalize_repo_category(repository.get("repo_category"))
    if repo_category is not None:
        repo_entry["repo_category"] = repo_category
    if repository.get("repo_category_authored") is not None:
        repo_entry["repo_category_authored"] = normalize_bool(
            repository.get("repo_category_authored"),
            default=False,
        ) and repo_category is not None

    return [repo_entry]


def _normalize_monolith_extra_repositories(
    repositories: Any,
    seen_repo_ids: set[str],
) -> list[dict[str, Any]]:
    """Normalize infrastructure repos accompanying a monolith.

    These repos are created brand-new at context-pack creation time (via
    `git init` at sibling paths) and have no discovery candidate to resolve
    against, so the entry is shaped directly from the review payload.
    """
    if not repositories:
        return []
    if not isinstance(repositories, list):
        raise ValueError(
            "Approved monolith manifest 'repositories' must be a list"
        )

    normalized: list[dict[str, Any]] = []
    for raw_repo in repositories:
        if not isinstance(raw_repo, dict):
            raise ValueError(
                "Monolith infrastructure repository entries must be JSON objects"
            )
        repo_id = ensure_non_empty_string(raw_repo.get("repo_id"), "repo_id")
        if repo_id in seen_repo_ids:
            raise ValueError(f"Duplicate approved repo_id: {repo_id}")
        seen_repo_ids.add(repo_id)

        repo_name = ensure_non_empty_string(raw_repo.get("repo_name"), "repo_name")
        local_path = ensure_non_empty_string(raw_repo.get("path"), "path")

        repo_entry: dict[str, Any] = {
            "repo_id": repo_id,
            "repo_name": repo_name,
            "local_paths": [local_path_entry(local_path)],
            "system_layer": normalize_layer(raw_repo.get("system_layer")),
        }

        list_fields = {
            "languages": normalize_string_list(raw_repo.get("languages")),
            "artifact_roots": normalize_string_list(raw_repo.get("artifact_roots")),
            "document_paths": normalize_string_list(raw_repo.get("document_paths")),
            "depends_on_repo_ids": normalize_string_list(raw_repo.get("depends_on_repo_ids")),
            "used_by_repo_ids": normalize_string_list(raw_repo.get("used_by_repo_ids")),
            "adjacent_repo_ids": normalize_string_list(raw_repo.get("adjacent_repo_ids")),
        }
        for field_name, values in list_fields.items():
            if values:
                repo_entry[field_name] = unique_preserving_order(values)

        for field_name in ("owner", "bounded_context", "service_name", "workspace_activation_group"):
            value = normalize_optional_string(raw_repo.get(field_name))
            if value:
                repo_entry[field_name] = value

        repo_entry["default_focusable"] = bool(raw_repo.get("default_focusable", False))
        repo_entry["activation_priority"] = normalize_activation_priority(
            raw_repo.get("activation_priority")
        )

        repository_type = _normalize_repository_type(raw_repo.get("repository_type"))
        if repository_type is None:
            repository_type = "support"
        repo_entry["repository_type"] = repository_type

        repo_focus = _normalize_repository_type(raw_repo.get("repo_focus"))
        if repo_focus is not None:
            repo_entry["repo_focus"] = repo_focus
        if raw_repo.get("repo_focus_authored") is not None:
            repo_entry["repo_focus_authored"] = normalize_bool(
                raw_repo.get("repo_focus_authored"),
                default=False,
            )
        repo_category = _normalize_repo_category(raw_repo.get("repo_category"))
        if repo_category is not None:
            repo_entry["repo_category"] = repo_category
        if raw_repo.get("repo_category_authored") is not None:
            repo_entry["repo_category_authored"] = normalize_bool(
                raw_repo.get("repo_category_authored"),
                default=False,
            ) and repo_category is not None

        normalized.append(repo_entry)
    return normalized


def _normalize_focusable_areas(
    focusable_areas: Any,
    draft_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(focusable_areas, list) or not focusable_areas:
        raise ValueError(
            "Approved monolith manifest requires a non-empty focusable_areas "
            "list"
        )

    candidate_map = build_candidate_map(
        draft_payload.get("candidate_focus_areas", []),
        FOCUS_KEY_FIELDS,
    )
    approved_areas: list[dict[str, Any]] = []
    seen_focus_ids: set[str] = set()

    for raw_area in focusable_areas:
        if not isinstance(raw_area, dict):
            raise ValueError(
                "Approved focus area entries must be JSON objects"
            )
        candidate = resolve_candidate(
            raw_area,
            candidate_map,
            FOCUS_KEY_FIELDS,
            error_label="focus area entry",
        )
        focus_id = ensure_non_empty_string(
            raw_area.get("focus_id") or candidate.get("focus_id"),
            "focus_id",
        )
        if focus_id in seen_focus_ids:
            raise ValueError(f"Duplicate approved focus_id: {focus_id}")
        seen_focus_ids.add(focus_id)

        focus_entry: dict[str, Any] = {
            "focus_id": focus_id,
            "focus_name": ensure_non_empty_string(
                raw_area.get("focus_name") or candidate.get("focus_name"),
                "focus_name",
            ),
            "focus_type": _normalize_focus_type(
                raw_area.get("focus_type") or candidate.get("focus_type")
            ),
            "relative_path": ensure_non_empty_string(
                candidate.get("relative_path"),
                "relative_path",
            ),
        }
        group = normalize_optional_string(
            raw_area.get("group") or candidate.get("group")
        )
        if group:
            focus_entry["group"] = group

        focus_category = _normalize_repo_category(
            raw_area.get("focus_category") or candidate.get("focus_category")
        )
        if focus_category is not None:
            focus_entry["focus_category"] = focus_category
        if raw_area.get("focus_category_authored") is not None:
            focus_entry["focus_category_authored"] = normalize_bool(
                raw_area.get("focus_category_authored"),
                default=False,
            ) and focus_category is not None

        adjacent_ids = normalize_string_list(
            raw_area.get("adjacent_focus_area_ids")
        )
        if adjacent_ids:
            focus_entry["adjacent_focus_area_ids"] = unique_preserving_order(
                adjacent_ids
            )

        activation_group = normalize_optional_string(
            raw_area.get("workspace_activation_group")
        )
        if activation_group:
            focus_entry["workspace_activation_group"] = activation_group

        focus_entry["default_focusable"] = normalize_bool(
            raw_area.get("default_focusable"),
            default=False,
        )
        if "activation_priority" in raw_area:
            focus_entry["activation_priority"] = normalize_activation_priority(
                raw_area["activation_priority"]
            )
        repository_type = _normalize_repository_type(
            raw_area.get("repository_type") or candidate.get("repository_type")
        )
        if repository_type is not None:
            focus_entry["repository_type"] = repository_type

        approved_areas.append(focus_entry)

    from src.backend.mcp.context_estate.helpers import _normalize_focus_area_id_list

    known_focus_area_ids = {entry["focus_id"] for entry in approved_areas}
    for entry in approved_areas:
        if "adjacent_focus_area_ids" in entry:
            entry["adjacent_focus_area_ids"] = _normalize_focus_area_id_list(
                entry["adjacent_focus_area_ids"],
                known_focus_area_ids,
            )

    approved_areas.sort(key=lambda item: item["focus_id"])
    return approved_areas
