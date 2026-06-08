"""Typed dataclass model and validator for repo-sources.json v2 (RepoSourcesManifestV2).

v2 introduces repo_focus / repo_category / authorship flags, replacing the
single repository_type field from v1. The v1 repository_type field is retained
for backward compat during transition.

Version dispatch:
  manifest_version == "qmd-repo-sources/v1"  → validate_manifest   (v1)
  manifest_version == "qmd-repo-sources/v2"  → validate_manifest_v2 (v2)
  missing / unknown                           → v1 (safe default)
"""
from __future__ import annotations

import dataclasses
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

from src.backend.mcp.pack.constants import (
    ALLOWED_ESTATE_TYPES,
    ALLOWED_REPO_CATEGORIES,
    MANIFEST_VERSION_V2,
    REPO_FOCUS_VALUES,
)
from src.backend.mcp.pack_schemas.errors import PackSchemaError
from src.backend.mcp.pack_schemas.manifest import (
    ManifestFocusableArea,
    RepoSourcesManifest,
    _strip_none,
    validate_manifest,
)
from src.backend.mcp.probes.git_roots import coerce_git_root_field

RepoCategory = Literal[
    "service", "application", "frontend", "library",
    "infrastructure", "data", "documentation", "tool", "unknown",
]
RepoFocus = Literal["primary", "support", ""]
ManifestVersionV2 = Literal["qmd-repo-sources/v2"]
logger = logging.getLogger(__name__)

_REQUIRED_MANIFEST_FIELDS = (
    "manifest_version",
    "manifest_status",
    "estate_type",
    "context_pack_id",
    "qmd_scope_root",
)

_REQUIRED_REPO_FIELDS = ("repo_id", "repo_name")

_REQUIRED_FOCUS_FIELDS = ("focus_id", "focus_name", "focus_type", "relative_path")


@dataclass(slots=True)
class LocalPath:
    host: str
    container: str | None = None
    git_root: str | None = None


@dataclass(slots=True)
class ManifestRepositoryV2:
    repo_id: str
    repo_name: str
    local_paths: list[LocalPath] = field(default_factory=list)
    system_layer: str = ""
    default_focusable: bool = False
    activation_priority: int = 0
    # v2 fields — replace repository_type as the primary classification
    repo_focus: RepoFocus = ""
    repo_focus_authored: bool = False
    repo_category: RepoCategory = "unknown"
    repo_category_authored: bool = False
    # DEPRECATED: repo_role is superseded by repository_type; grace period in
    # effect because it still has readers/writers in bootstrap normalization,
    # catalog, conventions summary, and desktop contracts.
    repo_role: str = ""
    repository_type: str = ""
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
class RepoSourcesManifestV2:
    manifest_version: ManifestVersionV2
    manifest_status: str
    estate_type: str
    context_pack_id: str
    qmd_scope_root: str
    primary_working_repo_ids: list[str] = field(default_factory=list)
    primary_focus_area_ids: list[str] = field(default_factory=list)
    repositories: list[ManifestRepositoryV2] | None = None
    focusable_areas: list[ManifestFocusableArea] | None = None
    repository: ManifestRepositoryV2 | None = None
    approved_at: str | None = None
    display_name: str | None = None
    default_scope_mode: str | None = None
    approval_source: dict[str, Any] | None = None
    shared_glossary_terms: list[str] | None = None


def _coerce_repo_focus(value: Any) -> RepoFocus:
    raw = value or ""
    if raw and raw not in REPO_FOCUS_VALUES:
        return ""
    return cast(RepoFocus, raw)


def _coerce_repo_category(value: Any) -> RepoCategory:
    raw = value or "unknown"
    if raw not in ALLOWED_REPO_CATEGORIES:
        return "unknown"
    return cast(RepoCategory, raw)


def _normalize_host_path(value: str, *, manifest_path: str | None) -> str:
    normalized = value.replace("\\", "/")
    if normalized.startswith("//"):
        logger.warning(
            "pack_schemas.unc-host-path",
            extra={
                "event": "pack_schemas.unc-host-path",
                "host": normalized,
                "manifest_path": manifest_path,
            },
        )
    return normalized


def _coerce_local_path(value: Any, *, manifest_path: str | None) -> LocalPath:
    if isinstance(value, str):
        return LocalPath(host=_normalize_host_path(value, manifest_path=manifest_path))
    if isinstance(value, dict):
        host = value.get("host")
        if not isinstance(host, str):
            raise ValueError("local_paths[] object requires string field 'host'")
        container = value.get("container")
        if container is not None and not isinstance(container, str):
            raise ValueError("local_paths[] object field 'container' must be a string or null")
        git_root = coerce_git_root_field(
            value.get("git_root"),
            field_label="local_paths[] object field 'git_root'",
        )
        return LocalPath(
            host=_normalize_host_path(host, manifest_path=manifest_path),
            container=container.replace("\\", "/") if isinstance(container, str) else None,
            git_root=git_root,
        )
    raise ValueError("local_paths[] entries must be strings or objects")


