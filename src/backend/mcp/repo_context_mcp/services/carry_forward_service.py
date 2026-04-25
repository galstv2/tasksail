from __future__ import annotations

from typing import Any, Callable

from ..utils import (
    compact_list,
    compact_text,
    normalize_string_list,
    unique_preserving_order,
)
from .archive_service import TaskArchiveService


class CarryForwardService:
    def __init__(
        self,
        *,
        archive_service: TaskArchiveService,
        render_carry_forward_summary: (
            Callable[[dict[str, Any]], str] | None
        ) = None,
    ) -> None:
        self.archive_service = archive_service
        self.render_carry_forward_summary = render_carry_forward_summary

    def build_summary(
        self,
        *,
        context_pack_dir: str,
        parent_qmd_scope: str,
        parent_qmd_record_id: str | None = None,
        parent_task_id: str | None = None,
    ) -> dict[str, Any]:
        resolution = self.archive_service.resolve_parent_archive(
            context_pack_dir=context_pack_dir,
            parent_qmd_scope=parent_qmd_scope,
            parent_qmd_record_id=parent_qmd_record_id,
            parent_task_id=parent_task_id,
        )
        record = resolution.record

        touched_repos = unique_preserving_order(
            [str(record.get("repo_name") or "").strip()]
            + normalize_string_list(record.get("related_repos"))
        )
        touched_services = unique_preserving_order(
            [str(record.get("service_name") or "").strip()]
            + normalize_string_list(record.get("related_services"))
        )

        workflow_path = str(record.get("workflow_path") or "").strip()
        if not workflow_path:
            for tag in normalize_string_list(record.get("tags")):
                if tag.startswith("workflow-path:"):
                    workflow_path = tag.split(":", 1)[1]
                    break

        summary = {
            "summary_type": "child-task-carry-forward/v1",
            "context_pack_dir": resolution.context_pack_dir,
            "parent_qmd_scope": resolution.qmd_scope,
            "parent_qmd_record_id": str(record.get("record_id") or "").strip(),
            "parent_archive_path": resolution.record_path,
            "parent_task_id": str(
                record.get("task_id") or parent_task_id or ""
            ).strip(),
            "root_task_id": str(
                record.get("root_task_id")
                or record.get("task_id")
                or parent_task_id
                or ""
            ).strip(),
            "parent_task_title": compact_text(
                record.get("task_title") or record.get("title"),
                max_length=180,
            ),
            "context_pack_id": str(
                record.get("context_pack_id") or ""
            ).strip(),
            "task_type": str(record.get("task_type") or "").strip(),
            "workflow_path": workflow_path,
            "workflow_status": str(
                record.get("workflow_status") or ""
            ).strip(),
            "test_status": str(record.get("test_status") or "").strip(),
            "qa_status": str(record.get("qa_status") or "").strip(),
            "task_summary": compact_text(
                record.get("task_summary") or record.get("summary"),
                max_length=320,
            ),
            "business_goal": compact_text(
                record.get("business_goal"),
                max_length=320,
            ),
            "implementation_summary": compact_text(
                record.get("implementation_summary")
                or record.get("completed_work_summary")
                or record.get("summary"),
                max_length=360,
            ),
            "touched_repos": [item for item in touched_repos if item],
            "touched_services": [item for item in touched_services if item],
            "touched_files": compact_list(
                normalize_string_list(record.get("touched_files")),
                max_items=8,
            ),
            "slice_ids": compact_list(
                normalize_string_list(record.get("slice_ids")),
                max_items=8,
            ),
            "key_decisions": compact_list(
                normalize_string_list(
                    record.get("key_decisions")
                    or record.get("key_design_decisions")
                )
            ),
            "inherited_constraints": compact_list(
                normalize_string_list(record.get("constraints"))
            ),
            "known_limitations": compact_list(
                normalize_string_list(record.get("known_limitations"))
            ),
            "followup_backlog": compact_list(
                normalize_string_list(
                    record.get("followup_backlog")
                    or record.get("followup_pmcklog")
                    or record.get("followup_refs")
                )
            ),
            "provenance_sources": normalize_string_list(
                record.get("provenance_sources")
            ),
        }
        summary["followup_pmcklog"] = summary["followup_backlog"]

        if self.render_carry_forward_summary is not None:
            summary["rendered_summary_markdown"] = (
                self.render_carry_forward_summary(summary)
            )
        return summary
