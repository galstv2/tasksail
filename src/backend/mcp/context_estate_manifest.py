"""Backward-compatible re-export shim.

All functionality has moved to ``src.backend.mcp.context_estate.manifest``
and ``src.backend.mcp.context_estate.constants``.  This module re-exports
every previously importable name so existing call sites keep working.
"""
from __future__ import annotations

from src.backend.mcp.context_estate.constants import (  # noqa: F401
    ALLOWED_ESTATE_TYPES,
    ALLOWED_FOCUS_TYPES,
    ALLOWED_REPO_ROLES,
    DEFAULT_REPOSITORY_TYPE,
    DISTRIBUTED_ESTATE_TYPES,
    MONOLITH_ESTATE_TYPES,
    REPOSITORY_TYPES,
)
from src.backend.mcp.context_estate.helpers import (  # noqa: F401
    _normalize_focus_area_id_list,
    _normalize_repo_id_list,
)
from src.backend.mcp.context_estate.manifest import (  # noqa: F401
    DEFAULT_MANIFEST_FILE,
    MANIFEST_VERSION,
    approve_manifest_from_files,
    build_approved_manifest,
    normalize_estate_type,
    resolve_draft_path,
    resolve_manifest_path,
    write_approved_manifest,
)
