"""Cycle record aggregation for behavior correction memos."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..io import load_json_safe
from ..text import extract_list
from .retrospective import (
    extract_contribution_sections,
    is_actionable,
    rank_frequency_map,
)
from .storage import resolve_scope_path


class CycleSummaryBuilder:
    """Aggregates task archive and retrospective records for a cycle."""

    def __init__(
        self,
        repo_root: Path,
        context_pack_dir: Path,
        qmd_scope: str,
    ) -> None:
        self._repo_root = repo_root.resolve()
        self._context_pack_dir = context_pack_dir.resolve()
        self._qmd_scope = qmd_scope
        self._scope_dir = resolve_scope_path(context_pack_dir, qmd_scope)

    def collect_cycle_records(
        self,
        task_ids: list[str],
    ) -> list[dict[str, Any]]:
        """Collect retrospective records matching the given task IDs."""
        retro_dir = self._scope_dir / "archive" / "retrospectives"
        if not retro_dir.is_dir():
            return []

        records: list[dict[str, Any]] = []
        target_ids = set(task_ids)
        for record_path in retro_dir.rglob("*.record.json"):
            data, error = load_json_safe(record_path)
            if error or data is None:
                continue
            record_task_id = str(data.get("task_id") or "").strip()
            if record_task_id in target_ids:
                records.append(data)
        return records

    def build_cycle_summary(
        self,
        task_ids: list[str],
    ) -> dict[str, Any]:
        """Build an aggregated summary from cycle retrospective records."""
        records = self.collect_cycle_records(task_ids)

        strengths: dict[str, list[str]] = {}
        bottlenecks: dict[str, list[str]] = {}
        action_items: dict[str, list[str]] = {}
        anti_patterns: dict[str, list[str]] = {}
        improvements: dict[str, list[str]] = {}
        per_role: dict[str, dict[str, list[str]]] = {}
        difficulty_counts: dict[str, int] = {}
        remediation_count = 0

        for record in records:
            tid = str(record.get("task_id") or "").strip()
            for item in record.get("what_went_well") or []:
                strengths.setdefault(str(item).strip(), []).append(tid)
            for item in record.get("what_could_have_gone_better") or []:
                text = str(item).strip()
                if is_actionable(text):
                    bottlenecks.setdefault(text, []).append(tid)
            for item in record.get("action_items") or []:
                text = str(item).strip()
                if is_actionable(text):
                    action_items.setdefault(text, []).append(tid)
            for item in record.get("anti_patterns") or []:
                text = str(item).strip()
                if is_actionable(text):
                    anti_patterns.setdefault(text, []).append(tid)
            for item in record.get("reusable_team_learnings") or []:
                text = str(item).strip()
                if is_actionable(text):
                    improvements.setdefault(text, []).append(tid)

            contributions = record.get("agent_contributions") or {}
            for role_name, items in contributions.items():
                role_map = per_role.setdefault(role_name, {})
                for item in items or []:
                    role_map.setdefault(str(item).strip(), []).append(tid)

        archive_dir = self._scope_dir / "archive" / "tasks"
        if archive_dir.is_dir():
            target_ids = set(task_ids)
            for archive_path in archive_dir.rglob("*.json"):
                if archive_path.name.endswith(".record.json"):
                    continue
                data, error = load_json_safe(archive_path)
                if error or data is None:
                    continue
                atid = str(data.get("task_id") or "").strip()
                if atid not in target_ids:
                    continue
                diff = str(data.get("difficulty_level") or "").strip()
                if diff:
                    difficulty_counts[diff] = (
                        difficulty_counts.get(diff, 0) + 1
                    )

        return {
            "task_count": len(task_ids),
            "records_found": len(records),
            "task_ids": list(task_ids),
            "difficulty_distribution": difficulty_counts,
            "remediation_cycles": remediation_count,
            "ranked_strengths": rank_frequency_map(strengths),
            "ranked_bottlenecks": rank_frequency_map(bottlenecks),
            "ranked_action_items": rank_frequency_map(action_items),
            "ranked_anti_patterns": rank_frequency_map(anti_patterns),
            "ranked_improvements": rank_frequency_map(improvements),
            "per_role_ranked": {
                role: rank_frequency_map(items)
                for role, items in per_role.items()
            },
        }
