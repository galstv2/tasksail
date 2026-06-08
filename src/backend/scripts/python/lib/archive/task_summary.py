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

    _add_branch_handoffs_section(lines, payload.get("branch_handoffs"))
    _add_text_section(lines, "Business Goal", payload.get("business_goal"))
    _add_list_or_text_section(
        lines,
        "Completed Work",
        items=payload.get("completed_work_items"),
        text=payload.get("completed_work_summary"),
    )
    _add_list_section(lines, "Key Design Decisions", payload.get("key_decisions"))
    _add_list_section(
        lines, "Known Limitations", payload.get("known_limitations"),
    )
    _add_text_section(
        lines, "Test Result Summary", payload.get("test_result_summary"),
    )
    _add_list_or_text_section(
        lines,
        "Rollout or Operational Notes",
        items=payload.get("rollout_notes_items"),
        text=payload.get("rollout_notes"),
    )
    _add_list_section(lines, "Files Changed", payload.get("touched_files"))
    _add_list_section(lines, "Follow-Up Backlog", payload.get("followup_refs"))
    _add_handoff_artifacts_section(lines, payload.get("handoff_artifacts"))
    # Append-only: advisory content must remain last.
    _add_text_section(lines, "QA Advisory Finding", payload.get("advisory_finding"))

    return "\n".join(lines)


def _add_branch_handoffs_section(
    lines: list[str], handoffs: Any,
) -> None:
    if not isinstance(handoffs, list) or not handoffs:
        return
    lines.append("## Source Branches for Operator Review")
    lines.append("")
    for item in handoffs:
        if not isinstance(item, dict):
            continue
        repo_label = item.get("repo_label", "")
        branch = item.get("branch", "")
        head_sha = item.get("head_commit_sha", "")
        commits_ahead = item.get("commits_ahead", "")
        base_sha = item.get("base_commit_sha", "")
        repo_root = item.get("repo_root", "")
        auto_merge = item.get("auto_merge")
        if isinstance(auto_merge, dict) and auto_merge.get("status") == "applied":
            target_branch = auto_merge.get("target_branch", "")
            lines.append(
                f"- `{repo_label}`: `{branch}` has been merged into `{target_branch}` "
                "with `--no-commit --no-ff`; changes are staged for operator review. "
                f"Source branch head: `{head_sha}` ({commits_ahead} commit(s) ahead of `{base_sha}`) — repo: `{repo_root}`"
            )
            continue
        if isinstance(auto_merge, dict) and auto_merge.get("enabled") is True:
            detail = auto_merge.get("detail", "auto-merge skipped")
            lines.append(
                f"- `{repo_label}`: `{branch}` is ready for manual review; "
                f"auto-merge skipped because {detail} "
                f"Head: `{head_sha}` ({commits_ahead} commit(s) ahead of `{base_sha}`) — repo: `{repo_root}`"
            )
            continue
        lines.append(
            f"- `{repo_label}`: `{branch}` at `{head_sha}` "
            f"({commits_ahead} commit(s) ahead of `{base_sha}`) — repo: `{repo_root}`"
        )
    lines.append("")


def _add_text_section(
    lines: list[str], heading: str, content: str | None,
) -> None:
    if not content:
        return
    lines.append(f"## {heading}")
    lines.append("")
    lines.append(content)
    lines.append("")


def _add_handoff_artifacts_section(lines: list[str], artifacts: Any) -> None:
    if not isinstance(artifacts, dict):
        return
    _add_list_section(
        lines,
        "Archived Handoff Artifacts",
        [
            f"Handoff files: {artifacts.get('handoff_file_count', 0)}",
            f"Implementation step files: {artifacts.get('implementation_step_file_count', 0)}",
            f"Manifest: {artifacts.get('manifest_path', 'handoff-artifacts-manifest.json')}",
        ],
    )


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


def _add_list_or_text_section(
    lines: list[str],
    heading: str,
    *,
    items: list[str] | None,
    text: str | None,
) -> None:
    """Render a populated item list, falling back to legacy prose."""
    if items:
        _add_list_section(lines, heading, items)
        return
    if text:
        _add_text_section(lines, heading, text)
