"""Shared constants for context pack JSON schemas, versioning, and category mapping.

This module is the single source of truth for:
- manifest version strings (v1, v2)
- allowed layers, estate types, repo types, and categories
- wizard role → repo category mapping
"""
from __future__ import annotations

from collections.abc import Mapping

ALLOWED_LAYERS: frozenset[str] = frozenset({
    "backend",
    "frontend",
    "test",
    "infrastructure",
    "database",
    "documents",
    "shared",
})

MONOLITH_ESTATE_TYPES: frozenset[str] = frozenset({"monolith", "monolith-platform"})

DISTRIBUTED_ESTATE_TYPES: frozenset[str] = frozenset({"distributed", "distributed-platform"})

ALLOWED_ESTATE_TYPES: frozenset[str] = DISTRIBUTED_ESTATE_TYPES | MONOLITH_ESTATE_TYPES

REPOSITORY_TYPES: frozenset[str] = frozenset({"primary", "support"})

# v2 aliases — kept alongside REPOSITORY_TYPES for backward compat.
REPO_FOCUS_VALUES: frozenset[str] = REPOSITORY_TYPES

# repo_category values introduced in v2 (the 9 categories).
ALLOWED_REPO_CATEGORIES: frozenset[str] = frozenset({
    "service", "application", "frontend", "library",
    "infrastructure", "data", "documentation", "tool", "unknown",
})

MANIFEST_VERSION = "qmd-repo-sources/v1"
MANIFEST_VERSION_V2 = "qmd-repo-sources/v2"

QUESTIONNAIRE_VERSION = "context-pack-bootstrap/v1"

QMD_SCOPE_ROOT_TEMPLATE = "qmd/context-packs/{context_pack_id}"

# Keys are RoleOption.value strings (not labels) from buildWizardConstants.ts.
WIZARD_ROLE_TO_REPO_CATEGORY: Mapping[str, str] = {
    "backend": "service",
    "frontend": "frontend",
    "database": "data",
    "infrastructure": "infrastructure",
    "documents": "documentation",
    "shared": "library",
}


def qmd_scope_root_for(context_pack_id: str) -> str:
    return f"qmd/context-packs/{context_pack_id}"
