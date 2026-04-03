"""Shared cross-task retrospective memory synthesis."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import re

from ..text import compact_text
from ..time import current_utc_timestamp

_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
from ._backend import get_global_retrospective_root
from .global_history import collect_global_history_records
from .retrospective import (
    format_ranked_markdown_lines,
    rank_frequency_map,
    sorted_unique_strings,
)
from .storage import (
    read_existing_created_at,
    shared_memory_storage_path,
    sidecar_record_path,
)


def build_shared_retrospective_memory(
    repo_root: Path,
) -> tuple[str, dict[str, Any], Path, Path]:
    """Synthesize a shared retrospective memory from all history records.

    Returns ``(markdown, payload, markdown_path, record_path)``.
    """
    global_retrospective_root = get_global_retrospective_root()
    history_records = collect_global_history_records(repo_root)
    indexed_at = current_utc_timestamp()
    markdown_path = shared_memory_storage_path(repo_root)
    record_path = sidecar_record_path(markdown_path)
    created_at = read_existing_created_at(record_path, indexed_at)

    synthesized_from_task_ids: list[str] = []
    strengths: dict[str, list[str]] = {}
    bottlenecks: dict[str, list[str]] = {}
    action_items: dict[str, list[str]] = {}
    validated_improvements: dict[str, list[str]] = {}
    anti_patterns: dict[str, list[str]] = {}
    task_summaries: list[tuple[str, str]] = []
    source_artifacts: list[str] = []

    for path, payload in history_records:
        task_id = str(payload.get("task_id") or "").strip()
        task_title = str(payload.get("task_title") or payload.get("title") or "").strip()
        if task_id:
            synthesized_from_task_ids.append(task_id)
        if task_id or task_title:
            task_summaries.append((task_id, task_title))
        source_artifacts.append(str(path.relative_to(repo_root)))

        def _clean(raw: str) -> str:
            return _HTML_COMMENT_RE.sub("", str(raw)).strip()

        for item in payload.get("what_went_well") or []:
            cleaned = _clean(item)
            if cleaned:
                strengths.setdefault(cleaned, []).append(task_id)
        for item in payload.get("what_could_have_gone_better") or []:
            cleaned = _clean(item)
            if cleaned:
                bottlenecks.setdefault(cleaned, []).append(task_id)
        for item in payload.get("action_items") or []:
            cleaned = _clean(item)
            if cleaned:
                action_items.setdefault(cleaned, []).append(task_id)
        for item in payload.get("reusable_team_learnings") or []:
            cleaned = _clean(item)
            if cleaned:
                validated_improvements.setdefault(cleaned, []).append(task_id)
        for item in payload.get("anti_patterns") or []:
            cleaned = _clean(item)
            if cleaned:
                anti_patterns.setdefault(cleaned, []).append(task_id)

    ranked_strengths = rank_frequency_map(strengths)
    ranked_bottlenecks = rank_frequency_map(bottlenecks)
    ranked_action_items = rank_frequency_map(action_items)
    ranked_improvements = rank_frequency_map(validated_improvements)
    ranked_anti_patterns = rank_frequency_map(anti_patterns)

    task_summary_lines = [
        f"- {task_id}: {task_title}" if task_title else f"- {task_id}"
        for task_id, task_title in task_summaries
        if task_id or task_title
    ]

    markdown_sections = [
        "# Shared Retrospective Memory",
        "",
        "## Global Retrospective Root",
        "",
        global_retrospective_root,
        "",
        "## Synthesized At",
        "",
        indexed_at,
        "",
        "## Contributing Tasks",
        "",
        *(task_summary_lines or ["- None yet."]),
        "",
        "## Recurring Strengths",
        "",
        *(format_ranked_markdown_lines(ranked_strengths) or ["- None yet."]),
        "",
        "## Recurring Bottlenecks",
        "",
        *(format_ranked_markdown_lines(ranked_bottlenecks) or ["- None yet."]),
        "",
        "## Open Action Items",
        "",
        *(format_ranked_markdown_lines(ranked_action_items) or ["- None yet."]),
        "",
        "## Validated Improvements",
        "",
        *(format_ranked_markdown_lines(ranked_improvements) or ["- None yet."]),
        "",
        "## Anti-Patterns To Avoid",
        "",
        *(format_ranked_markdown_lines(ranked_anti_patterns) or ["- None yet."]),
        "",
        "## Audit Trail",
        "",
        *(task_summary_lines or ["- None yet."]),
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
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "updated_at_utc": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": sorted_unique_strings(source_artifacts),
        "review_status": "reviewed",
        "synthesized_from_task_ids": sorted_unique_strings(
            synthesized_from_task_ids
        ),
        "open_action_items": [
            item for item, _task_ids in ranked_action_items
        ],
        "validated_improvements": [
            item for item, _task_ids in ranked_improvements
        ],
        "recurring_strengths": [
            item for item, _task_ids in ranked_strengths
        ],
        "recurring_bottlenecks": [
            item for item, _task_ids in ranked_bottlenecks
        ],
        "anti_patterns": [
            item for item, _task_ids in ranked_anti_patterns
        ],
        "summary": compact_text(
            "Shared cross-task retrospective memory synthesized from completed tasks.",
            max_length=320,
        ),
        "confidence": "medium",
    }
    return markdown, payload, markdown_path, record_path
