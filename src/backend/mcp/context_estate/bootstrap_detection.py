"""Bootstrap detection helpers: language, document-path, and system-layer probes."""
from __future__ import annotations

import json
from pathlib import Path

from src.backend.mcp.context_estate.constants import (
    EXCLUDED_SCAN_DIRS,
    EXTENSION_LANGUAGE_MAP,
    FRONTEND_SIGNALS,
    INFRA_SIGNALS,
    MAX_SCAN_FILES,
)


def _detect_languages(repo_root: Path) -> list[str]:
    """Scan a repo directory for file extensions and return detected languages."""
    if not repo_root.is_dir():
        return []
    counts: dict[str, int] = {}
    scanned = 0
    for item in repo_root.rglob("*"):
        if scanned >= MAX_SCAN_FILES:
            break
        if any(part in EXCLUDED_SCAN_DIRS for part in item.parts):
            continue
        if not item.is_file():
            continue
        scanned += 1
        lang = EXTENSION_LANGUAGE_MAP.get(item.suffix.lower())
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    return sorted(counts, key=lambda lang: counts[lang], reverse=True)


def _detect_document_paths(repo_root: Path) -> list[str]:
    """Return document directory names present at the repo root."""
    if not repo_root.is_dir():
        return []
    result: list[str] = []
    for name in ("docs", "documentation", "doc"):
        if (repo_root / name).is_dir():
            result.append(name)
    return result


def _detect_system_layer(repo_root: Path, declared_layer: str) -> str:
    """Refine system_layer detection when the declared layer is generic."""
    if declared_layer in ("frontend", "infrastructure", "database", "documents"):
        return declared_layer
    if not repo_root.is_dir():
        return declared_layer
    children = {item.name for item in repo_root.iterdir()}
    if children & INFRA_SIGNALS:
        return "infrastructure"
    if children & FRONTEND_SIGNALS:
        return "frontend"
    pkg_json = repo_root / "package.json"
    if pkg_json.is_file():
        try:
            pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
            all_deps = {
                **(pkg.get("dependencies") or {}),
                **(pkg.get("devDependencies") or {}),
            }
            frontend_packages = {"react", "vue", "angular", "next", "nuxt", "svelte", "@angular/core"}
            if all_deps.keys() & frontend_packages:
                return "frontend"
        except (json.JSONDecodeError, OSError):
            pass
    return declared_layer
