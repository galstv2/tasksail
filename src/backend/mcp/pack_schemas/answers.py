"""Typed dataclass model and validator for bootstrap-answers.json (BootstrapAnswers)."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any

from src.backend.mcp.pack_schemas.errors import PackSchemaError


@dataclass(slots=True)
class BootstrapRepository:
    repo_id: str
    repo_name: str
    repo_root: str
    system_layer: str
    owner: str
    # DEPRECATED: repo_role is superseded by repository_type; removal is
    # deferred for compatibility with existing packs.
    repo_role: str
    repository_type: str | None
    # KIND axis (mirrors repo_category/repo_category_authored in the manifest).
    # Optional + omitted-when-None on dump so pre-existing answers fixtures and
    # on-disk packs round-trip unchanged.
    repo_category: str | None = None
    repo_category_authored: bool | None = None
    languages: list[str] = field(default_factory=list)
    artifact_roots: list[str] = field(default_factory=list)
    document_paths: list[str] = field(default_factory=list)
    bounded_context: str = ""
    service_name: str = ""
    workspace_activation_group: str = ""
    default_focusable: bool = False
    activation_priority: int = 0
    adjacent_repo_ids: list[str] = field(default_factory=list)
    depends_on_repo_ids: list[str] = field(default_factory=list)
    used_by_repo_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BootstrapAnswers:
    questionnaire_version: str
    captured_at: str
    context_pack_id: str
    estate_name: str
    repository_count: int
    default_scope_mode: str
    discovery_mode: str
    estate_type: str
    primary_working_repo_ids: list[str] = field(default_factory=list)
    primary_focus_area_ids: list[str] = field(default_factory=list)
    focusable_areas: list[Any] = field(default_factory=list)
    repositories: list[BootstrapRepository] = field(default_factory=list)


_ANSWERS_REQUIRED = {
    "questionnaire_version",
    "captured_at",
    "context_pack_id",
    "estate_name",
    "repository_count",
    "default_scope_mode",
    "discovery_mode",
    "estate_type",
    "repositories",
}

_REPO_REQUIRED = {"repo_id", "repo_name", "repo_root", "system_layer"}


def _validate_repo(raw: Any, index: int, errors: list[str]) -> BootstrapRepository | None:
    if not isinstance(raw, dict):
        errors.append(f"repositories[{index}] must be a JSON object")
        return None
    missing = [f for f in _REPO_REQUIRED if f not in raw]
    if missing:
        errors.append(f"repositories[{index}] missing required fields: {missing}")
        return None
    return BootstrapRepository(
        repo_id=str(raw["repo_id"]),
        repo_name=str(raw["repo_name"]),
        repo_root=str(raw["repo_root"]),
        system_layer=str(raw["system_layer"]),
        owner=str(raw.get("owner") or ""),
        repo_role=str(raw.get("repo_role") or ""),
        repository_type=(
            str(raw["repository_type"]) if raw.get("repository_type") is not None else None
        ),
        repo_category=(
            str(raw["repo_category"]) if raw.get("repo_category") is not None else None
        ),
        repo_category_authored=(
            bool(raw["repo_category_authored"])
            if raw.get("repo_category_authored") is not None
            else None
        ),
        languages=list(raw.get("languages") or []),
        artifact_roots=list(raw.get("artifact_roots") or []),
        document_paths=list(raw.get("document_paths") or []),
        bounded_context=str(raw.get("bounded_context") or ""),
        service_name=str(raw.get("service_name") or ""),
        workspace_activation_group=str(raw.get("workspace_activation_group") or ""),
        default_focusable=bool(raw.get("default_focusable", False)),
        activation_priority=int(raw.get("activation_priority", 0)),
        adjacent_repo_ids=list(raw.get("adjacent_repo_ids") or []),
        depends_on_repo_ids=list(raw.get("depends_on_repo_ids") or []),
        used_by_repo_ids=list(raw.get("used_by_repo_ids") or []),
    )


def validate_answers(
    d: dict[str, Any],
    *,
    path: str | None = None,
) -> BootstrapAnswers:
    """Validate a raw dict against BootstrapAnswers, collecting all errors.

    Raises PackSchemaError if any validation errors are found.
    Ignores unknown keys for forward-compat.
    """
    errors: list[str] = []

    if not isinstance(d, dict):
        raise PackSchemaError("BootstrapAnswers", ["Expected a JSON object"], path=path)

    missing_top = [f for f in _ANSWERS_REQUIRED if f not in d]
    if missing_top:
        errors.append(f"Missing required fields: {missing_top}")

    repositories: list[BootstrapRepository] = []
    raw_repos = d.get("repositories")
    if raw_repos is not None:
        if not isinstance(raw_repos, list):
            errors.append("'repositories' must be a list")
        else:
            for i, raw_repo in enumerate(raw_repos):
                repo = _validate_repo(raw_repo, i, errors)
                if repo is not None:
                    repositories.append(repo)

    if errors:
        raise PackSchemaError("BootstrapAnswers", errors, path=path)

    return BootstrapAnswers(
        questionnaire_version=str(d["questionnaire_version"]),
        captured_at=str(d["captured_at"]),
        context_pack_id=str(d["context_pack_id"]),
        estate_name=str(d["estate_name"]),
        repository_count=int(d["repository_count"]),
        default_scope_mode=str(d["default_scope_mode"]),
        discovery_mode=str(d["discovery_mode"]),
        estate_type=str(d["estate_type"]),
        primary_working_repo_ids=list(d.get("primary_working_repo_ids") or []),
        primary_focus_area_ids=list(d.get("primary_focus_area_ids") or []),
        focusable_areas=list(d.get("focusable_areas") or []),
        repositories=repositories,
    )


def dump_answers(model: BootstrapAnswers) -> dict[str, Any]:
    """Convert a BootstrapAnswers to a dict.

    Preserves None values (serialized as JSON null) for established optional
    fields like repository_type, which use explicit null. The additive
    repo_category/repo_category_authored fields are omitted when None so
    pre-existing answers (without them) round-trip byte-for-byte.
    """
    result = dataclasses.asdict(model)
    for repo in result.get("repositories") or []:
        for key in ("repo_category", "repo_category_authored"):
            if repo.get(key) is None:
                repo.pop(key, None)
    return result
