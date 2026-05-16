from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


def detect_git_root(path_value: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", path_value, "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    git_root = result.stdout.strip().replace("\\", "/")
    return git_root or None


def coerce_git_root_field(
    value: Any,
    *,
    field_label: str = "local_paths[].git_root",
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_label} must be a string or null")
    return value.replace("\\", "/")


def local_path_entry(path_value: str) -> dict[str, str]:
    normalized_path = path_value.replace("\\", "/")
    entry = {"host": normalized_path}
    git_root = detect_git_root(normalized_path)
    if git_root:
        entry["git_root"] = git_root
    return entry


def enrich_manifest_missing_git_roots(
    manifest: dict[str, Any],
    *,
    context_pack_dir: Path,
) -> bool:
    """Backfill local_paths[].git_root without overwriting existing values."""
    changed = False
    for repo in _iter_manifest_repos(manifest):
        local_paths = repo.get("local_paths")
        if not isinstance(local_paths, list):
            continue
        for index, raw_path in enumerate(local_paths):
            if isinstance(raw_path, str):
                git_root = detect_git_root(str(_resolve_host_path(context_pack_dir, raw_path)))
                if git_root:
                    local_paths[index] = {
                        "host": raw_path.replace("\\", "/"),
                        "git_root": git_root,
                    }
                    changed = True
                continue

            if not isinstance(raw_path, dict):
                continue
            host = raw_path.get("host")
            if not isinstance(host, str) or not host.strip():
                continue
            existing_git_root = raw_path.get("git_root")
            if isinstance(existing_git_root, str) and existing_git_root.strip():
                continue
            git_root = detect_git_root(str(_resolve_host_path(context_pack_dir, host)))
            if git_root:
                raw_path["git_root"] = git_root
                changed = True
    return changed


def _iter_manifest_repos(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    repos: list[dict[str, Any]] = []
    raw_repository = manifest.get("repository")
    if isinstance(raw_repository, dict):
        repos.append(raw_repository)
    raw_repositories = manifest.get("repositories")
    if isinstance(raw_repositories, list):
        repos.extend(repo for repo in raw_repositories if isinstance(repo, dict))
    return repos


def _resolve_host_path(context_pack_dir: Path, host: str) -> Path:
    normalized = host.replace("\\", "/").strip()
    candidate = Path(normalized)
    return candidate if candidate.is_absolute() else (context_pack_dir / candidate).resolve()
