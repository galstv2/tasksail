"""Scope-root resolution helpers for SeedingService.

Extracted from seeding_service.py (Phase 6 Gate G1).  These are pure
path-manipulation functions — no I/O, no instance state.
"""
from __future__ import annotations

from pathlib import Path

from ..utils import resolve_path_within


def normalize_qmd_scope_root(
    context_pack_dir: Path,
    qmd_scope_root: str,
) -> str:
    """Resolve *qmd_scope_root* within *context_pack_dir* and return its
    repo-relative POSIX path."""
    scope_dir = resolve_path_within(
        context_pack_dir,
        qmd_scope_root,
        "qmd_scope_root",
    )
    return scope_dir.relative_to(context_pack_dir).as_posix()


def resolve_path_in_context_pack(
    context_pack_dir: Path,
    value: str,
    field_name: str,
) -> Path:
    """Resolve *value* (possibly relative) within *context_pack_dir*."""
    return resolve_path_within(context_pack_dir, value, field_name)
