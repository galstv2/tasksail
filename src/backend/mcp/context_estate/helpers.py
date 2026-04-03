"""Shared helpers for context estate modules."""
from __future__ import annotations

from typing import Any

from src.backend.mcp.repo_context_mcp.utils import (
    normalize_optional_string,
    normalize_string_list,
    unique_preserving_order,
)
def _normalize_repo_id_list(
    value: Any, known_repo_ids: set[str]
) -> list[str]:
    """Validate that all string ids in *value* exist in *known_repo_ids*."""
    normalized = unique_preserving_order(normalize_string_list(value))
    unknown = [item for item in normalized if item not in known_repo_ids]
    if unknown:
        raise ValueError(
            "Unknown repo reference(s) in focus contract: "
            + ", ".join(unknown)
        )
    return normalized


def _normalize_focus_area_id_list(
    value: Any,
    known_focus_area_ids: set[str],
) -> list[str]:
    """Validate that all string ids in *value* exist in *known_focus_area_ids*."""
    normalized = unique_preserving_order(normalize_string_list(value))
    unknown = [item for item in normalized if item not in known_focus_area_ids]
    if unknown:
        raise ValueError(
            "Unknown focus area reference(s) in focus contract: "
            + ", ".join(unknown)
        )
    return normalized


def build_candidate_map(
    candidates: list[Any],
    key_fields: tuple[str, ...],
) -> dict[str, dict[str, Any]]:
    """Build a lookup map from a list of candidate dicts.

    Each candidate is indexed by every non-empty value of *key_fields*.
    Later candidates with duplicate keys overwrite earlier ones (last wins).
    """
    mapping: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        for field_name in key_fields:
            key = normalize_optional_string(candidate.get(field_name))
            if key:
                mapping[key] = candidate
    return mapping


def resolve_candidate(
    raw_entry: dict[str, Any],
    candidate_map: dict[str, dict[str, Any]],
    key_fields: tuple[str, ...],
    *,
    error_label: str = "entry",
) -> dict[str, Any]:
    """Look up *raw_entry* in *candidate_map* by trying each key field.

    Raises ``ValueError`` if no match is found.
    """
    for field_name in key_fields:
        key = normalize_optional_string(raw_entry.get(field_name))
        if key and key in candidate_map:
            return candidate_map[key]
    raise ValueError(
        f"Approved {error_label} must reference a discovered candidate by "
        + " or ".join(key_fields)
    )


# Convenience key tuples used by both manifest and bootstrap modules.
REPO_KEY_FIELDS = ("repo_id", "relative_path", "path")
FOCUS_KEY_FIELDS = ("focus_id", "relative_path", "path")


def normalize_activation_priority(value: Any, *, default: int = 0) -> int:
    """Parse *value* into an integer activation priority."""
    if value in (None, ""):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    raise ValueError("activation_priority must be an integer")
