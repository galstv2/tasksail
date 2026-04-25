"""Re-probe and refresh ``repository_type`` values in a seeded manifest.

Extracted from ``seeding_service.py`` to keep that module under the per-file
size limit. Behavior is unchanged from the prior in-class implementation.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from src.backend.mcp.repo_type_probe import classify_repository_type

from ..utils import load_json


def update_manifest_repository_types(
    manifest_path: Path,
    plan_repos: list[dict[str, Any]],
    *,
    write_json: Callable[[Path, dict[str, Any]], None],
) -> None:
    """Re-probe repos and update manifest ``repository_type`` values.

    Only writes the manifest if at least one classification changed.
    """
    try:
        manifest = load_json(manifest_path)
        repositories = manifest.get("repositories")
        if not isinstance(repositories, list):
            return

        repo_roots_by_id: dict[str, str] = {}
        for plan_repo in plan_repos:
            roots = plan_repo.get("existing_roots", [])
            if roots:
                repo_roots_by_id[plan_repo["repo_id"]] = roots[0]

        changed = False
        for repo in repositories:
            repo_id = repo.get("repo_id", "")
            root_path = repo_roots_by_id.get(repo_id)
            if not root_path:
                continue
            probe = classify_repository_type(
                Path(root_path),
                languages=repo.get("languages"),
                repo_name=repo.get("repo_name", repo_id),
            )
            new_type = probe["repository_type"]
            if repo.get("repository_type") != new_type:
                repo["repository_type"] = new_type
                changed = True

        if changed:
            write_json(manifest_path, manifest)
    except Exception:
        logging.getLogger(__name__).debug(
            "Failed to update manifest repository types during reseed",
            exc_info=True,
        )
