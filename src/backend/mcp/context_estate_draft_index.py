"""Backward-compatible re-export shim.

All functionality has moved to ``src.backend.mcp.context_estate.draft_index``.
This module re-exports every previously importable name so existing call sites
keep working.
"""
from __future__ import annotations

from src.backend.mcp.context_estate.draft_index import (  # noqa: F401
    AUTHORITATIVE_MANIFEST_FILE,
    DEFAULT_DRAFT_FILE,
    DRAFT_SCHEMA_VERSION,
    build_draft_artifact,
    resolve_draft_artifact_path,
    write_draft_artifact,
)
