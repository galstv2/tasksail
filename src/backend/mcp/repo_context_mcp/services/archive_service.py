from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from ..models import ParentArchiveResolution, TaskArchiveResolution
from ..utils import (
    compact_text,
    load_json,
    normalize_optional_string,
    normalize_string_list,
    parse_int,
    resolve_path_within,
)
from ..utils import (
    resolve_context_data_dir as _resolve_context_data_dir,
)
from .record_cache import ScopedRecordCache

logger = logging.getLogger(__name__)


class TaskArchiveService:
    def __init__(
        self,
        *,
        workspace_root: Path | None = None,
        render_lineage_summary: Callable[[dict[str, Any]], str] | None = None,
        global_retrospective_root: str | None = None,
        glopml_retrospective_root: str = "qmd/global/retrospectives",
        record_cache: ScopedRecordCache | None = None,
    ) -> None:
        self.workspace_root = workspace_root or Path.cwd()
        self.render_lineage_summary = render_lineage_summary
        self._glopml_retro_root = (
            global_retrospective_root
            if global_retrospective_root is not None
            else glopml_retrospective_root
        )
        self._record_cache = record_cache or ScopedRecordCache()

    def _resolve_context_pack_dir(self, context_pack_dir: str) -> Path:
        return _resolve_context_data_dir(context_pack_dir)

    def _resolve_scope_dir(self, context_pack_path: Path, qmd_scope: str) -> Path:
        return resolve_path_within(context_pack_path, qmd_scope, "qmd_scope")

    def iter_task_archive_records(
        self,
        scope_dir: Path,
    ) -> list[tuple[Path, dict[str, Any]]]:
        return self._iter_records_by_type(scope_dir, "task-archive")

    def iter_task_retrospective_records(
        self,
        scope_dir: Path,
    ) -> list[tuple[Path, dict[str, Any]]]:
        return self._iter_records_by_type(scope_dir, "task-retrospective")

    def iter_glopml_retrospective_history_records(
        self,
        repo_root: Path,
    ) -> list[tuple[Path, dict[str, Any]]]:
        history_root = self._glopml_retrospective_root(repo_root) / "history"
        return self._iter_records_by_type(
            history_root,
            "glopml-retrospective-entry",
        )

    def _iter_records_by_type(
        self,
        scope_dir: Path,
        record_type: str,
    ) -> list[tuple[Path, dict[str, Any]]]:
        cached = self._record_cache.get(scope_dir, record_type)
        if cached is not None:
            return cached

        if not scope_dir.exists():
            return []

        grouped: dict[str, list[tuple[Path, dict[str, Any]]]] = {}
        for path in sorted(scope_dir.rglob("*.json")):
            try:
                payload = load_json(path)
            except ValueError:
                logger.warning("Skipping unreadable archive record at %s", path)
                continue
            if not isinstance(payload, dict):
                logger.debug("Skipping non-object archive record at %s", path)
                continue
            rt = payload.get("record_type")
            if not rt:
                continue
            grouped.setdefault(rt, []).append((path, payload))

        self._record_cache.put_scope(scope_dir, grouped)
        return grouped.get(record_type, [])

    def merge_written_records(
        self,
        scope_dir: Path,
        records: list[tuple[Path, dict[str, Any]]],
    ) -> None:
        """Update the record cache with freshly-written records."""
        self._record_cache.merge_scope(scope_dir, records)

    def invalidate_cache(self, scope_dir: Path | None = None) -> None:
        self._record_cache.invalidate(scope_dir)

    @staticmethod
    def archive_task_id(record: dict[str, Any]) -> str:
        return normalize_optional_string(record.get("task_id"))

    @classmethod
    def archive_root_task_id(cls, record: dict[str, Any]) -> str:
        return normalize_optional_string(
            record.get("root_task_id")
        ) or cls.archive_task_id(record)

    @staticmethod
    def archive_parent_task_id(record: dict[str, Any]) -> str:
        return normalize_optional_string(record.get("parent_task_id"))

    @staticmethod
    def archive_child_depth(record: dict[str, Any]) -> int:
        return parse_int(record.get("child_depth"), default=0)

    @classmethod
    def task_archive_descriptor(
        cls,
        path: Path,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        task_id = cls.archive_task_id(record)
        return {
            "record_id": normalize_optional_string(record.get("record_id")),
            "task_id": task_id,
            "task_title": compact_text(
                record.get("task_title") or record.get("title"),
                max_length=180,
            ),
            "root_task_id": cls.archive_root_task_id(record),
            "parent_task_id": cls.archive_parent_task_id(record),
            "parent_qmd_record_id": normalize_optional_string(
                record.get("parent_qmd_record_id")
            ),
            "parent_qmd_scope": normalize_optional_string(
                record.get("parent_qmd_scope")
            ),
            "followup_reason": compact_text(
                record.get("followup_reason"),
                max_length=180,
            ),
            "child_depth": cls.archive_child_depth(record),
            "workflow_status": normalize_optional_string(
                record.get("workflow_status")
            ),
            "test_status": normalize_optional_string(
                record.get("test_status")
            ),
            "qa_status": normalize_optional_string(record.get("qa_status")),
            "repo_name": normalize_optional_string(record.get("repo_name")),
            "service_name": normalize_optional_string(
                record.get("service_name")
            ),
            "followup_refs": normalize_string_list(
                record.get("followup_refs")
                or record.get("followup_pmcklog")
            ),
            "provenance_sources": normalize_string_list(
                record.get("provenance_sources")
            ),
            "archive_path": str(path),
            "lineage_role": (
                "root"
                if cls.archive_root_task_id(record) == task_id
                else "child"
            ),
        }

    @classmethod
    def task_retrospective_descriptor(
        cls,
        path: Path,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        task_id = cls.archive_task_id(record)
        return {
            "record_id": normalize_optional_string(record.get("record_id")),
            "task_id": task_id,
            "task_title": compact_text(
                record.get("task_title") or record.get("title"),
                max_length=180,
            ),
            "root_task_id": cls.archive_root_task_id(record),
            "parent_task_id": cls.archive_parent_task_id(record),
            "repo_name": normalize_optional_string(record.get("repo_name")),
            "workflow_roles_present": normalize_string_list(
                record.get("workflow_roles_present")
            ),
            "action_items": normalize_string_list(record.get("action_items")),
            "retrospective_summary": compact_text(
                record.get("retrospective_summary") or record.get("summary"),
                max_length=240,
            ),
            "what_went_well": normalize_string_list(
                record.get("what_went_well")
            ),
            "what_could_have_gone_better": normalize_string_list(
                record.get("what_could_have_gone_better")
            ),
            "reusable_team_learnings": normalize_string_list(
                record.get("reusable_team_learnings")
            ),
            "anti_patterns": normalize_string_list(record.get("anti_patterns")),
            "agent_contributions": record.get("agent_contributions") or {},
            "record_path": str(path),
            "source_path": normalize_optional_string(record.get("source_path")),
            "indexed_at": normalize_optional_string(record.get("indexed_at")),
            "record_type": normalize_optional_string(record.get("record_type")),
        }

    @staticmethod
    def glopml_retrospective_descriptor(
        path: Path,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "record_id": normalize_optional_string(record.get("record_id")),
            "task_id": normalize_optional_string(record.get("task_id")),
            "task_title": compact_text(
                record.get("task_title") or record.get("title"),
                max_length=180,
            ),
            "retrospective_summary": compact_text(
                record.get("retrospective_summary") or record.get("summary"),
                max_length=240,
            ),
            "workflow_roles_present": normalize_string_list(
                record.get("workflow_roles_present")
            ),
            "action_items": normalize_string_list(record.get("action_items")),
            "what_went_well": normalize_string_list(
                record.get("what_went_well")
            ),
            "what_could_have_gone_better": normalize_string_list(
                record.get("what_could_have_gone_better")
            ),
            "reusable_team_learnings": normalize_string_list(
                record.get("reusable_team_learnings")
            ),
            "anti_patterns": normalize_string_list(record.get("anti_patterns")),
            "record_path": str(path),
            "source_path": normalize_optional_string(record.get("source_path")),
            "indexed_at": normalize_optional_string(record.get("indexed_at")),
        }

    @staticmethod
    def _require_single_match(
        matches: list[TaskArchiveResolution] | None,
        *,
        task_id: str,
        failure_label: str,
    ) -> TaskArchiveResolution:
        if not matches:
            raise ValueError(
                f"No {failure_label} matched task_id '{task_id}' "
                "in the requested scope"
            )
        if len(matches) > 1:
            candidate_ids = [
                normalize_optional_string(match.record.get("record_id"))
                or str(match.path)
                for match in matches
            ]
            raise ValueError(
                f"Ambiguous {failure_label} task_id '{task_id}' "
                "in the requested scope: "
                + ", ".join(candidate_ids)
            )
        return matches[0]

    @classmethod
    def resolve_task_archive_by_task_id(
        cls,
        archive_records: list[tuple[Path, dict[str, Any]]],
        *,
        task_id: str,
        failure_label: str,
    ) -> TaskArchiveResolution:
        matches = [
            TaskArchiveResolution(path=path, record=record)
            for path, record in archive_records
            if cls.archive_task_id(record) == task_id
        ]
        return cls._require_single_match(
            matches, task_id=task_id, failure_label=failure_label
        )

    @staticmethod
    def _resolve_from_index(
        index: dict[str, list[TaskArchiveResolution]],
        *,
        task_id: str,
        failure_label: str,
    ) -> TaskArchiveResolution:
        return TaskArchiveService._require_single_match(
            index.get(task_id), task_id=task_id, failure_label=failure_label
        )

    def build_task_lineage_summary(
        self,
        *,
        context_pack_dir: str,
        qmd_scope: str,
        task_id: str | None = None,
        root_task_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_task_id = normalize_optional_string(task_id)
        normalized_root_task_id = normalize_optional_string(root_task_id)
        if not normalized_task_id and not normalized_root_task_id:
            raise ValueError("Lineage lookup requires task_id or root_task_id")

        context_pack_path = self._resolve_context_pack_dir(context_pack_dir)
        scope_dir = self._resolve_scope_dir(context_pack_path, qmd_scope)
        archive_records = self.iter_task_archive_records(scope_dir)

        by_task_id: dict[str, list[TaskArchiveResolution]] = {}
        by_root: dict[str, list[TaskArchiveResolution]] = {}
        for path, record in archive_records:
            tid = self.archive_task_id(record)
            rid = self.archive_root_task_id(record)
            resolution = TaskArchiveResolution(path=path, record=record)
            by_task_id.setdefault(tid, []).append(resolution)
            by_root.setdefault(rid, []).append(resolution)

        subject: TaskArchiveResolution | None = None
        if normalized_task_id:
            subject = self._resolve_from_index(
                by_task_id,
                task_id=normalized_task_id,
                failure_label="task archive",
            )
            effective_root_task_id = self.archive_root_task_id(subject.record)
        else:
            effective_root_task_id = normalized_root_task_id

        root_resolution = self._resolve_from_index(
            by_task_id,
            task_id=effective_root_task_id,
            failure_label="root lineage archive",
        )

        lineage_resolutions = list(by_root.get(effective_root_task_id, []))
        lineage_resolutions.sort(
            key=lambda entry: (
                self.archive_child_depth(entry.record),
                self.archive_task_id(entry.record),
            )
        )

        subject_parent: dict[str, Any] | None = None
        sibling_followups: list[dict[str, Any]] = []
        direct_children: list[dict[str, Any]] = []
        descendant_followups: list[dict[str, Any]] = []

        if subject is not None:
            subject_task_id = self.archive_task_id(subject.record)
            parent_task_id = self.archive_parent_task_id(subject.record)
            if parent_task_id:
                parent_resolution = self._resolve_from_index(
                    by_task_id,
                    task_id=parent_task_id,
                    failure_label="parent archive",
                )
                subject_parent = self.task_archive_descriptor(
                    parent_resolution.path,
                    parent_resolution.record,
                )

            for resolution in lineage_resolutions:
                descriptor = self.task_archive_descriptor(
                    resolution.path,
                    resolution.record,
                )
                current_task_id = descriptor["task_id"]
                if current_task_id == subject_task_id:
                    continue
                if descriptor["parent_task_id"] == subject_task_id:
                    direct_children.append(descriptor)
                else:
                    descendant_followups.append(descriptor)
                if (
                    parent_task_id
                    and descriptor["parent_task_id"] == parent_task_id
                ):
                    sibling_followups.append(descriptor)

            sibling_followups = [
                descriptor
                for descriptor in sibling_followups
                if descriptor["task_id"] != subject_task_id
            ]

        direct_children.sort(
            key=lambda item: (item["child_depth"], item["task_id"])
        )
        descendant_followups.sort(
            key=lambda item: (item["child_depth"], item["task_id"])
        )
        sibling_followups.sort(
            key=lambda item: (item["child_depth"], item["task_id"])
        )

        summary = {
            "summary_type": "task-archive-lineage/v1",
            "context_pack_dir": str(context_pack_path),
            "qmd_scope": qmd_scope,
            "query": {
                "task_id": normalized_task_id,
                "root_task_id": (
                    normalized_root_task_id or effective_root_task_id
                ),
            },
            "root_task_id": effective_root_task_id,
            "root_archive": self.task_archive_descriptor(
                root_resolution.path,
                root_resolution.record,
            ),
            "subject_archive": (
                self.task_archive_descriptor(subject.path, subject.record)
                if subject is not None
                else None
            ),
            "direct_parent": subject_parent,
            "direct_children": direct_children,
            "sibling_followups": sibling_followups,
            "descendant_followups": descendant_followups,
            "root_lineage_records": [
                self.task_archive_descriptor(
                    resolution.path,
                    resolution.record,
                )
                for resolution in lineage_resolutions
            ],
        }
        if self.render_lineage_summary is not None:
            summary["rendered_summary_markdown"] = (
                self.render_lineage_summary(summary)
            )
        return summary

    def build_task_retrospective_summary(
        self,
        *,
        context_pack_dir: str,
        qmd_scope: str,
        task_id: str,
    ) -> dict[str, Any]:
        normalized_task_id = normalize_optional_string(task_id)
        if not normalized_task_id:
            raise ValueError("Retrospective lookup requires task_id")

        context_pack_path = self._resolve_context_pack_dir(context_pack_dir)
        scope_dir = self._resolve_scope_dir(context_pack_path, qmd_scope)
        retrospective_records = self.iter_task_retrospective_records(scope_dir)
        resolution = self.resolve_task_archive_by_task_id(
            retrospective_records,
            task_id=normalized_task_id,
            failure_label="task retrospective",
        )
        return {
            "summary_type": "task-retrospective/v1",
            "context_pack_dir": str(context_pack_path),
            "qmd_scope": qmd_scope,
            "task_id": normalized_task_id,
            "retrospective_record": self.task_retrospective_descriptor(
                resolution.path,
                resolution.record,
            ),
        }

    def load_shared_retrospective_memory(self) -> dict[str, Any]:
        repo_root = self.workspace_root
        root_path = self._glopml_retrospective_root(repo_root)
        markdown_path = root_path / "shared-retrospective-memory.md"
        record_path = markdown_path.with_name(
            markdown_path.name + ".record.json"
        )
        if not record_path.exists():
            raise ValueError(
                "Shared retrospective memory record does not exist"
            )

        record = load_json(record_path)
        if record.get("record_type") != "glopml-retrospective-memory":
            raise ValueError(
                "Shared retrospective memory record has an unexpected type"
            )

        markdown = ""
        if markdown_path.exists():
            markdown = markdown_path.read_text(encoding="utf-8")

        return {
            "summary_type": "glopml-retrospective-memory/v1",
            "glopml_retrospective_root": self._display_root(root_path),
            "shared_memory_record": {
                "record_id": normalize_optional_string(record.get("record_id")),
                "record_type": normalize_optional_string(record.get("record_type")),
                "source_path": normalize_optional_string(record.get("source_path")),
                "record_path": str(record_path),
                "synthesized_from_task_ids": normalize_string_list(
                    record.get("synthesized_from_task_ids")
                ),
                "open_action_items": normalize_string_list(
                    record.get("open_action_items")
                ),
                "validated_improvements": normalize_string_list(
                    record.get("validated_improvements")
                ),
                "recurring_strengths": normalize_string_list(
                    record.get("recurring_strengths")
                ),
                "recurring_bottlenecks": normalize_string_list(
                    record.get("recurring_bottlenecks")
                ),
                "anti_patterns": normalize_string_list(
                    record.get("anti_patterns")
                ),
                "updated_at_utc": normalize_optional_string(
                    record.get("updated_at_utc") or record.get("updated_at")
                ),
            },
            "shared_memory_markdown": markdown,
        }

    def resolve_parent_archive(
        self,
        context_pack_dir: str,
        parent_qmd_scope: str,
        parent_qmd_record_id: str | None = None,
        parent_task_id: str | None = None,
    ) -> ParentArchiveResolution:
        if not parent_qmd_record_id and not parent_task_id:
            raise ValueError(
                "Parent archive lookup requires at least "
                "parent_qmd_record_id or parent_task_id"
            )

        context_pack_path = self._resolve_context_pack_dir(context_pack_dir)
        scope_dir = resolve_path_within(
            context_pack_path,
            parent_qmd_scope,
            "parent_qmd_scope",
        )
        archive_records = self.iter_task_archive_records(scope_dir)

        matches: list[tuple[Path, dict[str, Any]]] = archive_records
        if parent_qmd_record_id:
            matches = [
                (path, record)
                for path, record in matches
                if str(record.get("record_id") or "").strip()
                == parent_qmd_record_id
            ]

        if parent_task_id:
            matches = [
                (path, record)
                for path, record in matches
                if str(record.get("task_id") or "").strip() == parent_task_id
            ]

        if not matches:
            raise ValueError(
                "No parent task-archive record matched the requested "
                "scope and lineage fields"
            )

        if len(matches) > 1:
            candidate_ids = [
                str(record.get("record_id") or path)
                for path, record in matches
            ]
            raise ValueError(
                "Parent archive lookup is ambiguous inside the requested "
                "scope: "
                + ", ".join(candidate_ids)
            )

        record_path, record = matches[0]

        if (
            parent_qmd_record_id
            and str(record.get("record_id") or "").strip()
            != parent_qmd_record_id
        ):
            raise ValueError(
                "Resolved parent archive record does not match "
                "parent_qmd_record_id"
            )

        if (
            parent_task_id
            and str(record.get("task_id") or "").strip() != parent_task_id
        ):
            raise ValueError(
                "Resolved parent archive record does not match "
                "parent_task_id"
            )

        return ParentArchiveResolution(
            record=record,
            record_path=str(record_path),
            qmd_scope=parent_qmd_scope,
            context_pack_dir=str(context_pack_path),
        )

    def _glopml_retrospective_root(self, repo_root: Path) -> Path:
        return resolve_path_within(
            repo_root,
            self._glopml_retro_root,
            "glopml_retrospective_root",
        )

    def _display_root(self, root_path: Path) -> str:
        parts = root_path.as_posix().split("/")
        if "qmd" in parts:
            qmd_index = parts.index("qmd")
            return "/".join(parts[qmd_index:])
        return root_path.as_posix()
