"""File scanning, language detection, artifact classification, and repo
entry normalization extracted from app.py (slice 02)."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.bootstrap_detection import _detect_system_layer
from src.backend.mcp.git_roots import coerce_git_root_field
from src.backend.mcp.pack_schemas.manifest_v2 import LocalPath
from src.backend.mcp.path_resolution import pick_local_path

from .config import (
    DEFAULT_ALLOWED_SUFFIXES,
    DEFAULT_EXCLUDED_DIRS,
    RepoContextConfig,
)
from .utils import (
    ensure_list_of_strings,
    normalize_layer,
    resolve_path,
    unique_preserving_order,
)

_DEFAULT_MAX_FILES_PER_REPO = RepoContextConfig.from_env().max_files_per_repo


def _coerce_local_path(value: Any) -> LocalPath:
    if isinstance(value, str):
        return LocalPath(host=value.replace("\\", "/"))
    if isinstance(value, dict) and isinstance(value.get("host"), str):
        container = value.get("container")
        if container is not None and not isinstance(container, str):
            raise ValueError("local_paths[].container must be a string or null")
        return LocalPath(
            host=value["host"].replace("\\", "/"),
            container=container.replace("\\", "/") if isinstance(container, str) else None,
            git_root=coerce_git_root_field(value.get("git_root")),
        )
    raise ValueError("local_paths entries must be strings or objects with host")


def run_git_command(repo_root: Path, *args: str) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(repo_root), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return completed.stdout.strip() or None


def detect_source_ref(repo_root: Path) -> str:
    return run_git_command(repo_root, "rev-parse", "HEAD") or "workspace-unversioned"


def normalize_language(path: Path) -> str:
    suffix = path.suffix.lower()
    mapping = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".sql": "sql",
        ".sh": "shell",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".json": "json",
        ".md": "markdown",
        ".toml": "configuration",
        ".ini": "configuration",
        ".cfg": "configuration",
    }
    return mapping.get(suffix, "text")


def detect_artifact_type(path: Path) -> str:
    suffix = path.suffix.lower()
    lowered_parts = {part.lower() for part in path.parts}
    name = path.name.lower()
    if "tests" in lowered_parts or name.startswith("test_") or name.endswith("_test.py"):
        return "test-code"
    if suffix in {".yml", ".yaml", ".json", ".toml", ".ini", ".cfg"}:
        return "configuration"
    if suffix == ".sql":
        return "schema"
    if suffix == ".sh":
        return "script"
    if suffix == ".md":
        if "runbook" in name or "runbooks" in lowered_parts:
            return "runbook"
        return "architecture-doc"
    return "source-code"


def detect_path_kind(path: Path) -> str:
    lowered_parts = {part.lower() for part in path.parts}
    suffix = path.suffix.lower()
    if "tests" in lowered_parts:
        return "tests"
    if "docs" in lowered_parts or suffix == ".md":
        return "docs"
    if suffix in {".yml", ".yaml", ".json", ".toml", ".ini", ".cfg"}:
        return "config"
    if suffix == ".sh":
        return "scripts"
    return "src"


def looks_like_entrypoint(path: Path) -> bool:
    name = path.name.lower()
    return name in {
        "readme.md",
        "program.cs",
        "main.py",
        "app.py",
        "index.ts",
        "index.tsx",
        "index.js",
        "server.js",
        "server.ts",
    }


def read_preview(path: Path) -> str:
    try:
        with path.open(encoding="utf-8") as f:
            head = f.read(4096)
    except (OSError, UnicodeDecodeError):
        return ""
    for line in head.splitlines():
        cleaned = line.strip().lstrip("#").strip()
        if cleaned:
            return cleaned[:200]
    return ""


def relative_source_path(repo_root: Path, file_path: Path) -> str:
    return file_path.resolve().relative_to(repo_root.resolve()).as_posix()


def iter_scan_files(
    scan_targets: list[str],
    max_files_per_repo: int = _DEFAULT_MAX_FILES_PER_REPO,
) -> tuple[list[Path], list[str]]:
    collected: list[Path] = []
    warnings: list[str] = []
    for scan_target in scan_targets:
        target_path = Path(scan_target)
        if not target_path.exists():
            warnings.append(f"Configured scan target does not exist: {target_path}")
            continue
        if target_path.is_file():
            if target_path.suffix.lower() in DEFAULT_ALLOWED_SUFFIXES:
                collected.append(target_path)
            continue

        for root, dirs, files in os.walk(target_path):
            dirs[:] = [
                directory
                for directory in sorted(dirs)
                if directory not in DEFAULT_EXCLUDED_DIRS and not directory.startswith(".")
            ]
            for file_name in sorted(files):
                file_path = Path(root) / file_name
                if file_path.suffix.lower() not in DEFAULT_ALLOWED_SUFFIXES:
                    continue
                collected.append(file_path)
                if len(collected) >= max_files_per_repo:
                    warnings.append(
                        f"Scan truncated at {max_files_per_repo} files to keep live seeding surgical."
                    )
                    return unique_paths(collected), warnings
    return unique_paths(collected), warnings


def unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    ordered: list[Path] = []
    for path in paths:
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        ordered.append(path)
    return ordered


def normalize_repo_entry(
    context_pack_dir: Path,
    entry: dict[str, Any],
    qmd_scope_root: str,
) -> dict[str, Any]:
    repo_name = str(entry.get("repo_name") or entry.get("name") or "").strip()
    repo_id = str(entry.get("repo_id") or repo_name).strip()
    if not repo_id:
        raise ValueError("Each repository entry requires 'repo_id' or 'repo_name'")
    if not repo_name:
        repo_name = repo_id

    raw_local_paths = entry.get("local_paths") or []
    if not isinstance(raw_local_paths, list):
        raise ValueError("Field 'local_paths' must be a list")
    local_paths = [_coerce_local_path(item) for item in raw_local_paths]
    if not local_paths:
        raise ValueError(f"Repository '{repo_id}' requires at least one local path")

    artifact_roots = ensure_list_of_strings(entry.get("artifact_roots"), "artifact_roots")
    document_paths = ensure_list_of_strings(entry.get("document_paths"), "document_paths")
    languages = [
        item.strip().lower()
        for item in ensure_list_of_strings(entry.get("languages"), "languages")
        if item.strip()
    ]
    tags = [
        item.strip()
        for item in ensure_list_of_strings(entry.get("tags"), "tags")
        if item.strip()
    ]
    bounded_context = str(entry.get("bounded_context") or "").strip() or None
    system_layer = normalize_layer(entry.get("system_layer"))

    existing_roots: list[str] = []
    missing_roots: list[str] = []
    scan_targets: list[str] = []
    warnings: list[str] = []

    for local_path in local_paths:
        picked_path = pick_local_path(local_path)
        resolved_root = resolve_path(context_pack_dir, picked_path)
        root_str = str(resolved_root)
        if resolved_root.exists():
            existing_roots.append(root_str)
            if artifact_roots:
                for artifact_root in artifact_roots:
                    scan_targets.append(str((resolved_root / artifact_root).resolve()))
            else:
                scan_targets.append(root_str)

            for document_path in document_paths:
                scan_targets.append(str((resolved_root / document_path).resolve()))
        else:
            missing_roots.append(root_str)

    scan_targets = unique_preserving_order(scan_targets)

    # Re-run system_layer detection on the resolved repo path so that
    # reseeds pick up classification changes (e.g. test-layer detection)
    # without requiring a full re-bootstrap.
    if existing_roots:
        system_layer = _detect_system_layer(Path(existing_roots[0]), system_layer)

    if not existing_roots:
        warnings.append(
            "No configured local paths currently exist; this repo cannot be seeded yet."
        )
    if not languages:
        warnings.append(
            "No languages declared; retrieval will rely more heavily on path and repo tags."
        )
    if not bounded_context:
        warnings.append(
            "No bounded_context declared; cross-repo retrieval may be less precise."
        )
    if missing_roots:
        warnings.append(
            "One or more configured local paths are missing; review workstation checkout locations."
        )
    if not artifact_roots and not document_paths:
        warnings.append(
            "No artifact_roots or document_paths declared; live seeding will fall pmck to broad repo-root scanning."
        )

    qmd_targets: dict[str, Any] = {
        "canonical_repo_summary": (
            f"{qmd_scope_root}/canonical/repos/{repo_id}/repo-summary.md"
        ),
        "operational_bootstrap_note": (
            f"{qmd_scope_root}/operational/bootstrap/{repo_id}/initial-index.md"
        ),
        "estate_partition": f"{qmd_scope_root}/estate/{system_layer}/{repo_id}/",
        "language_partitions": [
            f"{qmd_scope_root}/estate/languages/{language}/{repo_id}/"
            for language in languages
        ],
    }
    if bounded_context:
        qmd_targets["bounded_context_summary"] = (
            f"{qmd_scope_root}/canonical/contexts/{bounded_context}/repo-{repo_id}.md"
        )
    if document_paths:
        qmd_targets["documents_partition"] = (
            f"{qmd_scope_root}/estate/documents/{repo_id}/"
        )

    repository_type = str(entry.get("repository_type") or "").strip().lower() or None
    if repository_type and repository_type not in ("primary", "support"):
        repository_type = None

    result: dict[str, Any] = {
        "repo_id": repo_id,
        "repo_name": repo_name,
        "owner": str(entry.get("owner") or "").strip() or None,
        "bounded_context": bounded_context,
        "system_layer": system_layer,
        "languages": languages,
        "tags": tags,
        "existing_roots": existing_roots,
        "missing_roots": missing_roots,
        "scan_targets": scan_targets,
        "qmd_targets": qmd_targets,
        "status": "ready" if existing_roots else "blocked",
        "warnings": warnings,
    }
    if repository_type:
        result["repository_type"] = repository_type
    return result
