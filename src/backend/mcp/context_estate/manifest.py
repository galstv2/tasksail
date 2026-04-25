"""Approved manifest construction and file I/O.

Public API
----------
- ``normalize_estate_type``
- ``resolve_manifest_path``
- ``resolve_draft_path``
- ``build_approved_manifest``
- ``write_approved_manifest``
- ``approve_manifest_from_files``
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.constants import (
    ALLOWED_ESTATE_TYPES,
    DEFAULT_REPOSITORY_TYPE,
    DISTRIBUTED_ESTATE_TYPES,
)
from src.backend.mcp.context_estate.helpers import (
    _normalize_focus_area_id_list,
    _normalize_repo_id_list,
)
from src.backend.mcp.context_estate.manifest_normalization import (
    _normalize_distributed_repositories,
    _normalize_focusable_areas,
    _normalize_monolith_repository,
)
from src.backend.mcp.context_estate_draft_index import DEFAULT_DRAFT_FILE
from src.backend.mcp.repo_context_mcp.utils import (
    ensure_non_empty_string,
    load_json,
    normalize_optional_string,
    normalize_scope_mode,
    normalize_string_list,
    resolve_path_within,
)

# ---- Manifest-specific constants -------------------------------------------
DEFAULT_MANIFEST_FILE = "qmd/repo-sources.json"
MANIFEST_VERSION = "qmd-repo-sources/v1"


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------
def normalize_estate_type(value: str | None, draft_estate_type: str) -> str:
    raw = normalize_optional_string(value) or draft_estate_type
    normalized = raw.lower()
    if normalized == "distributed":
        return "distributed-platform"
    if normalized == "monolith":
        return "monolith"
    if normalized not in ALLOWED_ESTATE_TYPES:
        raise ValueError(f"Unsupported estate_type: {raw}")
    return normalized


def resolve_manifest_path(
    context_pack_dir: Path,
    manifest_file: str = DEFAULT_MANIFEST_FILE,
) -> Path:
    return resolve_path_within(
        context_pack_dir.resolve(),
        manifest_file,
        "manifest_file",
    )


def resolve_draft_path(
    context_pack_dir: Path,
    draft_file: str = DEFAULT_DRAFT_FILE,
) -> Path:
    return resolve_path_within(
        context_pack_dir.resolve(),
        draft_file,
        "draft_file",
    )


def build_approved_manifest(
    draft_payload: dict[str, Any],
    review_payload: dict[str, Any],
    *,
    approved_at: str,
    context_pack_dir: Path,
) -> dict[str, Any]:
    context_pack_id = ensure_non_empty_string(
        review_payload.get("context_pack_id") or context_pack_dir.name,
        "context_pack_id",
    )
    draft_estate_type = ensure_non_empty_string(
        draft_payload.get("estate_type"),
        "estate_type",
    )
    estate_type = normalize_estate_type(
        normalize_optional_string(review_payload.get("estate_type")),
        draft_estate_type,
    )

    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "manifest_status": "approved",
        "approved_at": approved_at,
        "context_pack_id": context_pack_id,
        "display_name": ensure_non_empty_string(
            review_payload.get("display_name")
            or review_payload.get("estate_name")
            or context_pack_id,
            "display_name",
        ),
        "estate_type": estate_type,
        "qmd_scope_root": f"qmd/context-packs/{context_pack_id}",
        "default_scope_mode": normalize_scope_mode(
            review_payload.get("default_scope_mode")
        ),
        "approval_source": {
            "artifact_type": "discovery-structure-draft",
            "draft_discovered_at": ensure_non_empty_string(
                draft_payload.get("discovered_at"),
                "discovered_at",
            ),
            "draft_root_path": ensure_non_empty_string(
                draft_payload.get("root_path"),
                "root_path",
            ),
        },
    }

    if estate_type in DISTRIBUTED_ESTATE_TYPES:
        repositories = _normalize_distributed_repositories(
            review_payload.get("repositories"),
            draft_payload,
        )
        known_repo_ids = {entry["repo_id"] for entry in repositories}
        primary_repo_ids = _normalize_repo_id_list(
            review_payload.get("primary_working_repo_ids"),
            known_repo_ids,
        )
        if not primary_repo_ids and repositories:
            primary_repo_ids = [repositories[0]["repo_id"]]
        primary_repo_id_set = set(primary_repo_ids)
        for repo in repositories:
            authored_repository_type = repo.pop(
                "_authored_repository_type",
                False,
            )
            expected_type = (
                "primary"
                if repo["repo_id"] in primary_repo_id_set
                else DEFAULT_REPOSITORY_TYPE
            )
            if (
                authored_repository_type
                and repo.get("repository_type") != expected_type
            ):
                raise ValueError(
                    "primary_working_repo_ids and repository_type entries are "
                    f"inconsistent for repo_id={repo['repo_id']}"
                )
            repo["repository_type"] = expected_type
        primary_typed = [
            repo
            for repo in repositories
            if repo.get("repository_type") == "primary"
        ]
        if not primary_typed:
            raise ValueError("Manifest must contain at least one primary repository.")
        if len(primary_typed) != len(primary_repo_ids):
            raise ValueError(
                "primary_working_repo_ids and repository_type=primary entries "
                "are inconsistent."
            )
        manifest["repositories"] = repositories
        manifest["primary_working_repo_ids"] = primary_repo_ids
    else:
        repositories = _normalize_monolith_repository(
            review_payload.get("repository"),
            draft_payload,
        )
        focusable_areas = _normalize_focusable_areas(
            review_payload.get("focusable_areas"),
            draft_payload,
        )
        known_focus_ids = {entry["focus_id"] for entry in focusable_areas}
        for repo in repositories:
            authored_repository_type = repo.pop(
                "_authored_repository_type",
                False,
            )
            if (
                authored_repository_type
                and repo.get("repository_type") != "primary"
            ):
                raise ValueError(
                    "Monolith repository_type must be primary when provided."
                )
            repo["repository_type"] = "primary"
        manifest["repositories"] = repositories
        manifest["focusable_areas"] = focusable_areas
        primary_focus_ids = _normalize_focus_area_id_list(
            review_payload.get("primary_focus_area_ids"),
            known_focus_ids,
        )
        if primary_focus_ids:
            manifest["primary_focus_area_ids"] = primary_focus_ids

    glossary = normalize_string_list(
        review_payload.get("shared_glossary_terms")
    )
    if glossary:
        manifest["shared_glossary_terms"] = glossary

    return manifest


def write_approved_manifest(
    context_pack_dir: Path,
    draft_payload: dict[str, Any],
    review_payload: dict[str, Any],
    *,
    approved_at: str,
    manifest_file: str = DEFAULT_MANIFEST_FILE,
) -> Path:
    resolved_context_pack_dir = context_pack_dir.resolve()
    manifest_path = resolve_manifest_path(
        resolved_context_pack_dir,
        manifest_file,
    )
    manifest = build_approved_manifest(
        draft_payload,
        review_payload,
        approved_at=approved_at,
        context_pack_dir=resolved_context_pack_dir,
    )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return manifest_path


def approve_manifest_from_files(
    *,
    context_pack_dir: Path,
    review_file: Path,
    approved_at: str,
    draft_file: str = DEFAULT_DRAFT_FILE,
    manifest_file: str = DEFAULT_MANIFEST_FILE,
) -> tuple[Path, dict[str, Any]]:
    resolved_context_pack_dir = context_pack_dir.resolve()
    draft_path = resolve_draft_path(resolved_context_pack_dir, draft_file)
    review_payload = load_json(review_file)
    draft_payload = load_json(draft_path)
    manifest_path = write_approved_manifest(
        resolved_context_pack_dir,
        draft_payload,
        review_payload,
        approved_at=approved_at,
        manifest_file=manifest_file,
    )
    return manifest_path, load_json(manifest_path)
