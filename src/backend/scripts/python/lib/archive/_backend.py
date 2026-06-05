"""Lazy accessors for backend dependencies.

All backend imports are deferred to avoid import-time side effects when
only a subset of archive functions is needed.
"""
from __future__ import annotations

from importlib import import_module
from pathlib import Path
from typing import Any


def get_resolve_path_within():
    """Return ``resolve_path_within`` from backend utils."""
    return import_module("src.backend.mcp.repo_context_mcp.utils").resolve_path_within


def get_write_text_atomic():
    """Return ``write_text_atomic`` from backend utils."""
    return import_module("src.backend.mcp.repo_context_mcp.utils").write_text_atomic


def get_qmd_index_service():
    """Return the ``QmdIndexService`` class."""
    return import_module(
        "src.backend.mcp.repo_context_mcp.services.qmd_index_service"
    ).QmdIndexService


def get_global_retrospective_root() -> str:
    """Return the configured global retrospective root path string.

    Reads the environment live on every call by design: ``from_env`` is a
    cheap ``os.getenv`` lookup, and resolving it per-call keeps per-test env
    overrides and any mid-process configuration honest. Do not cache at module
    scope — that would leak one test's QMD_GLOBAL_RETROSPECTIVE_ROOT into the
    next.
    """
    config = import_module("src.backend.mcp.repo_context_mcp.config").RepoContextConfig
    return config.from_env().global_retrospective_root


def write_json_via_backend(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON using the backend ``write_text_atomic`` helper."""
    import json
    get_write_text_atomic()(
        path,
        json.dumps(payload, indent=2, sort_keys=False) + "\n",
    )


def write_text_via_backend(path: Path, content: str) -> None:
    """Write text using the backend ``write_text_atomic`` helper."""
    get_write_text_atomic()(path, content)
