"""Descriptor-pmcked lineage resolution with cached index maps.

Resolves lineage queries from pre-built task descriptors instead of
raw archive records, eliminating per-query O(n) index rebuilds.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from ..utils import (
    normalize_optional_string,
    resolve_context_pack_dir,
    resolve_path_within,
)

if TYPE_CHECKING:
    from .qmd_index_service import QmdIndexService


@dataclass
class _LineageIndex:
    """Pre-built lookup indexes derived from task descriptors."""

    source_id: int
    by_task_id: dict[str, list[dict[str, Any]]]
    by_root: dict[str, list[dict[str, Any]]]


class LineageService:
    """Resolves task-archive lineage queries from cached descriptors."""

    def __init__(
        self,
        *,
        workspace_root: Path | None = None,
        qmd_index_service: QmdIndexService,
        render_lineage_summary: Callable[[dict[str, Any]], str] | None = None,
    ) -> None:
        self._workspace_root = workspace_root or Path.cwd()
        self._qmd_index = qmd_index_service
        self._render = render_lineage_summary
        self._index_cache: dict[str, _LineageIndex] = {}

    def invalidate_cache(self, scope_dir: Path | None = None) -> None:
        if scope_dir is None:
            self._index_cache.clear()
        else:
            self._index_cache.pop(str(scope_dir), None)

    def _lineage_index(self, scope_dir: Path) -> _LineageIndex:
        """Return cached lineage index, rebuilding only when descriptors change."""
        key = str(scope_dir)
        descriptors = self._qmd_index.task_descriptors(scope_dir)
        current_id = id(descriptors)
        cached = self._index_cache.get(key)
        if cached is not None and cached.source_id == current_id:
            return cached

        by_task_id: dict[str, list[dict[str, Any]]] = {}
        by_root: dict[str, list[dict[str, Any]]] = {}
        for desc in descriptors:
            tid = desc["task_id"]
            rid = desc["root_task_id"]
            by_task_id.setdefault(tid, []).append(desc)
            by_root.setdefault(rid, []).append(desc)

        index = _LineageIndex(
            source_id=current_id,
            by_task_id=by_task_id,
            by_root=by_root,
        )
        self._index_cache[key] = index
        return index

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
        scope_dir = resolve_path_within(
            context_pack_path, qmd_scope, "qmd_scope",
        )
        index = self._lineage_index(scope_dir)

        subject: dict[str, Any] | None = None
        if normalized_task_id:
            subject = self._require_single_descriptor(
                index.by_task_id.get(normalized_task_id),
                task_id=normalized_task_id,
                failure_label="task archive",
            )
            effective_root_task_id = subject["root_task_id"]
        else:
            effective_root_task_id = normalized_root_task_id

        root_desc = self._require_single_descriptor(
            index.by_task_id.get(effective_root_task_id),
            task_id=effective_root_task_id,
            failure_label="root lineage archive",
        )

        lineage_descs = list(index.by_root.get(effective_root_task_id, []))
        lineage_descs.sort(key=lambda d: (d["child_depth"], d["task_id"]))

        subject_parent: dict[str, Any] | None = None
        sibling_followups: list[dict[str, Any]] = []
        direct_children: list[dict[str, Any]] = []
        descendant_followups: list[dict[str, Any]] = []

        if subject is not None:
            subject_task_id = subject["task_id"]
            parent_task_id = subject["parent_task_id"]
            if parent_task_id:
                subject_parent = self._require_single_descriptor(
                    index.by_task_id.get(parent_task_id),
                    task_id=parent_task_id,
                    failure_label="parent archive",
                )

            for desc in lineage_descs:
                current_task_id = desc["task_id"]
                if current_task_id == subject_task_id:
                    continue
                if desc["parent_task_id"] == subject_task_id:
                    direct_children.append(desc)
                else:
                    descendant_followups.append(desc)
                if (
                    parent_task_id
                    and desc["parent_task_id"] == parent_task_id
                ):
                    sibling_followups.append(desc)

            sibling_followups = [
                d for d in sibling_followups
                if d["task_id"] != subject_task_id
            ]

        # Sublists inherit sort order from lineage_descs (already sorted
        # by child_depth, task_id) so no additional sorting needed.

        summary: dict[str, Any] = {
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
            "root_archive": root_desc,
            "subject_archive": subject,
            "direct_parent": subject_parent,
            "direct_children": direct_children,
            "sibling_followups": sibling_followups,
            "descendant_followups": descendant_followups,
            "root_lineage_records": lineage_descs,
        }
        if self._render is not None:
            summary["rendered_summary_markdown"] = self._render(summary)
        return summary

    def _resolve_context_pack_dir(self, context_pack_dir: str) -> Path:
        return resolve_context_pack_dir(
            self._workspace_root,
            context_pack_dir,
            allow_host_paths=True,
        )

    @staticmethod
    def _require_single_descriptor(
        matches: list[dict[str, Any]] | None,
        *,
        task_id: str,
        failure_label: str,
    ) -> dict[str, Any]:
        if not matches:
            raise ValueError(
                f"No {failure_label} matched task_id '{task_id}' "
                "in the requested scope"
            )
        if len(matches) > 1:
            candidate_ids = [
                m.get("record_id") or m.get("archive_path", "")
                for m in matches
            ]
            raise ValueError(
                f"Ambiguous {failure_label} task_id '{task_id}' "
                "in the requested scope: "
                + ", ".join(candidate_ids)
            )
        return matches[0]
