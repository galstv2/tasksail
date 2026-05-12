"""Tests for LineageService — descriptor-backed lineage resolution."""

from __future__ import annotations

import json
from pathlib import Path

from src.backend.mcp.repo_context_mcp.services.archive_service import TaskArchiveService
from src.backend.mcp.repo_context_mcp.services.lineage_service import LineageService
from src.backend.mcp.repo_context_mcp.services.qmd_index_service import QmdIndexService
from src.backend.mcp.repo_context_mcp.services.record_cache import ScopedRecordCache


def _write_archive(scope_dir: Path, file_name: str, record: dict) -> Path:
    archive_dir = scope_dir / "archive" / "tasks" / "platform" / "2026" / Path(file_name).stem
    archive_dir.mkdir(parents=True, exist_ok=True)
    path = archive_dir / "archive.json"
    path.write_text(json.dumps(record), encoding="utf-8")
    return path


def _make_services(
    workspace_root: Path,
) -> tuple[TaskArchiveService, QmdIndexService, LineageService]:
    cache = ScopedRecordCache(ttl_seconds=300.0)
    archive = TaskArchiveService(
        workspace_root=workspace_root,
        record_cache=cache,
    )
    qmd = QmdIndexService(
        workspace_root=workspace_root,
        archive_service=archive,
    )
    lineage = LineageService(
        workspace_root=workspace_root,
        qmd_index_service=qmd,
    )
    qmd.set_lineage_service(lineage)
    return archive, qmd, lineage


BASE_RECORD = {
    "record_type": "task-archive",
    "repo_name": "platform",
}


class TestLineageServiceSummary:
    def test_lineage_summary_matches_archive_service_output(
        self, tmp_path: Path,
    ) -> None:
        context_pack_dir = tmp_path / "context-pack"
        scope = "qmd/context-packs/sample-org"
        scope_dir = context_pack_dir / scope

        _write_archive(scope_dir, "cap-1000.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-1000",
            "task_id": "CAP-1000",
            "root_task_id": "CAP-1000",
            "task_title": "Root Task",
        })
        _write_archive(scope_dir, "cap-1001.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-1001",
            "task_id": "CAP-1001",
            "root_task_id": "CAP-1000",
            "parent_task_id": "CAP-1000",
            "task_title": "Child Task",
            "child_depth": 1,
        })

        archive_svc = TaskArchiveService(workspace_root=tmp_path)
        old_result = archive_svc.build_task_lineage_summary(
            context_pack_dir=str(context_pack_dir),
            qmd_scope=scope,
            task_id="CAP-1001",
        )

        _, _, lineage_svc = _make_services(tmp_path)
        new_result = lineage_svc.build_task_lineage_summary(
            context_pack_dir=str(context_pack_dir),
            qmd_scope=scope,
            task_id="CAP-1001",
        )

        assert new_result["summary_type"] == old_result["summary_type"]
        assert new_result["root_task_id"] == old_result["root_task_id"]
        assert new_result["root_archive"]["task_id"] == old_result["root_archive"]["task_id"]
        assert new_result["subject_archive"]["task_id"] == old_result["subject_archive"]["task_id"]
        assert new_result["direct_parent"]["task_id"] == old_result["direct_parent"]["task_id"]
        assert (
            [d["task_id"] for d in new_result["direct_children"]]
            == [d["task_id"] for d in old_result["direct_children"]]
        )
        assert (
            [d["task_id"] for d in new_result["root_lineage_records"]]
            == [d["task_id"] for d in old_result["root_lineage_records"]]
        )

    def test_lineage_summary_root_task_id_only(
        self, tmp_path: Path,
    ) -> None:
        context_pack_dir = tmp_path / "context-pack"
        scope = "qmd/context-packs/sample-org"
        scope_dir = context_pack_dir / scope

        _write_archive(scope_dir, "cap-2000.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-2000",
            "task_id": "CAP-2000",
            "root_task_id": "CAP-2000",
            "task_title": "Root Only",
        })
        _write_archive(scope_dir, "cap-2001.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-2001",
            "task_id": "CAP-2001",
            "root_task_id": "CAP-2000",
            "parent_task_id": "CAP-2000",
            "task_title": "Child",
            "child_depth": 1,
        })

        _, _, lineage_svc = _make_services(tmp_path)
        result = lineage_svc.build_task_lineage_summary(
            context_pack_dir=str(context_pack_dir),
            qmd_scope=scope,
            root_task_id="CAP-2000",
        )

        assert result["subject_archive"] is None
        assert result["root_archive"]["task_id"] == "CAP-2000"
        assert len(result["root_lineage_records"]) == 2


class TestLineageIndexCache:
    def test_lineage_index_cache_avoids_rebuild(
        self, tmp_path: Path,
    ) -> None:
        context_pack_dir = tmp_path / "context-pack"
        scope = "qmd/context-packs/sample-org"
        scope_dir = context_pack_dir / scope

        _write_archive(scope_dir, "cap-3000.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-3000",
            "task_id": "CAP-3000",
            "root_task_id": "CAP-3000",
            "task_title": "Cached Task",
        })

        _, _, lineage_svc = _make_services(tmp_path)
        first = lineage_svc._lineage_index(scope_dir)
        second = lineage_svc._lineage_index(scope_dir)

        assert first is second

    def test_lineage_cache_invalidated_on_new_record(
        self, tmp_path: Path,
    ) -> None:
        context_pack_dir = tmp_path / "context-pack"
        scope = "qmd/context-packs/sample-org"
        scope_dir = context_pack_dir / scope

        _write_archive(scope_dir, "cap-4000.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-4000",
            "task_id": "CAP-4000",
            "root_task_id": "CAP-4000",
            "task_title": "Original",
        })

        _, qmd_svc, lineage_svc = _make_services(tmp_path)

        result_before = lineage_svc.build_task_lineage_summary(
            context_pack_dir=str(context_pack_dir),
            qmd_scope=scope,
            root_task_id="CAP-4000",
        )
        assert len(result_before["root_lineage_records"]) == 1

        _write_archive(scope_dir, "cap-4001.json", {
            **BASE_RECORD,
            "record_id": "task:sample:CAP-4001",
            "task_id": "CAP-4001",
            "root_task_id": "CAP-4000",
            "parent_task_id": "CAP-4000",
            "task_title": "New Child",
            "child_depth": 1,
        })

        qmd_svc.invalidate_archive_cache(scope_dir)

        result_after = lineage_svc.build_task_lineage_summary(
            context_pack_dir=str(context_pack_dir),
            qmd_scope=scope,
            root_task_id="CAP-4000",
        )
        assert len(result_after["root_lineage_records"]) == 2
