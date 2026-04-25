"""Tests for write-through cache merge and parallel preview reads."""

from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import patch

from src.backend.mcp.repo_context_mcp.file_analysis import read_preview
from src.backend.mcp.repo_context_mcp.services.archive_service import TaskArchiveService
from src.backend.mcp.repo_context_mcp.services.qmd_index_service import QmdIndexService
from src.backend.mcp.repo_context_mcp.services.record_cache import ScopedRecordCache

# ---------------------------------------------------------------------------
# merge_scope — unit tests on ScopedRecordCache
# ---------------------------------------------------------------------------


class TestMergeScopeOverlays:
    def test_overlays_new_records_on_existing(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=60.0)

        existing = [
            (tmp_path / "a.json", {"record_type": "task-archive", "task_id": "T-1"}),
            (tmp_path / "b.json", {"record_type": "task-archive", "task_id": "T-2"}),
            (tmp_path / "c.json", {"record_type": "repo-artifact", "id": "R-1"}),
        ]
        cache.put_scope(tmp_path, {
            "task-archive": existing[:2],
            "repo-artifact": existing[2:],
        })

        updates = [
            (tmp_path / "b.json", {"record_type": "task-archive", "task_id": "T-2", "updated": True}),
            (tmp_path / "d.json", {"record_type": "repo-artifact", "id": "R-2"}),
        ]
        cache.merge_scope(tmp_path, updates)

        archives = cache.get(tmp_path, "task-archive")
        artifacts = cache.get(tmp_path, "repo-artifact")

        assert archives is not None
        assert len(archives) == 2
        archive_ids = {r[1]["task_id"] for r in archives}
        assert archive_ids == {"T-1", "T-2"}
        t2 = next(r for r in archives if r[1]["task_id"] == "T-2")
        assert t2[1].get("updated") is True

        assert artifacts is not None
        assert len(artifacts) == 2

    def test_creates_entry_when_cold(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=60.0)

        updates = [
            (tmp_path / "a.json", {"record_type": "repo-artifact", "id": "R-1"}),
            (tmp_path / "b.json", {"record_type": "repo-artifact", "id": "R-2"}),
        ]
        cache.merge_scope(tmp_path, updates)

        result = cache.get(tmp_path, "repo-artifact")
        assert result is not None
        assert len(result) == 2

    def test_resets_ttl(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=2.0)
        cache.put_scope(tmp_path, {
            "task-archive": [(tmp_path / "a.json", {"record_type": "task-archive"})],
        })

        # Age the entry close to expiry.
        entry = cache._store[str(tmp_path)]
        entry.stored_at -= 1.8

        # Merge resets the TTL.
        cache.merge_scope(tmp_path, [
            (tmp_path / "b.json", {"record_type": "repo-artifact", "id": "R-1"}),
        ])

        # The entry should survive past the original expiry window.
        time.sleep(0.5)
        assert cache.get(tmp_path, "task-archive") is not None
        assert cache.get(tmp_path, "repo-artifact") is not None


# ---------------------------------------------------------------------------
# Write-through integration — ArchiveService + QmdIndexService
# ---------------------------------------------------------------------------


class TestSeedWriteThrough:
    def test_skips_rglob_on_warm_cache(
        self, tmp_path: Path, write_record,
    ) -> None:
        scope_dir = tmp_path / "qmd" / "scope"
        write_record(scope_dir, "existing.json", {
            "record_type": "task-archive",
            "task_id": "T-001",
            "record_id": "rec-T-001",
            "root_task_id": "T-001",
            "repo_name": "my-repo",
        })

        service = TaskArchiveService(workspace_root=tmp_path)
        # Warm the cache with a full scan.
        service.iter_task_archive_records(scope_dir)

        # Merge new records into the warm cache.
        new_record_path = scope_dir / "new.json"
        new_payload = {"record_type": "repo-artifact", "id": "R-1"}
        service.merge_written_records(scope_dir, [(new_record_path, new_payload)])

        # Verify the cache has both old and new records without rglob.
        with patch.object(Path, "rglob", side_effect=AssertionError("rglob called")):
            archives = service.iter_task_archive_records(scope_dir)
            artifacts = service._iter_records_by_type(scope_dir, "repo-artifact")

        assert len(archives) == 1
        assert archives[0][1]["task_id"] == "T-001"
        assert len(artifacts) == 1
        assert artifacts[0][1]["id"] == "R-1"

    def test_includes_new_records_in_indexes(
        self, tmp_path: Path, write_record,
    ) -> None:
        scope_dir = tmp_path / "qmd" / "scope"
        write_record(scope_dir, "t1.json", {
            "record_type": "task-archive",
            "task_id": "T-001",
            "record_id": "rec-T-001",
            "root_task_id": "T-001",
            "repo_name": "my-repo",
        })

        index_svc = QmdIndexService(workspace_root=tmp_path)
        # Warm cache.
        index_svc.archive_service.iter_task_archive_records(scope_dir)

        # Write a new task-archive record to disk and merge it via the
        # encapsulated warm_and_merge_records method.
        t2_record = {
            "record_type": "task-archive",
            "task_id": "T-002",
            "record_id": "rec-T-002",
            "root_task_id": "T-001",
            "parent_task_id": "T-001",
            "repo_name": "my-repo",
        }
        new_path = write_record(scope_dir, "t2.json", t2_record)
        index_svc.warm_and_merge_records(scope_dir, [(new_path, t2_record)])
        # Clear descriptor cache to force rebuild from (now-warm) record cache.
        index_svc.invalidate_descriptor_cache(scope_dir)

        task_index = index_svc.build_global_task_index(scope_dir=scope_dir)
        task_ids = {t["task_id"] for t in task_index["tasks"]}
        assert "T-001" in task_ids
        assert "T-002" in task_ids


# ---------------------------------------------------------------------------
# Parallel preview reads
# ---------------------------------------------------------------------------


class TestParallelPreviewReads:
    def test_produce_same_results_as_sequential(self, tmp_path: Path) -> None:
        from concurrent.futures import ThreadPoolExecutor

        files = []
        for i in range(20):
            p = tmp_path / f"file_{i}.py"
            p.write_text(f"# File {i}\ndef main(): pass\n", encoding="utf-8")
            files.append(p)

        sequential = {str(f): read_preview(f) for f in files}

        parallel: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(read_preview, f): str(f) for f in files}
            for future in futures:
                parallel[futures[future]] = future.result()

        assert parallel == sequential

    def test_partial_read_matches_full_file(self, tmp_path: Path) -> None:
        """read_preview with 4KB head should match full-file for normal files."""
        p = tmp_path / "big.py"
        content = "# Big File Title\n" + ("x = 1\n" * 2000)
        p.write_text(content, encoding="utf-8")

        preview = read_preview(p)
        assert preview == "Big File Title"
