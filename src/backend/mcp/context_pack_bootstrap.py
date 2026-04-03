"""Backward-compatibility shim — all logic now lives in context_estate/.

Re-exports every name that was previously importable from this module so
existing callers and tests continue to work without changes.
"""
from __future__ import annotations

from src.backend.mcp.context_estate.bootstrap import (  # noqa: F401
    _determine_estate_mode,
    _effective_discovery_root,
    bootstrap_context_pack,
)
from src.backend.mcp.context_estate.bootstrap_builders import (  # noqa: F401
    _build_distributed_review_payload,
    _build_monolith_focusable_areas,
    _build_monolith_review_payload,
    _merge_candidate_repos,
    _synthesize_candidate_repo,
)
from src.backend.mcp.context_estate.bootstrap_detection import (  # noqa: F401
    _detect_document_paths,
    _detect_languages,
    _detect_system_layer,
)
from src.backend.mcp.context_estate.bootstrap_normalization import (  # noqa: F401
    _int,
    _normalize_focus_area_overrides,
    _normalize_layer,
    _repo_role_for_layer,
    _string_list,
    normalize_bootstrap_answers,
)
from src.backend.mcp.context_estate.constants import (  # noqa: F401
    ALLOWED_LAYERS,
    DEFAULT_SCOPE_MODE,
)
