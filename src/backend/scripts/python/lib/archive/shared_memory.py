"""Shared cross-task retrospective memory synthesis."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..text import compact_text
from ..time import current_utc_timestamp
from ._backend import get_global_retrospective_root
from .global_history import collect_global_history_records
from .retrospective import (
    rank_frequency_map,
    sorted_unique_strings,
)
from .storage import (
    read_existing_created_at,
    shared_memory_storage_path,
    sidecar_record_path,
)

_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_CROSS_TASK_FIELDS = (
    "what_went_well",
    "what_could_have_gone_better",
    "action_items",
    "reusable_team_learnings",
    "anti_patterns",
)
ROLLING_WINDOW_SIZE = 10
TOP_MEMORY_ITEMS = 3
MEMORY_POLICY_VERSION = "rolling-last-10-global-tasks/v2"
_PLACEHOLDER_ITEMS = frozenset({
    "None identified.",
    "None yet.",
    "None escalated from shared memory.",
    "None reinforced from shared memory.",
})
_TEMPLATE_FRAGMENT_RE = re.compile(
    r"(CYCLE-LEVEL SECTION|Retrospective Required|Leave this section|"
    r"must be reusable|Do NOT quote code|functions, line numbers|"
    r"repo paths|Populate ONLY|abstracted patterns or principles|"
    r"Do NOT name files|symbols,)",
    re.IGNORECASE,
)


def _clean_retrospective_item(raw: str) -> str:
    return _HTML_COMMENT_RE.sub("", str(raw)).strip()


def _is_memory_item(raw: str) -> bool:
    cleaned = _clean_retrospective_item(raw)
    if not cleaned or cleaned in _PLACEHOLDER_ITEMS:
        return False
    return not _TEMPLATE_FRAGMENT_RE.search(cleaned)


def _record_has_cross_task_content(payload: dict[str, Any]) -> bool:
    return any(
        _is_memory_item(item)
        for field in _CROSS_TASK_FIELDS
        for item in (payload.get(field) or [])
    )


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _plain_markdown_lines(
    ranked_items: list[tuple[str, list[str]]],
    limit: int = TOP_MEMORY_ITEMS,
) -> list[str]:
    return [f"- {item}" for item, _task_ids in ranked_items[:limit]]


def _items_only(
    ranked_items: list[tuple[str, list[str]]],
    limit: int = TOP_MEMORY_ITEMS,
) -> list[str]:
    return [item for item, _task_ids in ranked_items[:limit]]


def _load_existing_memory(
    markdown_path: Path,
    record_path: Path,
) -> tuple[str, dict[str, Any]] | None:
    try:
        payload = json.loads(record_path.read_text(encoding="utf-8"))
        markdown = markdown_path.read_text(encoding="utf-8")
    except (FileNotFoundError, ValueError):
        return None
    if payload.get("memory_policy_version") != MEMORY_POLICY_VERSION:
        return None
    return markdown, payload


def _should_regenerate(
    *,
    history_record_count: int,
    existing: tuple[str, dict[str, Any]] | None,
) -> bool:
    if existing is None:
        return True
    return (
        history_record_count > 0
        and history_record_count % ROLLING_WINDOW_SIZE == 0
    )


def build_shared_retrospective_memory(
    repo_root: Path,
) -> tuple[str, dict[str, Any], Path, Path]:
    """Synthesize shared retrospective memory from the latest global window.

    Returns ``(markdown, payload, markdown_path, record_path)``.
    """
    global_retrospective_root = get_global_retrospective_root()
    history_records = collect_global_history_records(repo_root)
    indexed_at = current_utc_timestamp()
    markdown_path = shared_memory_storage_path(repo_root)
    record_path = sidecar_record_path(markdown_path)
    created_at = read_existing_created_at(record_path, indexed_at)
    existing = _load_existing_memory(markdown_path, record_path)
    if not _should_regenerate(
        history_record_count=len(history_records),
        existing=existing,
    ):
        existing_markdown, existing_payload = existing
        return existing_markdown, existing_payload, markdown_path, record_path

    synthesized_from_task_ids: list[str] = []
    strengths: dict[str, list[str]] = {}
    bottlenecks: dict[str, list[str]] = {}
    action_items: dict[str, list[str]] = {}
    validated_improvements: dict[str, list[str]] = {}
    anti_patterns: dict[str, list[str]] = {}
    source_artifacts: list[str] = []
    recent_records = (
        history_records[-ROLLING_WINDOW_SIZE:]
        if ROLLING_WINDOW_SIZE > 0
        else history_records
    )

    for path, payload in recent_records:
        task_id = str(payload.get("task_id") or "").strip()
        if task_id:
            synthesized_from_task_ids.append(task_id)
        source_artifacts.append(str(path.relative_to(repo_root)))

        if not _record_has_cross_task_content(payload):
            continue
        for item in payload.get("what_went_well") or []:
            cleaned = _clean_retrospective_item(item)
            if _is_memory_item(cleaned):
                strengths.setdefault(cleaned, []).append(task_id)
        for item in payload.get("what_could_have_gone_better") or []:
            cleaned = _clean_retrospective_item(item)
            if _is_memory_item(cleaned):
                bottlenecks.setdefault(cleaned, []).append(task_id)
        for item in payload.get("action_items") or []:
            cleaned = _clean_retrospective_item(item)
            if _is_memory_item(cleaned):
                action_items.setdefault(cleaned, []).append(task_id)
        for item in payload.get("reusable_team_learnings") or []:
            cleaned = _clean_retrospective_item(item)
            if _is_memory_item(cleaned):
                validated_improvements.setdefault(cleaned, []).append(task_id)
        for item in payload.get("anti_patterns") or []:
            cleaned = _clean_retrospective_item(item)
            if _is_memory_item(cleaned):
                anti_patterns.setdefault(cleaned, []).append(task_id)

    ranked_strengths = rank_frequency_map(strengths)
    ranked_bottlenecks = rank_frequency_map(bottlenecks)
    ranked_action_items = rank_frequency_map(action_items)
    ranked_improvements = rank_frequency_map(validated_improvements)
    ranked_anti_patterns = rank_frequency_map(anti_patterns)

    task_ids = _dedupe_preserve_order(synthesized_from_task_ids)
    top_strengths = _items_only(ranked_strengths)
    top_bottlenecks = _items_only(ranked_bottlenecks)
    top_action_items = _items_only(ranked_action_items)
    top_improvements = _items_only(ranked_improvements)
    top_anti_patterns = _items_only(ranked_anti_patterns)
    window_summary = (
        f"Rolling summary of the latest {len(task_ids)} completed "
        "tasks across all context packs."
    )

    markdown_sections = [
        "# Shared Retrospective Memory",
        "",
        "## Synthesized At",
        "",
        indexed_at,
        "",
        "## Summary",
        "",
        f"- {window_summary}",
        "- This file is intentionally high-level; detailed task history stays in retrospective records.",
        "- It refreshes on each 10-task global closeout boundary and uses only the latest 10 completed tasks.",
        "",
        "## Recurring Strengths",
        "",
        *(_plain_markdown_lines(ranked_strengths) or ["- None yet."]),
        "",
        "## Recurring Bottlenecks",
        "",
        *(_plain_markdown_lines(ranked_bottlenecks) or ["- None yet."]),
        "",
        "## Open Action Items",
        "",
        *(_plain_markdown_lines(ranked_action_items) or ["- None yet."]),
        "",
        "## Validated Improvements",
        "",
        *(_plain_markdown_lines(ranked_improvements) or ["- None yet."]),
        "",
        "## Anti-Patterns To Avoid",
        "",
        *(_plain_markdown_lines(ranked_anti_patterns) or ["- None yet."]),
        "",
        "## Source Window",
        "",
        f"- Tasks summarized: {len(task_ids)}",
        f"- Rolling window size: {ROLLING_WINDOW_SIZE}",
        "- Task IDs are stored in the sidecar record, not repeated here.",
        "",
    ]
    markdown = "\n".join(markdown_sections)

    payload = {
        "schema_version": "qmd-record/v1",
        "record_id": "global-retrospective-memory:shared",
        "record_type": "global-retrospective-memory",
        "title": "Shared Retrospective Memory",
        "repo_name": "platform-wide",
        "repo_id": "platform-wide",
        "repo_owner": "unknown",
        "source_path": str(markdown_path.relative_to(repo_root)),
        "system_layer": "documents",
        "artifact_type": "global-retrospective-memory",
        "language": "markdown",
        "bounded_context": "platform-shared",
        "service_name": "workflow-team",
        "tags": [
            "artifact:global-retrospective-memory",
            "scope:global",
        ],
        "global_retrospective_root": global_retrospective_root,
        "memory_policy_version": MEMORY_POLICY_VERSION,
        "rolling_window_size": ROLLING_WINDOW_SIZE,
        "history_record_count": len(history_records),
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "updated_at_utc": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": sorted_unique_strings(source_artifacts),
        "review_status": "reviewed",
        "synthesized_from_task_ids": task_ids,
        "open_action_items": top_action_items,
        "validated_improvements": top_improvements,
        "recurring_strengths": top_strengths,
        "recurring_bottlenecks": top_bottlenecks,
        "anti_patterns": top_anti_patterns,
        "summary": compact_text(
            window_summary,
            max_length=320,
        ),
        "confidence": "medium",
    }
    return markdown, payload, markdown_path, record_path
