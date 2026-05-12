"""Retrospective archive construction and aggregation helpers."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..io import load_text
from ..markdown import parse_metadata, parse_sections
from ..markdown_contracts import TASK_LINEAGE, TASK_METADATA
from ..text import compact_text, extract_list, normalize_text
from ..time import current_utc_timestamp
from ..workspace_paths import handoffs_dir
from .storage import (
    detect_source_ref,
    read_existing_created_at,
    resolve_scope_path,
    retrospective_storage_path,
    sidecar_record_path,
)

_RETROSPECTIVE_FILENAME = "retrospective-input.md"
RETROSPECTIVE_CONTRIBUTION_RE = re.compile(r"^.+'s Contribution \((.+)\)$")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def _strip_comments(text: str) -> str:
    """Remove HTML comments from text."""
    return _HTML_COMMENT_RE.sub("", text).strip()


def extract_contribution_sections(
    sections: dict[str, list[str]],
) -> dict[str, list[str]]:
    """Extract per-role contribution sections from retrospective markdown."""
    contributions: dict[str, list[str]] = {}
    for heading, lines in sections.items():
        match = RETROSPECTIVE_CONTRIBUTION_RE.match(heading)
        if not match:
            continue
        role_name = match.group(1).strip()
        if not role_name:
            continue
        contributions[role_name] = extract_list(lines)
    return contributions


def sorted_unique_strings(values: list[str]) -> list[str]:
    """Deduplicate and sort strings, stripping whitespace."""
    return sorted({value.strip() for value in values if value.strip()})


def rank_frequency_map(
    occurrences: dict[str, list[str]],
) -> list[tuple[str, list[str]]]:
    """Rank items by frequency (descending), then alphabetically."""
    ranked: list[tuple[str, list[str]]] = []
    for item, task_ids in occurrences.items():
        normalized_task_ids = sorted_unique_strings(task_ids)
        if not normalized_task_ids:
            continue
        ranked.append((item, normalized_task_ids))
    ranked.sort(key=lambda item: (-len(item[1]), item[0].lower(), item[0]))
    return ranked


MIN_ACTIONABLE_WORDS = 10


def is_actionable(text: str, min_words: int = MIN_ACTIONABLE_WORDS) -> bool:
    """Return True if *text* has at least *min_words* whitespace-delimited words."""
    return len(text.split()) >= min_words


def format_ranked_markdown_lines(
    ranked_items: list[tuple[str, list[str]]],
) -> list[str]:
    """Format ranked items as markdown bullet lines with task counts."""
    lines: list[str] = []
    for item, task_ids in ranked_items:
        task_count = len(task_ids)
        label = "task" if task_count == 1 else "tasks"
        lines.append(
            f"- {item} (seen in {task_count} {label}: {', '.join(task_ids)})"
        )
    return lines


def build_retrospective_archive(
    repo_root: Path,
    context_pack_dir: Path,
    qmd_scope: str,
    task_archive_payload: dict[str, Any],
) -> tuple[str, dict[str, Any], Path, Path]:
    """Build the retrospective record from input markdown.

    Returns ``(markdown, payload, markdown_path, record_path)``.
    """
    retrospective_source_path = handoffs_dir(repo_root) / _RETROSPECTIVE_FILENAME
    markdown = load_text(retrospective_source_path)
    if not markdown.strip():
        raise ValueError("Retrospective handoff is missing or empty")

    sections = parse_sections(markdown)
    metadata = parse_metadata(sections.get(TASK_METADATA, []), TASK_METADATA)
    lineage = parse_metadata(sections.get(TASK_LINEAGE, []), TASK_LINEAGE)

    task_id = str(task_archive_payload.get("task_id") or "").strip()
    task_title = str(task_archive_payload.get("task_title") or "").strip()
    retrospective_task_id = metadata.get("Task ID", "").strip()
    retrospective_task_title = metadata.get("Task Title", "").strip()

    if retrospective_task_id and retrospective_task_id != task_id:
        raise ValueError(
            "Retrospective handoff Task ID does not match final summary task metadata"
        )
    if retrospective_task_title and retrospective_task_title != task_title:
        raise ValueError(
            "Retrospective handoff Task Title does not match final summary task metadata"
        )

    indexed_at = str(task_archive_payload.get("indexed_at") or current_utc_timestamp())
    year = indexed_at[:4]
    repo_name = str(task_archive_payload.get("repo_name") or repo_root.name).strip() or repo_root.name
    scope_dir = resolve_scope_path(context_pack_dir, qmd_scope)
    markdown_path = retrospective_storage_path(
        context_pack_dir=context_pack_dir,
        qmd_scope=qmd_scope,
        repo_name=repo_name,
        task_id=task_id,
        year=year,
    )
    record_path = sidecar_record_path(markdown_path)
    created_at = read_existing_created_at(record_path, indexed_at)
    archived_markdown = markdown.rstrip() + "\n"
    source_path = str(markdown_path.relative_to(scope_dir))
    agent_contributions = extract_contribution_sections(sections)
    workflow_roles_present = list(agent_contributions.keys())
    retrospective_summary = _strip_comments(normalize_text(sections.get("Retrospective Summary", [])))
    what_went_well = extract_list(sections.get("What Went Well", []))
    what_could_have_gone_better = extract_list(
        sections.get("What Could Have Gone Better", [])
    )
    action_items = extract_list(sections.get("Action Items", []))
    reusable_team_learnings = extract_list(
        sections.get("Reusable Team Learnings", [])
    )
    anti_patterns = extract_list(sections.get("Anti-Patterns To Avoid", []))

    tags = [
        "artifact:retrospective",
        f"context-pack:{task_archive_payload.get('context_pack_id')}",
        f"repo:{repo_name}",
        f"task:{task_id}",
        f"workflow-path:{task_archive_payload.get('workflow_path')}",
    ]

    payload = {
        "schema_version": "qmd-record/v1",
        "record_id": f"task-retrospective:{task_archive_payload.get('context_pack_id')}:{task_id}",
        "record_type": "task-retrospective",
        "title": f"Retrospective: {task_title}",
        "repo_name": repo_name,
        "repo_id": repo_name,
        "repo_owner": "unknown",
        "source_path": source_path,
        "system_layer": "documents",
        "artifact_type": "task-retrospective",
        "language": "markdown",
        "bounded_context": "unassigned",
        "service_name": repo_name,
        "tags": tags,
        "context_pack_id": task_archive_payload.get("context_pack_id"),
        "qmd_scope": qmd_scope,
        "source_ref": task_archive_payload.get("source_ref") or detect_source_ref(repo_root),
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": [
            str(retrospective_source_path.relative_to(repo_root)),
            str((handoffs_dir(repo_root) / "final-summary.md").relative_to(repo_root)),
        ],
        "review_status": "reviewed",
        "task_id": task_id,
        "root_task_id": task_archive_payload.get("root_task_id", ""),
        "parent_task_id": task_archive_payload.get("parent_task_id", ""),
        "parent_qmd_record_id": task_archive_payload.get("parent_qmd_record_id", ""),
        "parent_qmd_scope": task_archive_payload.get("parent_qmd_scope", ""),
        "task_title": task_title,
        "workflow_path": task_archive_payload.get("workflow_path", ""),
        "workflow_status": task_archive_payload.get("workflow_status", ""),
        "recorded_at_utc": indexed_at,
        "completed_at_utc": indexed_at,
        "workflow_roles_present": workflow_roles_present,
        "retrospective_summary": compact_text(retrospective_summary, max_length=420),
        "what_went_well": what_went_well,
        "what_could_have_gone_better": what_could_have_gone_better,
        "action_items": action_items,
        "agent_contributions": agent_contributions,
        "reusable_team_learnings": reusable_team_learnings,
        "anti_patterns": anti_patterns,
        "source_artifacts": [
            str(retrospective_source_path.relative_to(repo_root)),
            str((handoffs_dir(repo_root) / "final-summary.md").relative_to(repo_root)),
        ],
        "lineage": {
            "task_kind": lineage.get("Task Kind", task_archive_payload.get("parent_task_id") and "child-task" or "standard"),
            "parent_task_id": task_archive_payload.get("parent_task_id", ""),
            "root_task_id": task_archive_payload.get("root_task_id", task_id),
            "parent_qmd_record_id": task_archive_payload.get("parent_qmd_record_id", ""),
            "parent_qmd_scope": task_archive_payload.get("parent_qmd_scope", ""),
            "followup_reason": lineage.get("Follow-Up Reason", "").strip(),
        },
        "summary": compact_text(retrospective_summary or task_title, max_length=320),
        "confidence": "medium",
    }
    return archived_markdown, payload, markdown_path, record_path
