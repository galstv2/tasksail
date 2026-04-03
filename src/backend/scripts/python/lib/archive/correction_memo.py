"""Behavior correction memo builder for retrospective cycles."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..io import load_text
from ..markdown import parse_sections
from ..time import current_utc_timestamp
from .retrospective import format_ranked_markdown_lines
from .storage import read_existing_created_at, sidecar_record_path


from ..registry import workflow_roles as _load_workflow_roles

_PLACEHOLDER_ITEMS = frozenset({
    "None identified.",
    "None yet.",
    "None escalated from shared memory.",
    "None reinforced from shared memory.",
    "No role-specific corrections this cycle.",
    "No cycle-over-cycle changes detected.",
})


class CorrectionMemoBuilder:
    """Generates behavior correction memos from cycle summaries."""

    def build_correction_memo(
        self,
        cycle_summary: dict[str, Any],
        shared_memory_markdown: str | None,
        context_pack_id: str,
        cycle_count: int,
        recent_task_ids: set[str] | None = None,
        previous_memo_markdown: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Build correction memo markdown and record payload."""
        indexed_at = current_utc_timestamp()

        shared_anti_patterns: set[str] = set()
        shared_improvements: set[str] = set()
        if shared_memory_markdown:
            shared_sections = parse_sections(shared_memory_markdown)
            shared_anti_patterns = _extract_items_from_parsed(
                shared_sections, "Anti-Patterns To Avoid",
                active_task_ids=recent_task_ids,
            )
            shared_improvements = _extract_items_from_parsed(
                shared_sections, "Validated Improvements",
                active_task_ids=recent_task_ids,
            )

        ranked_bottlenecks = cycle_summary.get("ranked_bottlenecks", [])
        ranked_action_items = cycle_summary.get("ranked_action_items", [])
        ranked_anti_patterns = cycle_summary.get("ranked_anti_patterns", [])
        ranked_improvements = cycle_summary.get("ranked_improvements", [])
        per_role_ranked = cycle_summary.get("per_role_ranked", {})
        difficulty_dist = cycle_summary.get("difficulty_distribution", {})

        escalated = [
            (item, tids)
            for item, tids in ranked_anti_patterns
            if item in shared_anti_patterns
        ]
        reinforced = [
            (item, tids)
            for item, tids in ranked_improvements
            if item in shared_improvements
        ]

        sections = [
            f"# Behavior Correction Memo — Cycle {cycle_count}",
            "",
            "## Cycle Metadata",
            "",
            f"- Context Pack ID: {context_pack_id}",
            f"- Cycle Number: {cycle_count}",
            f"- Tasks Covered: {cycle_summary.get('task_count', 0)}",
            f"- Generated At: {indexed_at}",
            "",
            "## Cycle Outcome Summary",
            "",
            f"- Task count: {cycle_summary.get('task_count', 0)}",
            f"- Records found: {cycle_summary.get('records_found', 0)}",
            _format_difficulty(difficulty_dist),
            "",
            "## Process Corrections",
            "",
            "### What Could Have Gone Better (Top 5)",
            "",
            *(format_ranked_markdown_lines(ranked_bottlenecks[:5])
              or ["- None identified."]),
            "",
            "### Action Items (Top 5)",
            "",
            *(format_ranked_markdown_lines(ranked_action_items[:5])
              or ["- None identified."]),
            "",
        ]

        sections.append("## Agent-Specific Corrections")
        sections.append("")
        for human_name, role_name in _load_workflow_roles():
            sections.append(f"### {human_name} ({role_name})")
            sections.append("")
            role_items = per_role_ranked.get(role_name, [])
            if role_items:
                sections.extend(
                    format_ranked_markdown_lines(role_items[:5])
                )
            else:
                sections.append("- No role-specific corrections this cycle.")
            sections.append("")

        sections.extend([
            "## Technical Corrections",
            "",
            *(format_ranked_markdown_lines(ranked_anti_patterns[:5])
              or ["- None identified."]),
            "",
            "## Recurring Anti-Patterns (Escalated)",
            "",
            *(format_ranked_markdown_lines(escalated[:5])
              or ["- None escalated from shared memory."]),
            "",
            "## Validated Improvements (Reinforced)",
            "",
            *(format_ranked_markdown_lines(reinforced[:5])
              or ["- None reinforced from shared memory."]),
            "",
        ])

        diff_result = _build_diff(
            previous_memo_markdown,
            ranked_anti_patterns[:5],
            escalated[:5],
        )
        if diff_result:
            sections.extend(diff_result["lines"])

        markdown = "\n".join(sections)
        task_ids = cycle_summary.get("task_ids", [])

        payload: dict[str, Any] = {
            "schema_version": "qmd-record/v1",
            "record_id": (
                f"behavior-correction-memo:{context_pack_id}:"
                f"cycle-{cycle_count}"
            ),
            "record_type": "behavior-correction-memo",
            "title": f"Behavior Correction Memo — Cycle {cycle_count}",
            "context_pack_id": context_pack_id,
            "cycle_count": cycle_count,
            "task_count": cycle_summary.get("task_count", 0),
            "task_ids": task_ids,
            "created_at": indexed_at,
            "indexed_at": indexed_at,
            "updated_at": indexed_at,
            "freshness_status": "fresh",
            "provenance_type": "derived",
            "escalated_anti_patterns": [item for item, _ in escalated],
            "reinforced_improvements": [item for item, _ in reinforced],
            "summary": (
                f"Behavior correction memo for cycle {cycle_count} "
                f"covering {len(task_ids)} tasks."
            ),
            "confidence": "medium",
        }
        if diff_result:
            payload["cycle_diff"] = {
                "new_items": diff_result["new"],
                "persisting_items": diff_result["persisting"],
                "resolved_items": diff_result["resolved"],
            }
        return markdown, payload


