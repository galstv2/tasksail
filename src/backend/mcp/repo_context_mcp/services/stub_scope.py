"""Stub scope tree writer.

Writes a structurally complete but empty ``qmd/context-packs/<id>/`` tree
so downstream readers never hit a missing directory or a missing index file
after a new-flow pack creation where the live seed was skipped.

Spec ref: phase-05-dead-pack-remediation.md §3 Gate G1.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ..record_factory import pack_seed_state_path
from ..utils import load_json, utc_now, write_json_atomic
from .qmd_index_service import QmdIndexService

logger = logging.getLogger(__name__)

# Directories created unconditionally under the scope root.
_PARTITION_DIRS = ("canonical", "operational", "archive")

# Marker `reason` values. Defined once here; tests import these constants so a
# typo on either side fails import rather than silently mismatching.
REASON_SEED_SKIPPED = "new-flow-seed-skipped"
REASON_EMPTY_REPOS = "new-flow-empty-repos"
REASON_NEEDS_REVIEW = "new-flow-needs-review"
REASON_SEED_OPTED_OUT = "new-flow-seed-opted-out"
REASON_PARTIAL_READINESS = "new-flow-partial-readiness"


def _derive_reason(
    plan_repo_statuses: list[str] | None,
    plan_parsed: bool,
) -> str:
    """Return the ``reason`` string for the pack seed-state marker."""
    if not plan_parsed:
        return REASON_SEED_SKIPPED

    statuses = plan_repo_statuses or []
    if not statuses:
        return REASON_SEED_SKIPPED

    unique = set(statuses)
    if unique == {"blocked"}:
        return REASON_EMPTY_REPOS
    if "needs-review" in unique and "blocked" not in unique:
        return REASON_NEEDS_REVIEW
    if unique == {"ready"}:
        return REASON_SEED_OPTED_OUT
    return REASON_PARTIAL_READINESS


def write_empty_scope_tree(
    context_pack_dir: Path,
    manifest_path: Path,
    *,
    plan_overall_status: str | None = None,
    plan_repo_statuses: list[str] | None = None,
) -> dict[str, Any]:
    """Write a structurally complete empty scope tree under *context_pack_dir*.

    Reads the v2 manifest at *manifest_path* to discover ``qmd_scope_root``
    and the declared repositories.  Creates the partition directory tree,
    writes four empty index JSON files using ``QmdIndexService`` builders
    (so the stub stays in lockstep with any future schema change), and writes
    a pack-level ``seed-state.json`` with ``state: "bootstrap-empty"``.

    Parameters
    ----------
    context_pack_dir:
        Absolute path to the context pack directory.
    manifest_path:
        Path to ``qmd/repo-sources.json`` inside the pack.
    plan_overall_status:
        The ``overall_status`` from the seed plan (forwarded to the marker).
    plan_repo_statuses:
        List of per-repo ``status`` values from the seed plan (forwarded to
        the marker).

    Returns
    -------
    dict
        JSON-serialisable summary::

            {wrote: bool, scope_root: str, repo_count: int, marker_path: str}
    """
    plan_parsed = plan_overall_status is not None or plan_repo_statuses is not None

    # ------------------------------------------------------------------
    # Load manifest to discover qmd_scope_root and repositories.
    # ------------------------------------------------------------------
    try:
        manifest = load_json(manifest_path)
    except Exception:
        logger.warning(
            "stub_scope: failed to load manifest at %s — writing stub with no repos",
            manifest_path,
            exc_info=True,
        )
        manifest = {}

    qmd_scope_root_rel = manifest.get("qmd_scope_root", "")
    if not qmd_scope_root_rel:
        logger.warning(
            "stub_scope: manifest missing qmd_scope_root — defaulting to qmd/context-packs/%s",
            context_pack_dir.name,
        )
        qmd_scope_root_rel = f"qmd/context-packs/{context_pack_dir.name}"

    scope_dir = (context_pack_dir / qmd_scope_root_rel).resolve()

    # Repositories list — may be missing or empty for a brand-new pack.
    raw_repos: list[Any] = []
    if isinstance(manifest.get("repositories"), list):
        raw_repos = manifest["repositories"]
    elif isinstance(manifest.get("repository"), dict):
        raw_repos = [manifest["repository"]]

    for part in _PARTITION_DIRS:
        (scope_dir / part).mkdir(parents=True, exist_ok=True)
        (scope_dir / part / ".gitkeep").touch()
    (scope_dir / "indexes").mkdir(parents=True, exist_ok=True)

    for repo in raw_repos:
        if not isinstance(repo, dict):
            continue
        repo_id = repo.get("repo_id") or repo.get("repo_name")
        if not repo_id:
            continue
        raw_system_layer = repo.get("system_layer")
        system_layer = raw_system_layer if isinstance(raw_system_layer, str) and raw_system_layer else None
        if system_layer is None:
            logger.warning(
                "stub_scope: repo %r missing system_layer — defaulting to 'shared'",
                repo_id,
            )
            system_layer = "shared"
        estate_dir = scope_dir / "estate" / system_layer / repo_id
        estate_dir.mkdir(parents=True, exist_ok=True)
        (estate_dir / ".gitkeep").touch()

    # ------------------------------------------------------------------
    # Write empty index files using QmdIndexService builders.
    # ------------------------------------------------------------------
    index_service = QmdIndexService(workspace_root=context_pack_dir)

    repo_index = index_service.build_repository_index(
        scope_dir=scope_dir,
        repositories=[],
    )
    write_json_atomic(scope_dir / "indexes" / "repositories.json", repo_index)

    task_index = index_service.build_glopml_task_index(scope_dir=scope_dir)
    write_json_atomic(scope_dir / "indexes" / "tasks.json", task_index)

    lineage_index = index_service.build_top_level_lineage_index(scope_dir=scope_dir)
    write_json_atomic(scope_dir / "indexes" / "lineage.json", lineage_index)

    cp_index = index_service.build_context_pack_index(
        scope_dir=scope_dir,
        repository_entries=[],
        task_entries=[],
        lineage_entries=[],
        latest_seed_run_path=None,
    )
    write_json_atomic(scope_dir / "indexes" / "context-pack-index.json", cp_index)

    # ------------------------------------------------------------------
    # Write pack-level seed-state marker.
    # ------------------------------------------------------------------
    reason = _derive_reason(plan_repo_statuses, plan_parsed)
    marker_path = pack_seed_state_path(scope_dir)
    marker: dict[str, Any] = {
        "state": "bootstrap-empty",
        "created_at": utc_now(),
        "reason": reason,
        "details": {
            "plan_overall_status": plan_overall_status,
            "plan_repo_statuses": plan_repo_statuses,
            "plan_parsed": plan_parsed,
        },
    }
    write_json_atomic(marker_path, marker)

    logger.info(
        "stub_scope: wrote empty scope tree at %s (reason=%s, repos=%d)",
        scope_dir,
        reason,
        len(raw_repos),
    )

    return {
        "wrote": True,
        "scope_root": str(scope_dir),
        "repo_count": len(raw_repos),
        "marker_path": str(marker_path),
    }
