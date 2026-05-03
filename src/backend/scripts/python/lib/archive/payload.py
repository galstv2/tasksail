"""Task archive payload construction."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from ..io import load_text
from ..markdown import parse_metadata, parse_sections
from ..text import compact_text, extract_list, normalize_text, strip_html_comments
from ..time import current_utc_timestamp
from ..workspace_paths import handoffs_dir
from .parent import find_parent_archive
from .storage import (
    archive_storage_path,
    detect_source_ref,
)

SLICE_PATTERN = re.compile(r"\b(slice-[A-Za-z0-9-]+\.md)\b")


def _normalize_archive_text(lines: list[str]) -> str:
    return normalize_text([strip_html_comments(line) for line in lines])


def infer_task_type(task_title: str, task_summary: str) -> str:
    """Classify a task from its title and summary text."""
    haystack = f"{task_title} {task_summary}".lower()
    if "bug" in haystack or "fix" in haystack or "defect" in haystack:
        return "bugfix"
    if "migrat" in haystack:
        return "migration"
    if "refactor" in haystack:
        return "refactor"
    if "infra" in haystack or "pipeline" in haystack or "deploy" in haystack:
        return "infra"
    if "doc" in haystack:
        return "docs"
    return "feature"


def infer_test_status(summary_text: str) -> str:
    """Infer test pass/fail status from summary text."""
    lowered = summary_text.lower()
    if "partial" in lowered:
        return "partially-passed"
    if "fail" in lowered:
        return "failed"
    if "pass" in lowered or "ok" in lowered:
        return "passed"
    return "not-run"


def parse_issues_status(issues_sections: dict[str, list[str]]) -> str:
    """Determine QA issue status from issues sections."""
    for section, lines in issues_sections.items():
        if section == "Task Metadata":
            continue
        if _normalize_archive_text(lines):
            return "issues-found"
    return "passed"


def _read_structured_status(
    *,
    section: list[str],
    allowed: set[str],
    fallback,
    field_name: str,
    task_id: str,
) -> str:
    """Read an authoritative status token, falling back with a warning."""
    raw = _normalize_archive_text(section).strip().lower()
    if raw in allowed:
        return raw
    fallback_value = fallback()
    if not raw:
        print(
            f"Warning: archive task_id={task_id} field '{field_name}' empty in final-summary.md; "
            f"using inferred value '{fallback_value}'. Fill the section to suppress this warning.",
            file=sys.stderr,
        )
    else:
        print(
            f"Warning: archive task_id={task_id} field '{field_name}' has unrecognized value "
            f"'{raw}' (allowed: {sorted(allowed)}); using inferred value '{fallback_value}'.",
            file=sys.stderr,
        )
    return fallback_value


def _join_list_for_summary(items: list[str]) -> str:
    """Render list items as stable prose without truncating mid-word."""
    return "; ".join(item.rstrip(". ") + "." for item in items if item)


def infer_workflow_path(workflow_sections: dict[str, list[str]] | None = None) -> str:
    """Detect workflow path for archival. Fast path is retired."""
    if workflow_sections is not None:
        _normalize_archive_text(workflow_sections.get("Path Decision", []))
    return "standard"


def gather_slice_ids(*texts: str) -> list[str]:
    """Extract slice file references from one or more text blocks."""
    seen: list[str] = []
    for text in texts:
        for match in SLICE_PATTERN.findall(text):
            if match not in seen:
                seen.append(match)
    return seen


def build_archive_payload(
    repo_root: Path,
    context_pack_dir: Path,
    qmd_scope: str,
) -> tuple[dict[str, Any], Path, Path | None]:
    """Build the task archive payload from handoff artifacts.

    Returns ``(payload, record_path, parent_record_path)``.
    """
    _handoffs = handoffs_dir(repo_root)
    mandatory_artifacts = [
        str(_handoffs / "professional-task.md"),
        str(_handoffs / "final-summary.md"),
    ]
    missing = [a for a in mandatory_artifacts if not Path(a).exists()]
    if missing:
        raise ValueError(
            f"Archive filing blocked: mandatory source artifacts missing: {', '.join(missing)}"
        )

    professional_sections = parse_sections(load_text(_handoffs / "professional-task.md"))
    implementation_sections = parse_sections(load_text(_handoffs / "implementation-spec.md"))
    tests_sections = parse_sections(load_text(_handoffs / "tests.md"))
    issues_sections = parse_sections(load_text(_handoffs / "issues.md"))
    final_sections = parse_sections(load_text(_handoffs / "final-summary.md"))

    metadata = parse_metadata(final_sections.get("Task Metadata", []))
    lineage = parse_metadata(final_sections.get("Task Lineage", [])) or parse_metadata(professional_sections.get("Task Lineage", []))

    task_id = metadata.get("Task ID", "").strip()
    task_title = metadata.get("Task Title", "").strip()
    if not task_id or not task_title:
        raise ValueError("Closeout filing requires final summary task metadata to be populated")

    task_kind = strip_html_comments(lineage.get("Task Kind", "")).strip() or "standard"
    parent_task_id = strip_html_comments(lineage.get("Parent Task ID", "")).strip()
    root_task_id = strip_html_comments(lineage.get("Root Task ID", "")).strip() or task_id
    parent_qmd_record_id = strip_html_comments(lineage.get("Parent QMD Record ID", "")).strip()
    parent_qmd_scope = strip_html_comments(lineage.get("Parent QMD Scope", "")).strip()
    followup_reason = strip_html_comments(lineage.get("Follow-Up Reason", "")).strip()

    completed_work_items = extract_list(final_sections.get("Completed Work", []))
    completed_work_text = _normalize_archive_text(final_sections.get("Completed Work", []))
    key_decisions = extract_list(final_sections.get("Key Design Decisions", []))
    known_limitations = extract_list(final_sections.get("Known Limitations", []))
    test_result_summary = _normalize_archive_text(final_sections.get("Test Result Summary", []))
    rollout_notes_items = extract_list(final_sections.get("Rollout or Operational Notes", []))
    rollout_notes_text = _normalize_archive_text(final_sections.get("Rollout or Operational Notes", []))
    followup_backlog = extract_list(final_sections.get("Follow-Up Backlog", []))
    difficulty_metadata = parse_metadata(final_sections.get("Difficulty Assessment", []))
    difficulty_level = strip_html_comments(difficulty_metadata.get("Difficulty Level", "")).strip()
    inherited_parent_context = _normalize_archive_text(final_sections.get("Inherited Parent Context", []))
    child_task_outcome_delta = _normalize_archive_text(final_sections.get("Child-Task Outcome Delta", []))
    advisory_finding = _normalize_archive_text(final_sections.get("QA Advisory Finding", []))
    business_goal = _normalize_archive_text(professional_sections.get("Business Goal", []))
    raw_request = _normalize_archive_text(professional_sections.get("Raw Request", []))
    implementation_summary = completed_work_text or child_task_outcome_delta
    workflow_path = infer_workflow_path()
    test_status = _read_structured_status(
        section=final_sections.get("Test Status", []),
        allowed={"passed", "failed", "partially-passed", "not-run"},
        fallback=lambda: infer_test_status(
            test_result_summary
            or _normalize_archive_text(tests_sections.get("Coverage Notes", []))
        ),
        field_name="Test Status",
        task_id=task_id,
    )
    qa_status = _read_structured_status(
        section=final_sections.get("QA Status", []),
        allowed={"passed", "issues-found"},
        fallback=lambda: parse_issues_status(issues_sections),
        field_name="QA Status",
        task_id=task_id,
    )
    workflow_status = "completed-with-followup" if followup_backlog else "completed"
    if qa_status == "issues-found" and not followup_backlog:
        workflow_status = "closed-with-known-risk"

    source_ref = detect_source_ref(repo_root)
    indexed_at = current_utc_timestamp()
    context_pack_id = context_pack_dir.name
    repo_name = repo_root.name
    year = indexed_at[:4]
    record_path = archive_storage_path(context_pack_dir, qmd_scope, repo_name, task_id, year)
    created_at = indexed_at
    if record_path.exists():
        from ..io import load_json
        existing = load_json(record_path)
        created_at = str(existing.get("created_at") or indexed_at)

    parent_record_path: Path | None = None
    child_depth = 0
    if task_kind == "child-task":
        if not all([parent_task_id, root_task_id, parent_qmd_record_id, parent_qmd_scope, followup_reason]):
            raise ValueError("Child-task closeout filing requires complete lineage metadata")
        parent_resolution = find_parent_archive(
            context_pack_dir=context_pack_dir,
            parent_qmd_scope=parent_qmd_scope,
            parent_qmd_record_id=parent_qmd_record_id,
            parent_task_id=parent_task_id,
        )
        if parent_resolution is not None:
            parent_record_path, parent_record = parent_resolution
            parent_depth = int(parent_record.get("child_depth") or 0)
            child_depth = parent_depth + 1
        else:
            child_depth = 1
            print(
                f"Warning: parent archive not found for parent_task_id="
                f"'{parent_task_id}', parent_qmd_record_id="
                f"'{parent_qmd_record_id}'. Child task will be archived "
                f"with parent_resolution='orphaned'.",
                file=sys.stderr,
            )

    tags = [
        f"workflow-path:{workflow_path}",
        f"lineage:{'child' if task_kind == 'child-task' else 'root'}",
        f"context-pack:{context_pack_id}",
        f"type:{infer_task_type(task_title, completed_work_text or raw_request)}",
    ]
    if parent_task_id:
        tags.append(f"parent-task:{parent_task_id}")
    if root_task_id:
        tags.append(f"root-task:{root_task_id}")
    if task_kind == "child-task":
        tags.append("followup:true")
    if difficulty_level:
        tags.append(f"difficulty:{difficulty_level.lower()}")

    touched_systems = extract_list(implementation_sections.get("Touched Systems", []))
    slice_ids = gather_slice_ids(
        json.dumps(implementation_sections),
        "",
        completed_work_text,
        child_task_outcome_delta,
    )
    payload = {
        "schema_version": "qmd-record/v1",
        "record_id": f"task:{context_pack_id}:{task_id}",
        "record_type": "task-archive",
        "title": task_title,
        "repo_name": repo_name,
        "repo_owner": "unknown",
        "source_path": str((_handoffs / "final-summary.md").relative_to(repo_root)),
        "system_layer": "documents",
        "artifact_type": "task-archive",
        "language": "markdown",
        "bounded_context": "unassigned",
        "service_name": repo_name,
        "tags": tags,
        "context_pack_id": context_pack_id,
        "qmd_scope": qmd_scope,
        "source_ref": source_ref,
        "created_at": created_at,
        "indexed_at": indexed_at,
        "updated_at": indexed_at,
        "freshness_status": "fresh",
        "provenance_type": "derived",
        "provenance_sources": [
            str((_handoffs / "professional-task.md").relative_to(repo_root)),
            str((_handoffs / "implementation-spec.md").relative_to(repo_root)),
            str((_handoffs / "tests.md").relative_to(repo_root)),
            str((_handoffs / "final-summary.md").relative_to(repo_root)),
        ],
        "review_status": "reviewed",
        "task_id": task_id,
        "root_task_id": root_task_id,
        "parent_task_id": parent_task_id,
        "parent_qmd_record_id": parent_qmd_record_id,
        "parent_qmd_scope": parent_qmd_scope,
        "followup_reason": followup_reason,
        "child_depth": child_depth,
        "parent_resolution": "orphaned" if (task_kind == "child-task" and parent_record_path is None and parent_task_id) else "resolved" if parent_record_path is not None else "not-applicable",
        "task_title": task_title,
        "task_type": infer_task_type(task_title, completed_work_text or raw_request),
        "slice_ids": slice_ids,
        "workflow_path": workflow_path,
        "workflow_status": workflow_status,
        "test_status": test_status,
        "qa_status": qa_status,
        "followup_refs": followup_backlog,
        "task_summary": compact_text(raw_request or completed_work_text or task_title),
        "business_goal": compact_text(business_goal, max_length=360),
        "implementation_summary": compact_text(implementation_summary, max_length=420),
        "completed_work_items": completed_work_items,
        "completed_work_summary": _join_list_for_summary(completed_work_items),
        "inherited_parent_context": compact_text(inherited_parent_context, max_length=420),
        "child_task_outcome_delta": compact_text(child_task_outcome_delta, max_length=420),
        "constraints": extract_list(professional_sections.get("Constraints", [])),
        "key_decisions": key_decisions,
        "known_limitations": known_limitations,
        "test_result_summary": compact_text(test_result_summary, max_length=320),
        "rollout_notes_items": rollout_notes_items,
        "rollout_notes": _join_list_for_summary(rollout_notes_items)
        or compact_text(rollout_notes_text, max_length=320),
        "touched_files": touched_systems,
        "related_repos": [],
        "related_services": [],
        "summary": compact_text(implementation_summary or raw_request or task_title, max_length=320),
        "confidence": "medium",
        "difficulty_level": difficulty_level,
        "advisory_finding": compact_text(advisory_finding, max_length=420),
    }
    return payload, record_path, parent_record_path
