from __future__ import annotations

from typing import Any


class ReportRenderer:
    @staticmethod
    def _append_list_section(
        lines: list[str],
        *,
        title: str,
        items: list[str],
        empty_text: str,
    ) -> None:
        lines.extend([f"## {title}", ""])
        if items:
            for item in items:
                lines.append(f"- {item}")
        else:
            lines.append(f"- {empty_text}")
        lines.append("")

    @staticmethod
    def _append_descriptor_section(
        lines: list[str],
        *,
        title: str,
        items: list[dict[str, Any]],
        empty_text: str,
    ) -> None:
        lines.extend([f"## {title}", ""])
        if items:
            for item in items:
                lines.append(
                    f"- {item.get('task_id') or 'unknown'} — "
                    f"{item.get('task_title') or 'untitled'} "
                    f"(parent={item.get('parent_task_id') or 'none'}, "
                    f"depth={item.get('child_depth')})"
                )
        else:
            lines.append(f"- {empty_text}")
        lines.append("")

    def render_task_lineage_summary(self, summary: dict[str, Any]) -> str:
        query = summary.get("query", {})
        root_archive = summary.get("root_archive") or {}
        subject_archive = summary.get("subject_archive") or {}

        lines = [
            "# Task Lineage Summary — "
            f"{query.get('task_id') or summary.get('root_task_id')}",
            "",
            f"- Root Task ID: {summary.get('root_task_id') or 'unknown'}",
            f"- Queried Task ID: {query.get('task_id') or 'root-only lookup'}",
            "- Root Archive Record: "
            f"{root_archive.get('record_id') or 'unknown'}",
            f"- Scope: {summary.get('qmd_scope') or 'unknown'}",
            "",
        ]

        if subject_archive:
            lines.extend(
                [
                    "## Subject Archive",
                    "",
                    "- Task ID: "
                    f"{subject_archive.get('task_id') or 'unknown'}",
                    "- Title: "
                    f"{subject_archive.get('task_title') or 'unknown'}",
                    "- Parent Task ID: "
                    f"{subject_archive.get('parent_task_id') or 'none'}",
                    f"- Child Depth: {subject_archive.get('child_depth')}",
                    "",
                ]
            )

        direct_parent = summary.get("direct_parent")
        self._append_descriptor_section(
            lines,
            title="Immediate Parent",
            items=(
                [direct_parent]
                if isinstance(direct_parent, dict) and direct_parent
                else []
            ),
            empty_text="no direct parent for this query",
        )
        self._append_descriptor_section(
            lines,
            title="Direct Children",
            items=summary.get("direct_children", []),
            empty_text="no direct children found",
        )
        self._append_descriptor_section(
            lines,
            title="Sibling Follow-Ups",
            items=summary.get("sibling_followups", []),
            empty_text="no sibling follow-ups found",
        )
        self._append_descriptor_section(
            lines,
            title="Broader Root Lineage",
            items=summary.get("root_lineage_records", []),
            empty_text="no lineage records found",
        )
        return "\n".join(lines)

    def render_carry_forward_summary(self, summary: dict[str, Any]) -> str:
        lines = [
            "# Carry-Forward Summary — "
            f"{summary.get('parent_task_title') or summary.get('parent_task_id')}",
            "",
            f"- Parent Task ID: {summary.get('parent_task_id') or 'unknown'}",
            f"- Root Task ID: {summary.get('root_task_id') or 'unknown'}",
            "- Parent Archive Record: "
            f"{summary.get('parent_qmd_record_id') or 'unknown'}",
            "- Parent QMD Scope: "
            f"{summary.get('parent_qmd_scope') or 'unknown'}",
            f"- Workflow Path: {summary.get('workflow_path') or 'unknown'}",
            "- Workflow Status: "
            f"{summary.get('workflow_status') or 'unknown'}",
            f"- Test Status: {summary.get('test_status') or 'unknown'}",
            f"- QA Status: {summary.get('qa_status') or 'unknown'}",
            "",
            "## Parent Intent",
            "",
            summary.get("business_goal")
            or summary.get("task_summary")
            or "No business goal recorded.",
            "",
            "## Implementation Summary",
            "",
            summary.get("implementation_summary")
            or "No implementation summary recorded.",
            "",
        ]

        self._append_list_section(
            lines,
            title="Touched Repos",
            items=summary.get("touched_repos", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Touched Services",
            items=summary.get("touched_services", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Relevant Files",
            items=summary.get("touched_files", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Slices Executed",
            items=summary.get("slice_ids", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Key Decisions",
            items=summary.get("key_decisions", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Inherited Constraints",
            items=summary.get("inherited_constraints", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Known Limitations",
            items=summary.get("known_limitations", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Follow-Up Backlog",
            items=summary.get("followup_pmcklog", []),
            empty_text="none recorded",
        )
        return "\n".join(lines)

    def render_task_retrospective_summary(
        self,
        summary: dict[str, Any],
    ) -> str:
        record = summary.get("retrospective_record") or {}
        lines = [
            "# Task Retrospective Summary — "
            f"{record.get('task_title') or summary.get('task_id')}",
            "",
            f"- Task ID: {record.get('task_id') or 'unknown'}",
            f"- Root Task ID: {record.get('root_task_id') or 'unknown'}",
            f"- Parent Task ID: {record.get('parent_task_id') or 'none'}",
            f"- Repo: {record.get('repo_name') or 'unknown'}",
            f"- Scope: {summary.get('qmd_scope') or 'unknown'}",
            "",
            "## Retrospective Summary",
            "",
            record.get("retrospective_summary")
            or "No retrospective summary recorded.",
            "",
        ]
        self._append_list_section(
            lines,
            title="What Went Well",
            items=record.get("what_went_well", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="What Could Have Gone Better",
            items=record.get("what_could_have_gone_better", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Action Items",
            items=record.get("action_items", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Reusable Team Learnings",
            items=record.get("reusable_team_learnings", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Anti-Patterns To Avoid",
            items=record.get("anti_patterns", []),
            empty_text="none recorded",
        )
        lines.extend(["## Agent Contributions", ""])
        agent_contributions = record.get("agent_contributions") or {}
        if agent_contributions:
            for role in sorted(agent_contributions):
                lines.append(f"### {role}")
                lines.append("")
                for item in agent_contributions.get(role, []):
                    lines.append(f"- {item}")
                lines.append("")
        else:
            lines.extend(["- none recorded", ""])
        return "\n".join(lines)

    def render_shared_retrospective_memory(
        self,
        summary: dict[str, Any],
    ) -> str:
        record = summary.get("shared_memory_record") or {}
        lines = [
            "# Shared Retrospective Memory",
            "",
            "- Glopml Root: "
            f"{summary.get('glopml_retrospective_root') or 'unknown'}",
            "- Updated At: "
            f"{record.get('updated_at_utc') or 'unknown'}",
            "",
        ]
        self._append_list_section(
            lines,
            title="Contributing Tasks",
            items=record.get("synthesized_from_task_ids", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Recurring Strengths",
            items=record.get("recurring_strengths", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Recurring Bottlenecks",
            items=record.get("recurring_bottlenecks", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Open Action Items",
            items=record.get("open_action_items", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Validated Improvements",
            items=record.get("validated_improvements", []),
            empty_text="none recorded",
        )
        self._append_list_section(
            lines,
            title="Anti-Patterns To Avoid",
            items=record.get("anti_patterns", []),
            empty_text="none recorded",
        )
        return "\n".join(lines)

    def render_run_markdown(self, report: dict[str, Any]) -> str:
        lines = [
            "# QMD Live Seed Run",
            "",
            f"- Started At: {report['run_started_at']}",
            f"- Context Pack ID: {report['context_pack_id']}",
            f"- Context Pack Dir: {report['context_pack_dir']}",
            f"- QMD Scope Root: {report['qmd_scope_root']}",
            f"- Input Source: {report['input_source']}",
            f"- Overall Status: {report['overall_status']}",
            f"- Seeded Repos: {report['seeded_repo_count']}",
            f"- Blocked Repos: {report['blocked_repo_count']}",
            f"- Error Repos: {report['error_repo_count']}",
            f"- Invalidated Records: {report['invalidated_record_count']}",
            "",
            "## Repository Results",
            "",
        ]
        for repo in report["repositories"]:
            lines.extend(
                [
                    f"### {repo['repo_id']}",
                    "",
                    f"- Status: {repo['status']}",
                    f"- Source Root: {repo['source_root'] or 'none'}",
                    f"- Seeded Records: {repo['seeded_records']}",
                    f"- Invalidated Records: {repo['invalidated_records']}",
                ]
            )
            if repo.get("warnings"):
                lines.append("- Warnings:")
                for warning in repo["warnings"]:
                    lines.append(f"  - {warning}")
            if repo.get("errors"):
                lines.append("- Errors:")
                for error in repo["errors"]:
                    lines.append(f"  - {error}")
            lines.append("")
        return "\n".join(lines)
