"""Typed dataclass model and validator for repo-sources.json (RepoSourcesManifest)."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any

from src.backend.mcp.pack_constants import ALLOWED_ESTATE_TYPES
from src.backend.mcp.pack_schemas.errors import PackSchemaError


@dataclass(slots=True)
class ManifestRepository:
    repo_id: str
    repo_name: str
    local_paths: list[str] = field(default_factory=list)
    system_layer: str = ""
    default_focusable: bool = False
    activation_priority: int = 0
    repository_type: str = ""
    # DEPRECATED: repo_role is superseded by repository_type; removal deferred.
    # See context-pack-creation-hardening Phase 6 Gate G7.
    repo_role: str = ""
    # optional fields
    languages: list[str] | None = None
    artifact_roots: list[str] | None = None
    document_paths: list[str] | None = None
    owner: str | None = None
    bounded_context: str | None = None
    service_name: str | None = None
    workspace_activation_group: str | None = None
    depends_on_repo_ids: list[str] | None = None
    used_by_repo_ids: list[str] | None = None
    adjacent_repo_ids: list[str] | None = None
    exposes_services: list[str] | None = None
    consumes_services: list[str] | None = None
    owns_domains: list[str] | None = None
    integration_points: list[str] | None = None


@dataclass(slots=True)
class ManifestFocusableArea:
    focus_id: str
    focus_name: str
    focus_type: str
    relative_path: str
    group: str | None = None
    adjacent_focus_area_ids: list[str] | None = None
    workspace_activation_group: str | None = None
    default_focusable: bool = False
    activation_priority: int = 0
    repository_type: str | None = None


@dataclass(slots=True)
class RepoSourcesManifest:
    manifest_version: str
    manifest_status: str
    estate_type: str
    context_pack_id: str
    qmd_scope_root: str
    primary_working_repo_ids: list[str] = field(default_factory=list)
    primary_focus_area_ids: list[str] = field(default_factory=list)
    repositories: list[ManifestRepository] | None = None
    focusable_areas: list[ManifestFocusableArea] | None = None
    repository: ManifestRepository | None = None
    # optional top-level fields present in real manifests
    approved_at: str | None = None
    display_name: str | None = None
    default_scope_mode: str | None = None
    approval_source: dict[str, Any] | None = None
    shared_glossary_terms: list[str] | None = None


_REPO_REQUIRED = {"repo_id", "repo_name"}
_FOCUS_REQUIRED = {"focus_id", "focus_name", "focus_type", "relative_path"}
_MANIFEST_REQUIRED = {
    "manifest_version",
    "manifest_status",
    "estate_type",
    "context_pack_id",
    "qmd_scope_root",
}


def _validate_repo(raw: Any, index: int, errors: list[str]) -> ManifestRepository | None:
    if not isinstance(raw, dict):
        errors.append(f"repositories[{index}] must be a JSON object")
        return None
    missing = [f for f in _REPO_REQUIRED if f not in raw or raw[f] is None]
    if missing:
        errors.append(f"repositories[{index}] missing required fields: {missing}")
        return None
    return ManifestRepository(
        repo_id=str(raw["repo_id"]),
        repo_name=str(raw["repo_name"]),
        local_paths=list(raw.get("local_paths") or []),
        system_layer=str(raw.get("system_layer") or ""),
        default_focusable=bool(raw.get("default_focusable", False)),
        activation_priority=int(raw.get("activation_priority", 0)),
        repository_type=str(raw.get("repository_type") or ""),
        repo_role=str(raw.get("repo_role") or ""),
        languages=list(raw["languages"]) if raw.get("languages") is not None else None,
        artifact_roots=list(raw["artifact_roots"]) if raw.get("artifact_roots") is not None else None,
        document_paths=list(raw["document_paths"]) if raw.get("document_paths") is not None else None,
        owner=str(raw["owner"]) if raw.get("owner") is not None else None,
        bounded_context=str(raw["bounded_context"]) if raw.get("bounded_context") is not None else None,
        service_name=str(raw["service_name"]) if raw.get("service_name") is not None else None,
        workspace_activation_group=(
            str(raw["workspace_activation_group"])
            if raw.get("workspace_activation_group") is not None
            else None
        ),
        depends_on_repo_ids=(
            list(raw["depends_on_repo_ids"])
            if raw.get("depends_on_repo_ids") is not None
            else None
        ),
        used_by_repo_ids=(
            list(raw["used_by_repo_ids"])
            if raw.get("used_by_repo_ids") is not None
            else None
        ),
        adjacent_repo_ids=(
            list(raw["adjacent_repo_ids"])
            if raw.get("adjacent_repo_ids") is not None
            else None
        ),
        exposes_services=(
            list(raw["exposes_services"])
            if raw.get("exposes_services") is not None
            else None
        ),
        consumes_services=(
            list(raw["consumes_services"])
            if raw.get("consumes_services") is not None
            else None
        ),
        owns_domains=(
            list(raw["owns_domains"])
            if raw.get("owns_domains") is not None
            else None
        ),
        integration_points=(
            list(raw["integration_points"])
            if raw.get("integration_points") is not None
            else None
        ),
    )


def _validate_focus_area(raw: Any, index: int, errors: list[str]) -> ManifestFocusableArea | None:
    if not isinstance(raw, dict):
        errors.append(f"focusable_areas[{index}] must be a JSON object")
        return None
    missing = [f for f in _FOCUS_REQUIRED if f not in raw or raw[f] is None]
    if missing:
        errors.append(f"focusable_areas[{index}] missing required fields: {missing}")
        return None
    return ManifestFocusableArea(
        focus_id=str(raw["focus_id"]),
        focus_name=str(raw["focus_name"]),
        focus_type=str(raw["focus_type"]),
        relative_path=str(raw["relative_path"]),
        group=str(raw["group"]) if raw.get("group") is not None else None,
        adjacent_focus_area_ids=(
            list(raw["adjacent_focus_area_ids"])
            if raw.get("adjacent_focus_area_ids") is not None
            else None
        ),
        workspace_activation_group=(
            str(raw["workspace_activation_group"])
            if raw.get("workspace_activation_group") is not None
            else None
        ),
        default_focusable=bool(raw.get("default_focusable", False)),
        activation_priority=int(raw.get("activation_priority", 0)),
        repository_type=(
            str(raw["repository_type"])
            if raw.get("repository_type") is not None
            else None
        ),
    )


def validate_manifest(
    d: dict[str, Any],
    *,
    path: str | None = None,
) -> RepoSourcesManifest:
    """Validate a raw dict against RepoSourcesManifest, collecting all errors.

    Raises PackSchemaError if any validation errors are found.
    Ignores unknown keys for forward-compat.
    """
    errors: list[str] = []

    if not isinstance(d, dict):
        raise PackSchemaError("RepoSourcesManifest", ["Expected a JSON object"], path=path)

    missing_top = [f for f in _MANIFEST_REQUIRED if f not in d or d[f] is None]
    if missing_top:
        errors.append(f"Missing required fields: {missing_top}")
    estate_type = str(d.get("estate_type", ""))
    if estate_type and estate_type not in ALLOWED_ESTATE_TYPES:
        allowed = ", ".join(sorted(ALLOWED_ESTATE_TYPES))
        errors.append(f"estate_type must be one of {allowed}")

    if errors:
        raise PackSchemaError("RepoSourcesManifest", errors, path=path)

    repositories: list[ManifestRepository] | None = None
    raw_repos = d.get("repositories")
    if raw_repos is not None:
        if not isinstance(raw_repos, list):
            errors.append("'repositories' must be a list")
        else:
            repositories = []
            for i, raw_repo in enumerate(raw_repos):
                repo = _validate_repo(raw_repo, i, errors)
                if repo is not None:
                    repositories.append(repo)

    focusable_areas: list[ManifestFocusableArea] | None = None
    raw_areas = d.get("focusable_areas")
    if raw_areas is not None:
        if not isinstance(raw_areas, list):
            errors.append("'focusable_areas' must be a list")
        else:
            focusable_areas = []
            for i, raw_area in enumerate(raw_areas):
                area = _validate_focus_area(raw_area, i, errors)
                if area is not None:
                    focusable_areas.append(area)

    repository: ManifestRepository | None = None
    raw_single_repo = d.get("repository")
    if raw_single_repo is not None:
        repository = _validate_repo(raw_single_repo, 0, errors)

    if errors:
        raise PackSchemaError("RepoSourcesManifest", errors, path=path)

    return RepoSourcesManifest(
        manifest_version=str(d["manifest_version"]),
        manifest_status=str(d["manifest_status"]),
        estate_type=str(d["estate_type"]),
        context_pack_id=str(d["context_pack_id"]),
        qmd_scope_root=str(d["qmd_scope_root"]),
        primary_working_repo_ids=list(d.get("primary_working_repo_ids") or []),
        primary_focus_area_ids=list(d.get("primary_focus_area_ids") or []),
        repositories=repositories,
        focusable_areas=focusable_areas,
        repository=repository,
        approved_at=str(d["approved_at"]) if d.get("approved_at") is not None else None,
        display_name=str(d["display_name"]) if d.get("display_name") is not None else None,
        default_scope_mode=(
            str(d["default_scope_mode"]) if d.get("default_scope_mode") is not None else None
        ),
        approval_source=(
            dict(d["approval_source"]) if d.get("approval_source") is not None else None
        ),
        shared_glossary_terms=(
            list(d["shared_glossary_terms"])
            if d.get("shared_glossary_terms") is not None
            else None
        ),
    )


def _strip_none(obj: Any) -> Any:
    """Recursively strip None values from dicts and lists."""
    if isinstance(obj, dict):
        return {k: _strip_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_none(item) for item in obj]
    return obj


def dump_manifest(model: RepoSourcesManifest) -> dict[str, Any]:
    """Convert a RepoSourcesManifest to a dict, stripping None values."""
    return _strip_none(dataclasses.asdict(model))
