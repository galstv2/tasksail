"""Bootstrap payload builders for distributed and monolith estate modes."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.bootstrap_detection import (
    _detect_document_paths,
    _detect_languages,
    _detect_system_layer,
)
from src.backend.mcp.context_estate.bootstrap_normalization import (
    _normalize_focus_area_overrides,
    _repo_role_for_layer,
)
from src.backend.mcp.context_estate.constants import DEFAULT_SCOPE_MODE
from src.backend.mcp.context_estate.discovery import (
    classify_focus_area_repository_type,
)
from src.backend.mcp.context_estate.helpers import (
    FOCUS_KEY_FIELDS,
    build_candidate_map,
    resolve_candidate,
)
from src.backend.mcp.context_estate_discovery import (
    collect_repo_high_signal_paths,
    discover_candidate_focus_areas,
)
from src.backend.mcp.repo_category_probe import (
    classify_repo_category,
    repo_category_for_wizard_role,
)
from src.backend.mcp.repo_context_mcp.utils import (
    is_within,
    normalize_optional_string,
    slugify,
    titleize_segment,
)
from src.backend.mcp.repo_type_probe import classify_repository_type


def _authoritative_answer_category(repository: dict[str, Any]) -> tuple[str, bool] | None:
    answer_category = normalize_optional_string(repository.get("repo_category"))
    answer_authored = bool(repository.get("repo_category_authored"))
    if answer_category and (answer_category.lower() != "unknown" or answer_authored):
        return answer_category, answer_authored
    return None


def _category_from_answer_candidate_or_layer(
    repository: dict[str, Any],
    candidate: dict[str, Any] | None,
    system_layer: str,
) -> tuple[str, bool]:
    answer_category = _authoritative_answer_category(repository)
    if answer_category:
        return answer_category

    if candidate:
        candidate_category = normalize_optional_string(candidate.get("repo_category"))
        if candidate_category:
            return candidate_category, False

    return repo_category_for_wizard_role(system_layer) or "unknown", False


def _category_from_answer_probe_or_layer(
    repository: dict[str, Any],
    repo_path: Path,
    system_layer: str,
) -> tuple[str, bool]:
    answer_category = _authoritative_answer_category(repository)
    if answer_category:
        return answer_category

    probed_category = "unknown"
    if repo_path.exists():
        probed_category, _ = classify_repo_category(repo_path)
    if probed_category != "unknown":
        return probed_category, False

    return repo_category_for_wizard_role(system_layer) or "unknown", False


def _synthesize_candidate_repo(
    root: Path,
    repository: dict[str, Any],
) -> dict[str, Any]:
    repo_root = Path(repository["repo_root"]).resolve()
    relative_path = (
        repo_root.relative_to(root).as_posix() if is_within(root, repo_root) else repo_root.name
    )
    return {
        "repo_id": repository["repo_id"],
        "repo_name": repository["repo_name"],
        "path": str(repo_root),
        "relative_path": relative_path,
        "high_signal_paths": collect_repo_high_signal_paths(repo_root)
        if repo_root.exists()
        else [],
    }


def _merge_candidate_repos(
    discovery_payload: dict[str, Any],
    answers: dict[str, Any],
    discovery_root: Path,
) -> dict[str, Any]:
    merged = dict(discovery_payload)
    candidate_repos = list(discovery_payload.get("candidate_repos") or [])
    known_paths = {
        str(Path(item.get("path", "")).resolve())
        for item in candidate_repos
        if isinstance(item, dict) and item.get("path")
    }

    for repository in answers["repositories"]:
        repo_root = str(Path(repository["repo_root"]).resolve())
        if repo_root in known_paths:
            continue
        candidate_repos.append(_synthesize_candidate_repo(discovery_root, repository))
        known_paths.add(repo_root)

    merged["candidate_repos"] = sorted(
        candidate_repos,
        key=lambda item: str(item.get("relative_path") or item.get("path") or ""),
    )
    return merged


def _synthesize_candidate_focus_area(
    discovery_root: Path,
    override: dict[str, Any],
) -> dict[str, Any]:
    relative_path = normalize_optional_string(override.get("relative_path"))
    path_value = normalize_optional_string(override.get("path"))
    focus_type = normalize_optional_string(override.get("focus_type")) or "general"

    resolved_path = (
        Path(path_value).expanduser()
        if path_value
        else discovery_root / (relative_path or ".")
    )
    if not resolved_path.is_absolute():
        resolved_path = (discovery_root / resolved_path).resolve()
    else:
        resolved_path = resolved_path.resolve()

    if not relative_path and is_within(discovery_root, resolved_path):
        relative_path = resolved_path.relative_to(discovery_root).as_posix()
    relative_path = relative_path or "."

    name_source = (
        Path(relative_path).name
        if relative_path not in {"", "."}
        else discovery_root.name
    )
    focus_name = normalize_optional_string(override.get("focus_name")) or titleize_segment(
        name_source
    )

    candidate = {
        "focus_id": normalize_optional_string(override.get("focus_id"))
        or slugify(relative_path.replace("/", "-")),
        "focus_name": focus_name,
        "focus_type": focus_type,
        "path": str(resolved_path),
        "relative_path": relative_path,
        "repository_type": classify_focus_area_repository_type(focus_type),
    }
    group = normalize_optional_string(override.get("group"))
    if group:
        candidate["group"] = group
    return candidate


def _merge_candidate_focus_areas(
    discovery_payload: dict[str, Any],
    answers: dict[str, Any],
    discovery_root: Path,
) -> dict[str, Any]:
    merged = dict(discovery_payload)
    candidate_focus_areas = list(discovery_payload.get("candidate_focus_areas") or [])
    candidate_map = build_candidate_map(
        candidate_focus_areas,
        FOCUS_KEY_FIELDS,
    )

    for override in _normalize_focus_area_overrides(answers.get("focusable_areas")):
        if any(
            key in candidate_map
            for field_name in FOCUS_KEY_FIELDS
            if (key := normalize_optional_string(override.get(field_name)))
        ):
            continue
        synthesized = _synthesize_candidate_focus_area(discovery_root, override)
        candidate_focus_areas.append(synthesized)
        for field_name in FOCUS_KEY_FIELDS:
            key = normalize_optional_string(synthesized.get(field_name))
            if key:
                candidate_map[key] = synthesized

    merged["candidate_focus_areas"] = sorted(
        candidate_focus_areas,
        key=lambda item: str(item.get("relative_path") or item.get("path") or ""),
    )
    return merged


def _build_distributed_review_payload(
    answers: dict[str, Any],
    discovery_payload: dict[str, Any],
) -> dict[str, Any]:
    candidate_by_path = {
        str(Path(candidate.get("path", "")).resolve()): candidate
        for candidate in discovery_payload.get("candidate_repos", [])
        if isinstance(candidate, dict) and candidate.get("path")
    }

    review_repositories: list[dict[str, Any]] = []
    approved_repo_ids: list[str] = []
    for index, repository in enumerate(answers["repositories"]):
        repo_root = str(Path(repository["repo_root"]).resolve())
        candidate = candidate_by_path.get(repo_root)
        if not candidate:
            raise ValueError(
                "Bootstrap distributed repository could not be matched to a discovered candidate: "
                f"{repo_root}"
            )

        approved_repo_id = normalize_optional_string(candidate.get("repo_id")) or repository["repo_id"]
        approved_repo_ids.append(approved_repo_id)

        repo_path = Path(normalize_optional_string(candidate.get("path")) or repo_root)

        languages = repository["languages"]
        if not languages:
            languages = _detect_languages(repo_path)

        artifact_roots = repository["artifact_roots"]
        if not artifact_roots:
            high_signal = candidate.get("high_signal_paths")
            if isinstance(high_signal, list) and high_signal:
                artifact_roots = [
                    entry.get("relative_path", entry) if isinstance(entry, dict) else str(entry)
                    for entry in high_signal
                    if entry
                ]

        document_paths = repository["document_paths"]
        if not document_paths:
            document_paths = _detect_document_paths(repo_path)

        system_layer = _detect_system_layer(repo_path, repository["system_layer"])
        repo_category, repo_category_authored = _category_from_answer_candidate_or_layer(
            repository,
            candidate,
            system_layer,
        )

        review_entry = {
            "repo_id": approved_repo_id,
            "path": str(repo_path),
            "repo_name": repository["repo_name"],
            "system_layer": system_layer,
            "repo_category": repo_category,
            "repo_category_authored": repo_category_authored,
            "repo_role": repository["repo_role"] or _repo_role_for_layer(system_layer),
            "default_focusable": repository["default_focusable"],
            "activation_priority": repository["activation_priority"],
            "adjacent_repo_ids": repository["adjacent_repo_ids"],
            "depends_on_repo_ids": repository["depends_on_repo_ids"],
            "used_by_repo_ids": repository["used_by_repo_ids"],
            "languages": languages,
            "artifact_roots": artifact_roots,
            "document_paths": document_paths,
        }
        # Forward v2 focus fields when provided by the operator.
        for v2_field in ("repo_focus", "repo_focus_authored"):
            if repository.get(v2_field) is not None:
                review_entry[v2_field] = repository[v2_field]

        if repository.get("repository_type"):
            review_entry["repository_type"] = repository["repository_type"]
            review_entry["repository_type_authored"] = True
        elif candidate.get("repository_type"):
            # Reuse the classification from the discovery phase to avoid
            # re-probing the same repo's filesystem.
            review_entry["repository_type"] = candidate["repository_type"]
            review_entry["repository_type_authored"] = False
            if candidate.get("classification_confidence"):
                review_entry["classification_confidence"] = candidate["classification_confidence"]
        else:
            probe = classify_repository_type(
                repo_path,
                languages=languages,
                repo_name=repository["repo_name"],
            )
            review_entry["repository_type"] = probe["repository_type"]
            review_entry["repository_type_authored"] = False
            review_entry["classification_confidence"] = probe["classification_confidence"]
        for field_name in (
            "owner",
            "bounded_context",
            "service_name",
            "workspace_activation_group",
        ):
            if repository.get(field_name):
                review_entry[field_name] = repository[field_name]
        review_repositories.append(review_entry)

    for entry in review_repositories:
        if not entry["adjacent_repo_ids"]:
            entry["adjacent_repo_ids"] = [
                repo_id for repo_id in approved_repo_ids if repo_id != entry["repo_id"]
            ]

    primary_working_repo_ids = [
        repo_id for repo_id in answers.get("primary_working_repo_ids", []) if repo_id in approved_repo_ids
    ]
    if not primary_working_repo_ids and approved_repo_ids:
        primary_working_repo_ids = [approved_repo_ids[0]]

    return {
        "context_pack_id": answers["context_pack_id"],
        "display_name": answers["estate_name"],
        "estate_type": discovery_payload.get("estate_type") or "distributed",
        "default_scope_mode": answers.get("default_scope_mode", DEFAULT_SCOPE_MODE),
        "primary_working_repo_ids": primary_working_repo_ids,
        "repositories": review_repositories,
    }


def _build_monolith_focusable_areas(
    answers: dict[str, Any],
    discovery_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    candidate_map = build_candidate_map(
        discovery_payload.get("candidate_focus_areas", []),
        ("focus_id", "relative_path", "path"),
    )

    overrides = _normalize_focus_area_overrides(answers.get("focusable_areas"))
    if overrides:
        resolved: list[dict[str, Any]] = []
        for override in overrides:
            candidate = resolve_candidate(
                override,
                candidate_map,
                FOCUS_KEY_FIELDS,
                error_label="bootstrap monolith focus area",
            )
            resolved.append(
                {
                    "focus_id": normalize_optional_string(candidate.get("focus_id")),
                    "relative_path": normalize_optional_string(candidate.get("relative_path")),
                    "path": normalize_optional_string(candidate.get("path")),
                    "focus_name": override["focus_name"] or normalize_optional_string(candidate.get("focus_name")),
                    "focus_type": override["focus_type"] or normalize_optional_string(candidate.get("focus_type")),
                    "group": override["group"] or normalize_optional_string(candidate.get("group")),
                    "default_focusable": override["default_focusable"],
                    "activation_priority": override["activation_priority"],
                    "adjacent_focus_area_ids": override["adjacent_focus_area_ids"],
                }
            )
        return resolved

    focusable_areas = [
        candidate
        for candidate in discovery_payload.get("candidate_focus_areas", [])
        if isinstance(candidate, dict)
    ]
    if not focusable_areas:
        repo_root = Path(answers["repositories"][0]["repo_root"]).resolve()
        focusable_areas = discover_candidate_focus_areas(repo_root, warnings=[])

    normalized: list[dict[str, Any]] = []
    known_focus_ids = [
        normalize_optional_string(candidate.get("focus_id"))
        for candidate in focusable_areas
        if normalize_optional_string(candidate.get("focus_id"))
    ]
    for index, candidate in enumerate(focusable_areas):
        focus_id = normalize_optional_string(candidate.get("focus_id"))
        if not focus_id:
            continue
        same_group_focus_ids = [
            other_id
            for other_id in known_focus_ids
            if other_id != focus_id
            and normalize_optional_string(candidate.get("group"))
            and any(
                normalize_optional_string(other.get("focus_id")) == other_id
                and normalize_optional_string(other.get("group")) == normalize_optional_string(candidate.get("group"))
                for other in focusable_areas
                if isinstance(other, dict)
            )
        ]
        normalized.append(
            {
                "focus_id": focus_id,
                "relative_path": normalize_optional_string(candidate.get("relative_path")),
                "path": normalize_optional_string(candidate.get("path")),
                "focus_name": normalize_optional_string(candidate.get("focus_name")) or focus_id,
                "focus_type": normalize_optional_string(candidate.get("focus_type")) or "general",
                "group": normalize_optional_string(candidate.get("group")),
                "default_focusable": index == 0,
                "activation_priority": max(0, 100 - (index * 10)),
                "adjacent_focus_area_ids": same_group_focus_ids,
            }
        )
    return normalized


def _build_monolith_infrastructure_repository(
    repository: dict[str, Any],
) -> dict[str, Any]:
    """Shape an infrastructure repo entry for monolith-platform manifests.

    These repos are brand-new (created by `git init` at creation time) and have
    no discovery candidate to merge against, so the entry is built directly
    from the operator-provided answers without filesystem detection.
    """
    repo_path = Path(repository["repo_root"]).resolve()
    languages = repository.get("languages") or []
    artifact_roots = repository.get("artifact_roots") or []
    document_paths = repository.get("document_paths") or []

    entry: dict[str, Any] = {
        "repo_id": repository["repo_id"],
        "path": str(repo_path),
        "repo_name": repository["repo_name"],
        "system_layer": repository.get("system_layer") or "infrastructure",
        "repo_role": repository.get("repo_role") or _repo_role_for_layer("infrastructure"),
        "default_focusable": bool(repository.get("default_focusable", False)),
        "activation_priority": int(repository.get("activation_priority") or 0),
        "adjacent_repo_ids": repository.get("adjacent_repo_ids") or [],
        "depends_on_repo_ids": repository.get("depends_on_repo_ids") or [],
        "used_by_repo_ids": repository.get("used_by_repo_ids") or [],
        "languages": languages,
        "artifact_roots": artifact_roots,
        "document_paths": document_paths,
    }
    repo_category, repo_category_authored = _category_from_answer_probe_or_layer(
        repository,
        repo_path,
        entry["system_layer"],
    )
    entry["repo_category"] = repo_category
    entry["repo_category_authored"] = repo_category_authored
    if repository.get("repository_type"):
        entry["repository_type"] = repository["repository_type"]
        entry["repository_type_authored"] = True
    for v2_field in ("repo_focus", "repo_focus_authored"):
        if repository.get(v2_field) is not None:
            entry[v2_field] = repository[v2_field]
    for field_name in (
        "owner",
        "bounded_context",
        "service_name",
        "workspace_activation_group",
    ):
        if repository.get(field_name):
            entry[field_name] = repository[field_name]
    return entry


def _build_monolith_review_payload(
    answers: dict[str, Any],
    discovery_payload: dict[str, Any],
) -> dict[str, Any]:
    repository = answers["repositories"][0]
    repo_path = Path(repository["repo_root"]).resolve()
    extra_repositories = [
        _build_monolith_infrastructure_repository(extra)
        for extra in answers["repositories"][1:]
    ]

    languages = repository["languages"]
    if not languages:
        languages = _detect_languages(repo_path)

    artifact_roots = repository["artifact_roots"]
    if not artifact_roots:
        candidate_repos = discovery_payload.get("candidate_repos") or []
        for candidate in candidate_repos:
            if isinstance(candidate, dict) and str(Path(candidate.get("path", "")).resolve()) == str(repo_path):
                high_signal = candidate.get("high_signal_paths")
                if isinstance(high_signal, list) and high_signal:
                    artifact_roots = [
                        entry.get("relative_path", entry) if isinstance(entry, dict) else str(entry)
                        for entry in high_signal
                        if entry
                    ]
                break

    document_paths = repository["document_paths"]
    if not document_paths:
        document_paths = _detect_document_paths(repo_path)

    system_layer = _detect_system_layer(repo_path, repository["system_layer"])
    repo_category, repo_category_authored = _category_from_answer_probe_or_layer(
        repository,
        repo_path,
        system_layer,
    )

    focusable_areas = _build_monolith_focusable_areas(answers, discovery_payload)
    known_focus_ids = [area["focus_id"] for area in focusable_areas]
    primary_focus_area_ids = [
        focus_id
        for focus_id in answers.get("primary_focus_area_ids", [])
        if focus_id in known_focus_ids
    ]
    if not primary_focus_area_ids and known_focus_ids:
        primary_focus_area_ids = [known_focus_ids[0]]

    return {
        "context_pack_id": answers["context_pack_id"],
        "display_name": answers["estate_name"],
        "estate_type": discovery_payload.get("estate_type") or "monolith",
        "default_scope_mode": answers.get("default_scope_mode", DEFAULT_SCOPE_MODE),
        "repository": {
            "repo_id": repository["repo_id"],
            "repo_name": repository["repo_name"],
            "system_layer": system_layer,
            "repo_category": repo_category,
            "repo_category_authored": repo_category_authored,
            "languages": languages,
            "artifact_roots": artifact_roots,
            "document_paths": document_paths,
            **(
                {"repository_type": repository["repository_type"]}
                if repository.get("repository_type")
                else {}
            ),
            # Forward v2 category fields when provided
            **(
                {"repo_focus": repository["repo_focus"]}
                if repository.get("repo_focus")
                else {}
            ),
            **(
                {"repo_focus_authored": repository["repo_focus_authored"]}
                if repository.get("repo_focus_authored") is not None
                else {}
            ),
            **(
                {"owner": repository["owner"]}
                if repository.get("owner")
                else {}
            ),
            **(
                {"bounded_context": repository["bounded_context"]}
                if repository.get("bounded_context")
                else {}
            ),
            **(
                {"service_name": repository["service_name"]}
                if repository.get("service_name")
                else {}
            ),
        },
        **(
            {"repositories": extra_repositories}
            if extra_repositories
            else {}
        ),
        "focusable_areas": focusable_areas,
        "primary_focus_area_ids": primary_focus_area_ids,
    }
