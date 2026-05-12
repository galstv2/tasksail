"""v1 → v2 manifest upgrade utility.

Provides both in-memory (upgrade_v1_to_v2) and atomic file-write
(upgrade_manifest_file_atomic) paths. Both are idempotent: calling on
a v2 manifest is a safe no-op.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from src.backend.mcp.pack_constants import MANIFEST_VERSION_V2
from src.backend.mcp.pack_schemas.manifest_v2 import LocalPath
from src.backend.mcp.path_resolution import pick_local_path
from src.backend.mcp.repo_category_probe import (
    classify_repo_category,
    repo_category_for_wizard_role,
)


def _coerce_local_path(value: Any) -> LocalPath | None:
    if isinstance(value, str):
        return LocalPath(host=value.replace("\\", "/"))
    if isinstance(value, dict) and isinstance(value.get("host"), str):
        container = value.get("container")
        if container is not None and not isinstance(container, str):
            return None
        return LocalPath(
            host=value["host"].replace("\\", "/"),
            container=container.replace("\\", "/") if isinstance(container, str) else None,
        )
    return None


def _dump_local_path(value: Any) -> dict[str, str | None] | Any:
    local_path = _coerce_local_path(value)
    if local_path is None:
        return value
    return {"host": local_path.host, "container": local_path.container}


def upgrade_v1_to_v2(
    manifest_v1: dict[str, Any],
    *,
    repo_roots: dict[str, Path],
) -> dict[str, Any]:
    """Upgrade a v1 manifest dict to v2 in-place (returns new dict).

    Args:
        manifest_v1: Parsed v1 (or already-v2) manifest dict.
        repo_roots: Mapping of repo_id → resolved local Path used for the
            category probe. Unknown repo_ids fall through to 'unknown'.

    Returns:
        A new dict with manifest_version set to v2 and per-repo fields added.
        If the input is already v2, it is returned unchanged (idempotent).
    """
    if manifest_v1.get("manifest_version") == MANIFEST_VERSION_V2:
        return manifest_v1

    result = dict(manifest_v1)
    result["manifest_version"] = MANIFEST_VERSION_V2

    def _upgrade_repo(repo: dict[str, Any], repo_root: Path | None) -> dict[str, Any]:
        r = dict(repo)
        # Rename repository_type → repo_focus (keep repository_type for compat)
        existing_repo_type = r.get("repository_type") or ""
        r["repo_focus"] = existing_repo_type
        r["repo_focus_authored"] = False

        # Probe for category
        category = "unknown"
        if repo_root is not None and repo_root.is_dir():
            probed, _ = classify_repo_category(repo_root)
            category = probed

        if category == "unknown":
            # Fall back to system_layer → category mapping
            category = repo_category_for_wizard_role(r.get("system_layer") or "") or "unknown"

        r["repo_category"] = category
        r["repo_category_authored"] = False
        if isinstance(r.get("local_paths"), list):
            r["local_paths"] = [_dump_local_path(path) for path in r["local_paths"]]
        return r

    if "repositories" in result and isinstance(result["repositories"], list):
        upgraded: list[dict[str, Any]] = []
        for repo in result["repositories"]:
            rid = repo.get("repo_id", "")
            root = repo_roots.get(rid)
            upgraded.append(_upgrade_repo(repo, root))
        result["repositories"] = upgraded

    if "repository" in result and isinstance(result["repository"], dict):
        rid = result["repository"].get("repo_id", "")
        root = repo_roots.get(rid)
        result["repository"] = _upgrade_repo(result["repository"], root)

    return result


def build_repo_roots_from_manifest(
    raw: dict[str, Any],
    *,
    fallback_base: Path | None = None,
) -> dict[str, Path]:
    """Derive a `repo_id → resolved Path` mapping from the manifest's local_paths.

    When `fallback_base` is given, repos with no `local_paths` get `fallback_base / repo_id`.
    """
    roots: dict[str, Path] = {}

    def _add(repo: object) -> None:
        if not isinstance(repo, dict):
            return
        rid = repo.get("repo_id") or ""
        if not rid:
            return
        local_paths = repo.get("local_paths") or []
        if local_paths and isinstance(local_paths, list):
            local_path = _coerce_local_path(local_paths[0])
            if local_path is not None:
                roots[rid] = Path(pick_local_path(local_path)).resolve()
        elif fallback_base is not None:
            roots[rid] = (fallback_base / rid).resolve()

    for repo in raw.get("repositories") or []:
        _add(repo)
    _add(raw.get("repository"))
    return roots


def upgrade_manifest_file_atomic(
    manifest_path: Path,
    *,
    repo_roots: dict[str, Path],
    raw: dict[str, Any] | None = None,
) -> bool:
    """Read, upgrade, and atomically write-back the manifest.

    If `raw` is provided, it is used directly (avoiding a second JSON read);
    otherwise the file is parsed here.

    Returns:
        True if the manifest was upgraded (was v1), False if already v2.

    Raises:
        Any exception from JSON parsing, the probe, or file I/O is re-raised
        after cleaning up the temp file.
    """
    parsed: dict[str, Any] = (
        raw if raw is not None
        else json.loads(manifest_path.read_text(encoding="utf-8"))
    )
    if parsed.get("manifest_version") == MANIFEST_VERSION_V2:
        return False

    upgraded = upgrade_v1_to_v2(parsed, repo_roots=repo_roots)

    tmp_fd, tmp_path_str = tempfile.mkstemp(
        dir=manifest_path.parent, suffix=".tmp"
    )
    tmp_path = Path(tmp_path_str)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(upgraded, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp_path, manifest_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return True