def _coerce_local_paths(value: Any, *, manifest_path: str | None) -> list[LocalPath]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("local_paths must be a list")
    return [
        _coerce_local_path(item, manifest_path=manifest_path)
        for item in value
    ]


def _parse_repo_v2(raw: dict[str, Any], *, manifest_path: str | None) -> ManifestRepositoryV2:
    return ManifestRepositoryV2(
        repo_id=raw.get("repo_id", ""),
        repo_name=raw.get("repo_name", ""),
        local_paths=_coerce_local_paths(raw.get("local_paths"), manifest_path=manifest_path),
        system_layer=raw.get("system_layer") or "",
        default_focusable=bool(raw.get("default_focusable", False)),
        activation_priority=int(raw.get("activation_priority") or 0),
        repo_focus=_coerce_repo_focus(raw.get("repo_focus")),
        repo_focus_authored=bool(raw.get("repo_focus_authored", False)),
        repo_category=_coerce_repo_category(raw.get("repo_category")),
        repo_category_authored=bool(raw.get("repo_category_authored", False)),
        repo_role=raw.get("repo_role") or "",
        repository_type=raw.get("repository_type") or "",
        languages=raw.get("languages"),
        artifact_roots=raw.get("artifact_roots"),
        document_paths=raw.get("document_paths"),
        owner=raw.get("owner"),
        bounded_context=raw.get("bounded_context"),
        service_name=raw.get("service_name"),
        workspace_activation_group=raw.get("workspace_activation_group"),
        depends_on_repo_ids=raw.get("depends_on_repo_ids"),
        used_by_repo_ids=raw.get("used_by_repo_ids"),
        adjacent_repo_ids=raw.get("adjacent_repo_ids"),
        exposes_services=raw.get("exposes_services"),
        consumes_services=raw.get("consumes_services"),
        owns_domains=raw.get("owns_domains"),
        integration_points=raw.get("integration_points"),
    )


def _parse_focus_area_v2(raw: dict[str, Any]) -> ManifestFocusableArea:
    return ManifestFocusableArea(
        focus_id=raw.get("focus_id", ""),
        focus_name=raw.get("focus_name", ""),
        focus_type=raw.get("focus_type", ""),
        relative_path=raw.get("relative_path", ""),
        focus_category=raw.get("focus_category") or None,
        focus_category_authored=(
            bool(raw["focus_category_authored"])
            if raw.get("focus_category_authored") is not None
            else None
        ),
        repository_type=raw.get("repository_type") or None,
        group=raw.get("group"),
        default_focusable=bool(raw.get("default_focusable", False)),
        activation_priority=int(raw.get("activation_priority") or 0),
        adjacent_focus_area_ids=raw.get("adjacent_focus_area_ids"),
        workspace_activation_group=raw.get("workspace_activation_group"),
    )


