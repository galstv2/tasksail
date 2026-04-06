"""Build a markdown summary from a task archive payload.

This creates the `.md` sibling for the task archive `.json` record,
matching the pattern used by retrospectives (`.md` + `.md.record.json`).
"""
from __future__ import annotations

from typing import Any


def build_task_archive_markdown(payload: dict[str, Any]) -> str:
    """Render a task archive payload as a readable markdown document."""
    title = payload.get("task_title", "Untitled Task")
    lines = [f"# {title}", ""]

    lines.append("## Task Metadata")
    lines.append("")
    lines.append(f"- Task ID: {payload.get('task_id', '')}")
    lines.append(f"- Workflow Path: {payload.get('workflow_path', '')}")
    lines.append(f"- Difficulty Level: {payload.get('difficulty_level', '')}")
    lines.append(f"- QA Status: {payload.get('qa_status', '')}")
    lines.append(f"- Test Status: {payload.get('test_status', '')}")
    lines.append(f"- Context Pack: {payload.get('context_pack_id', '')}")
    lines.append(f"- Archived At: {payload.get('indexed_at', '')}")
    lines.append("")

    _add_text_section(lines, "Business Goal", payload.get("business_goal"))
    _add_text_section(
        lines, "Completed Work", payload.get("completed_work_summary"),
    )
    _add_list_section(lines, "Key Decisions", payload.get("key_decisions"))
    _add_list_section(
        lines, "Known Limitations", payload.get("known_limitations"),
    )
    _add_text_section(
        lines, "Test Results", payload.get("test_result_summary"),
    )
    _add_text_section(lines, "Rollout Notes", payload.get("rollout_notes"))
    _add_list_section(lines, "Files Changed", payload.get("touched_files"))
    _add_list_section(lines, "Follow-Up Items", payload.get("followup_refs"))
    _add_text_section(lines, "QA Advisory Finding", payload.get("advisory_finding"))

    return "\n".join(lines)


def _add_text_section(
    lines: list[str], heading: str, content: str | None,
) -> None:
    if not content:
        return
    lines.append(f"## {heading}")
    lines.append("")
    lines.append(content)
    lines.append("")


def _add_list_section(
    lines: list[str], heading: str, items: list[str] | None,
) -> None:
    if not items:
        return
    lines.append(f"## {heading}")
    lines.append("")
    for item in items:
        lines.append(f"- {item}")
    lines.append("")
