"""Main bootstrap orchestrator for context pack creation."""
from __future__ import annotations

import json
import logging
from os.path import commonpath
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.bootstrap_builders import (
    _build_distributed_review_payload,
    _build_monolith_review_payload,
    _merge_candidate_focus_areas,
    _merge_candidate_repos,
)
from src.backend.mcp.context_estate.bootstrap_normalization import normalize_bootstrap_answers
from src.backend.mcp.context_estate.constants import (
    ALLOWED_ESTATE_TYPES,
    DEFAULT_SCOPE_MODE,
    DISTRIBUTED_ESTATE_TYPES,
)
from src.backend.mcp.context_estate_discovery import discover_estate
from src.backend.mcp.context_estate_draft_index import write_draft_artifact
from src.backend.mcp.context_estate_manifest import write_approved_manifest
from src.backend.mcp.pack_schemas import validate_answers, validate_manifest
from src.backend.mcp.pack_writer import PackWriter
from src.backend.mcp.repo_context_mcp.utils import (
    is_within,
    normalize_optional_string,
    utc_now,
)

_bootstrap_logger = logging.getLogger(__name__)


def _effective_discovery_root(
    provided_root: Path,
    answers: dict[str, Any],
) -> Path:
    repo_roots = [Path(repo["repo_root"]).resolve() for repo in answers["repositories"]]
    if repo_roots and all(is_within(provided_root, repo_root) for repo_root in repo_roots):
        return provided_root

    if repo_roots:
        return Path(commonpath([str(path) for path in repo_roots])).resolve()

    return provided_root


def _determine_estate_mode(
    answers: dict[str, Any],
    discovery_payload: dict[str, Any],
    requested_mode: str,
) -> str:
    if requested_mode in ALLOWED_ESTATE_TYPES:
        return requested_mode

    answer_mode = normalize_optional_string(answers.get("discovery_mode")).lower()
    if answer_mode in ALLOWED_ESTATE_TYPES:
        return answer_mode

    answer_estate_type = normalize_optional_string(answers.get("estate_type")).lower()
    if answer_estate_type in ALLOWED_ESTATE_TYPES:
        return answer_estate_type

    if len(answers["repositories"]) > 1:
        inferred = "distributed"
    else:
        candidate_focus_areas = discovery_payload.get("candidate_focus_areas")
        if isinstance(candidate_focus_areas, list) and candidate_focus_areas:
            inferred = "monolith"
        else:
            inferred = "distributed"

    _bootstrap_logger.warning(
        "bootstrap.estate-type-fallback",
        extra={
            "event": "bootstrap.estate-type-fallback",
            "requested_mode": requested_mode,
            "inferred": inferred,
            "reason": (
                "No deterministic estate type in request or answers; "
                "applying heuristic."
            ),
        },
    )
    return inferred


def bootstrap_context_pack(
    context_pack_dir: Path,
    answers_payload: dict[str, Any],
    discovery_root: Path,
    *,
    requested_mode: str = "auto",
) -> dict[str, Any]:
    normalized_answers = normalize_bootstrap_answers(answers_payload)
    resolved_context_pack_dir = context_pack_dir.expanduser().resolve()
    resolved_discovery_root = discovery_root.expanduser().resolve()
    effective_root = _effective_discovery_root(
        resolved_discovery_root,
        normalized_answers,
    )

    discovery_payload = discover_estate(
        effective_root,
        mode=requested_mode,
        allow_missing=True,
    )
    effective_mode = _determine_estate_mode(
        normalized_answers,
        discovery_payload,
        requested_mode,
    )
    discovery_payload["estate_type"] = effective_mode
    discovery_payload["discovery_mode"] = effective_mode

    if effective_mode in DISTRIBUTED_ESTATE_TYPES:
        discovery_payload = _merge_candidate_repos(
            discovery_payload,
            normalized_answers,
            effective_root,
        )
        review_payload = _build_distributed_review_payload(
            normalized_answers,
            discovery_payload,
        )
    else:
        discovery_payload = _merge_candidate_focus_areas(
            discovery_payload,
            normalized_answers,
            effective_root,
        )
        review_payload = _build_monolith_review_payload(
            normalized_answers,
            discovery_payload,
        )

    resolved_context_pack_dir.mkdir(parents=True, exist_ok=True)
    (resolved_context_pack_dir / "instruction-overlays").mkdir(parents=True, exist_ok=True)
    (resolved_context_pack_dir / "mcp").mkdir(parents=True, exist_ok=True)
    (resolved_context_pack_dir / "qmd" / "bootstrap").mkdir(parents=True, exist_ok=True)

    answers_path = resolved_context_pack_dir / "qmd" / "bootstrap" / "bootstrap-answers.json"
    answers_model = validate_answers(normalized_answers, path=str(answers_path))
    PackWriter(resolved_context_pack_dir).write_answers(answers_model)

    draft_path = write_draft_artifact(
        resolved_context_pack_dir,
        discovery_payload,
        generated_at=utc_now(),
    )
    manifest_path = write_approved_manifest(
        resolved_context_pack_dir,
        discovery_payload,
        review_payload,
        approved_at=utc_now(),
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_manifest(manifest, path=str(manifest_path))

    return {
        "context_pack_id": manifest["context_pack_id"],
        "display_name": manifest["display_name"],
        "estate_type": manifest["estate_type"],
        "default_scope_mode": manifest.get("default_scope_mode", DEFAULT_SCOPE_MODE),
        "context_pack_dir": str(resolved_context_pack_dir),
        "discovery_root": str(effective_root),
        "discovery_mode": effective_mode,
        "bootstrap_answers_path": str(answers_path),
        "draft_path": str(draft_path),
        "manifest_path": str(manifest_path),
        "warnings": discovery_payload.get("warnings", []),
        "repository_count": len(manifest.get("repositories", [])),
        "focus_target_count": len(manifest.get("focusable_areas", []))
        if manifest.get("focusable_areas")
        else len(manifest.get("repositories", [])),
        "primary_working_repo_ids": manifest.get("primary_working_repo_ids", []),
        "primary_focus_area_ids": manifest.get("primary_focus_area_ids", []),
    }