def _format_difficulty(dist: dict[str, int]) -> str:
    if not dist:
        return "- Difficulty distribution: not available"
    parts = ", ".join(f"{k}: {v}" for k, v in sorted(dist.items()))
    return f"- Difficulty distribution: {parts}"


def _extract_shared_items(
    markdown: str,
    section_name: str,
    active_task_ids: set[str] | None = None,
) -> set[str]:
    """Extract bullet items from a named section of shared memory markdown.

    When *active_task_ids* is provided, only items whose parenthetical task
    IDs overlap the active set are included (expired entries are skipped).
    """
    return _extract_items_from_parsed(
        parse_sections(markdown), section_name, active_task_ids,
    )


def _extract_items_from_parsed(
    sections: dict[str, list[str]],
    section_name: str,
    active_task_ids: set[str] | None = None,
) -> set[str]:
    """Extract bullet items from pre-parsed sections dict."""
    lines = sections.get(section_name, [])
    items: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        text = stripped[2:].strip()
        entry_task_ids: set[str] = set()
        paren_idx = text.rfind(" (seen in ")
        if paren_idx > 0:
            suffix = text[paren_idx:]
            colon_idx = suffix.find(": ")
            if colon_idx > 0:
                tid_str = suffix[colon_idx + 2:].rstrip(")")
                entry_task_ids = {
                    t.strip() for t in tid_str.split(",") if t.strip()
                }
            text = text[:paren_idx].strip()
        if not text or text in _PLACEHOLDER_ITEMS:
            continue
        if (
            active_task_ids is not None
            and entry_task_ids
            and not (entry_task_ids & active_task_ids)
        ):
            continue
        items.add(text)
    return items


def _build_diff(
    previous_memo_markdown: str | None,
    current_anti_patterns: list[tuple[str, list[str]]],
    current_escalated: list[tuple[str, list[str]]],
) -> dict[str, Any] | None:
    """Compare current correction items against the previous memo.

    Returns None when no previous memo is available.
    """
    if not previous_memo_markdown:
        return None

    prev_sections = parse_sections(previous_memo_markdown)
    prev_items = (
        _extract_items_from_parsed(
            prev_sections, "Technical Corrections"
        )
        | _extract_items_from_parsed(
            prev_sections, "Recurring Anti-Patterns (Escalated)"
        )
    )
    curr_items = (
        {item for item, _ in current_anti_patterns}
        | {item for item, _ in current_escalated}
    )
    new_items = sorted(curr_items - prev_items)
    persisting_items = sorted(curr_items & prev_items)
    resolved_items = sorted(prev_items - curr_items)

    lines: list[str] = ["## Cycle-over-Cycle Status", ""]
    for item in new_items:
        lines.append(f"- [NEW] {item}")
    for item in persisting_items:
        lines.append(f"- [PERSISTING] {item}")
    for item in resolved_items:
        lines.append(f"- [RESOLVED] {item}")
    if not new_items and not persisting_items and not resolved_items:
        lines.append("- No cycle-over-cycle changes detected.")
    lines.append("")

    return {
        "lines": lines,
        "new": new_items,
        "persisting": persisting_items,
        "resolved": resolved_items,
    }
