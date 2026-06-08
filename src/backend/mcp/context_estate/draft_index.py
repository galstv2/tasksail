from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from src.backend.mcp.repo_context_mcp.utils import resolve_path_within

DEFAULT_DRAFT_FILE = "qmd/bootstrap/discovery-structure.json"
AUTHORITATIVE_MANIFEST_FILE = "qmd/repo-sources.json"
DRAFT_SCHEMA_VERSION = "qmd-draft-structure/v1"


def build_draft_artifact(
    discovery_payload: dict[str, Any],
    *,
    generated_at: str,
    context_pack_dir: Path,
) -> dict[str, Any]:
    context_pack_dir = context_pack_dir.resolve()
    return {
        "schema_version": DRAFT_SCHEMA_VERSION,
        "artifact_type": "discovery-structure-draft",
        "artifact_status": "generated",
        "generated_at": generated_at,
        "context_pack_dir": str(context_pack_dir),
        "context_pack_id": context_pack_dir.name,
        "estate_type": discovery_payload["estate_type"],
        "root_path": discovery_payload["root_path"],
        "discovered_at": discovery_payload["discovered_at"],
        "warnings": list(discovery_payload.get("warnings", [])),
        "high_signal_paths": list(
            discovery_payload.get("high_signal_paths", [])
        ),
        "root_repo_category": discovery_payload.get("root_repo_category"),
        "root_repo_category_confidence": discovery_payload.get(
            "root_repo_category_confidence"
        ),
        "candidate_repos": list(discovery_payload.get("candidate_repos", [])),
        "candidate_focus_areas": list(
            discovery_payload.get("candidate_focus_areas", [])
        ),
    }


def resolve_draft_artifact_path(
    context_pack_dir: Path,
    draft_file: str = DEFAULT_DRAFT_FILE,
) -> Path:
    resolved_context_pack_dir = context_pack_dir.resolve()
    draft_path = resolve_path_within(
        resolved_context_pack_dir,
        draft_file,
        "draft_file",
    )
    manifest_path = resolve_path_within(
        resolved_context_pack_dir,
        AUTHORITATIVE_MANIFEST_FILE,
        "manifest_file",
    )
    if draft_path == manifest_path:
        raise ValueError(
            "Draft artifact path must remain distinct from "
            "qmd/repo-sources.json"
        )
    return draft_path


def write_draft_artifact(
    context_pack_dir: Path,
    discovery_payload: dict[str, Any],
    *,
    generated_at: str,
    draft_file: str = DEFAULT_DRAFT_FILE,
) -> Path:
    resolved_context_pack_dir = context_pack_dir.resolve()
    draft_path = resolve_draft_artifact_path(
        resolved_context_pack_dir,
        draft_file,
    )
    artifact = build_draft_artifact(
        discovery_payload,
        generated_at=generated_at,
        context_pack_dir=resolved_context_pack_dir,
    )
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    draft_path.write_text(
        json.dumps(artifact, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return draft_path