def validate_manifest_v2(
    d: Any,
    *,
    path: str | Path | None = None,
) -> RepoSourcesManifestV2:
    """Validate a raw dict as a v2 RepoSourcesManifestV2.

    Collects all errors before raising PackSchemaError.
    Ignores unknown keys for forward-compat.
    """
    path_str = str(path) if path is not None else None

    if not isinstance(d, dict):
        raise PackSchemaError(
            "RepoSourcesManifestV2",
            ["Expected a JSON object"],
            path=path_str,
        )

    errors: list[str] = []
    for req in _REQUIRED_MANIFEST_FIELDS:
        if not d.get(req):
            errors.append(f"Required field '{req}' is missing or empty")
    estate_type = str(d.get("estate_type", ""))
    if estate_type and estate_type not in ALLOWED_ESTATE_TYPES:
        allowed = ", ".join(sorted(ALLOWED_ESTATE_TYPES))
        errors.append(f"estate_type must be one of {allowed}")

    raw_version = d.get("manifest_version", "")
    if raw_version and raw_version != MANIFEST_VERSION_V2:
        errors.append(
            f"manifest_version must be {MANIFEST_VERSION_V2!r}, got {raw_version!r}"
        )

    if errors:
        raise PackSchemaError("RepoSourcesManifestV2", errors, path=path_str)

    # Preserve the distinction between absent ("repository" not in d) and empty ([]).
    raw_repositories = d.get("repositories")
    repos: list[ManifestRepositoryV2] = []
    has_repositories_key = raw_repositories is not None
    for i, raw in enumerate(raw_repositories or []):
        if not isinstance(raw, dict):
            errors.append(f"repositories[{i}] must be a JSON object")
            continue
        missing_repo = [f for f in _REQUIRED_REPO_FIELDS if not raw.get(f)]
        if missing_repo:
            errors.append(f"repositories[{i}] missing required fields: {missing_repo}")
            continue
        try:
            repos.append(_parse_repo_v2(raw, manifest_path=path_str))
        except ValueError as exc:
            errors.append(f"repositories[{i}].{exc}")

    monolith_repo: ManifestRepositoryV2 | None = None
    raw_repo = d.get("repository")
    if isinstance(raw_repo, dict):
        missing_repo = [f for f in _REQUIRED_REPO_FIELDS if not raw_repo.get(f)]
        if missing_repo:
            errors.append(f"repository missing required fields: {missing_repo}")
        else:
            try:
                monolith_repo = _parse_repo_v2(raw_repo, manifest_path=path_str)
            except ValueError as exc:
                errors.append(f"repository.{exc}")

    focus_areas: list[ManifestFocusableArea] = []
    for i, raw_fa in enumerate(d.get("focusable_areas") or []):
        if not isinstance(raw_fa, dict):
            errors.append(f"focusable_areas[{i}] must be a JSON object")
            continue
        missing_fa = [f for f in _REQUIRED_FOCUS_FIELDS if not raw_fa.get(f)]
        if missing_fa:
            errors.append(f"focusable_areas[{i}] missing required fields: {missing_fa}")
            continue
        focus_areas.append(_parse_focus_area_v2(raw_fa))

    if errors:
        raise PackSchemaError("RepoSourcesManifestV2", errors, path=path_str)

    return RepoSourcesManifestV2(
        manifest_version=cast(ManifestVersionV2, MANIFEST_VERSION_V2),
        manifest_status=d.get("manifest_status", ""),
        estate_type=d.get("estate_type", ""),
        context_pack_id=d.get("context_pack_id", ""),
        qmd_scope_root=d.get("qmd_scope_root", ""),
        primary_working_repo_ids=d.get("primary_working_repo_ids") or [],
        primary_focus_area_ids=d.get("primary_focus_area_ids") or [],
        repositories=repos if has_repositories_key else None,
        focusable_areas=focus_areas if focus_areas else None,
        repository=monolith_repo,
        approved_at=d.get("approved_at"),
        display_name=d.get("display_name"),
        default_scope_mode=d.get("default_scope_mode"),
        approval_source=d.get("approval_source"),
        shared_glossary_terms=d.get("shared_glossary_terms"),
    )


def dump_manifest_v2(model: RepoSourcesManifestV2) -> dict[str, Any]:
    """Serialize a RepoSourcesManifestV2 to a dict, stripping None values."""
    def _repo_to_dict(repo: ManifestRepositoryV2) -> dict[str, Any]:
        data = _strip_none(dataclasses.asdict(repo))
        local_paths: list[dict[str, str | None]] = []
        for local_path in repo.local_paths:
            entry = {
                "host": local_path.host,
                "container": local_path.container,
            }
            if local_path.git_root is not None:
                entry["git_root"] = local_path.git_root
            local_paths.append(entry)
        data["local_paths"] = local_paths
        return data

    d: dict[str, Any] = {
        "manifest_version": model.manifest_version,
        "manifest_status": model.manifest_status,
        "estate_type": model.estate_type,
        "context_pack_id": model.context_pack_id,
        "qmd_scope_root": model.qmd_scope_root,
    }
    if model.approved_at:
        d["approved_at"] = model.approved_at
    if model.display_name:
        d["display_name"] = model.display_name
    if model.default_scope_mode:
        d["default_scope_mode"] = model.default_scope_mode
    # Required fields — always include, even when empty
    d["primary_working_repo_ids"] = model.primary_working_repo_ids
    d["primary_focus_area_ids"] = model.primary_focus_area_ids
    # Optional collections — include when present (even empty list), omit when None
    if model.repositories is not None:
        d["repositories"] = [_repo_to_dict(r) for r in model.repositories]
    if model.repository is not None:
        d["repository"] = _repo_to_dict(model.repository)
    if model.focusable_areas:
        d["focusable_areas"] = [_strip_none(dataclasses.asdict(a)) for a in model.focusable_areas]
    if model.approval_source:
        d["approval_source"] = model.approval_source
    if model.shared_glossary_terms:
        d["shared_glossary_terms"] = model.shared_glossary_terms
    return d


def load_manifest(
    path: Path,
) -> RepoSourcesManifest | RepoSourcesManifestV2:
    """Read a repo-sources.json file and dispatch to the correct validator.

    Peeks at manifest_version to decide v1 vs v2.
    Default for missing or unknown manifest_version: v1.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise PackSchemaError(
            "RepoSourcesManifest",
            ["Expected a JSON object"],
            path=str(path),
        )
    version = raw.get("manifest_version", "")
    if version == MANIFEST_VERSION_V2:
        return validate_manifest_v2(raw, path=path)
    return validate_manifest(raw, path=str(path))
