"""Tests for ScopedRecordCache and its integration with TaskArchiveService."""

from __future__ import annotations

import time
from pathlib import Path

from src.backend.mcp.repo_context_mcp.services.record_cache import ScopedRecordCache
from src.backend.mcp.repo_context_mcp.services.archive_service import TaskArchiveService


# ---------------------------------------------------------------------------
# Unit tests — ScopedRecordCache
# ---------------------------------------------------------------------------


class TestScopedRecordCache:
    def test_cache_returns_stored_records_on_hit(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=60.0)
        records = [(tmp_path / "a.json", {"record_type": "task-archive"})]
        cache.put_scope(tmp_path, {"task-archive": records})
        assert cache.get(tmp_path, "task-archive") is records

    def test_cache_miss_returns_none(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache()
        assert cache.get(tmp_path, "task-archive") is None

    def test_cache_ttl_expiry(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=0.05)
        cache.put_scope(tmp_path, {"task-archive": []})
        time.sleep(0.1)
        assert cache.get(tmp_path, "task-archive") is None

    def test_invalidate_clears_specific_scope(self, tmp_path: Path) -> None:
        scope_a = tmp_path / "a"
        scope_b = tmp_path / "b"
        cache = ScopedRecordCache(ttl_seconds=60.0)
        cache.put_scope(scope_a, {"task-archive": [(scope_a / "x.json", {})]})
        cache.put_scope(scope_b, {"task-archive": [(scope_b / "y.json", {})]})

        cache.invalidate(scope_a)

        assert cache.get(scope_a, "task-archive") is None
        assert cache.get(scope_b, "task-archive") is not None

    def test_invalidate_all_clears_entire_cache(self, tmp_path: Path) -> None:
        scope_a = tmp_path / "a"
        scope_b = tmp_path / "b"
        cache = ScopedRecordCache(ttl_seconds=60.0)
        cache.put_scope(scope_a, {"task-archive": []})
        cache.put_scope(scope_b, {"task-archive": []})

        cache.invalidate()

        assert cache.get(scope_a, "task-archive") is None
        assert cache.get(scope_b, "task-archive") is None

    def test_scope_scan_serves_multiple_types(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=60.0)
        archive_records = [(tmp_path / "a.json", {"record_type": "task-archive"})]
        retro_records = [(tmp_path / "b.json", {"record_type": "task-retrospective"})]
        cache.put_scope(tmp_path, {
            "task-archive": archive_records,
            "task-retrospective": retro_records,
        })

        assert cache.get(tmp_path, "task-archive") is archive_records
        assert cache.get(tmp_path, "task-retrospective") is retro_records

    def test_extended_ttl_survives_past_old_window(self, tmp_path: Path) -> None:
        """Default 300s TTL should not expire at the old 30s boundary."""
        cache = ScopedRecordCache()  # default TTL = 300s
        cache.put_scope(tmp_path, {"task-archive": []})
        # Simulate 35 seconds elapsed — well past old 30s TTL.
        entry = cache._store[str(tmp_path)]
        entry.stored_at -= 35.0
        assert cache.get(tmp_path, "task-archive") is not None

    def test_scope_cached_but_type_missing_returns_empty(self, tmp_path: Path) -> None:
        cache = ScopedRecordCache(ttl_seconds=60.0)
        cache.put_scope(tmp_path, {
            "task-archive": [(tmp_path / "a.json", {"record_type": "task-archive"})],
        })

        result = cache.get(tmp_path, "other-type")
        assert result == []
        assert result is not None

    def test_merge_scope_preserves_unmodified_record_types(
        self, tmp_path: Path
    ) -> None:
        """Merging task-archive records must not drop task-retrospective entries."""
        cache = ScopedRecordCache(ttl_seconds=60.0)
        retro_record = (
            tmp_path / "retro.json",
            {"record_type": "task-retrospective", "task_id": "T-1"},
        )
        archive_record = (
            tmp_path / "archive.json",
            {"record_type": "task-archive", "task_id": "T-1"},
        )
        cache.put_scope(tmp_path, {
            "task-archive": [archive_record],
            "task-retrospective": [retro_record],
        })

        # Merge only task-archive records.
        new_archive = (
            tmp_path / "archive2.json",
            {"record_type": "task-archive", "task_id": "T-2"},
        )
        cache.merge_scope(tmp_path, [new_archive])

        # task-retrospective must still be present and unchanged.
        retros = cache.get(tmp_path, "task-retrospective")
        assert retros is not None
        assert len(retros) == 1
        assert retros[0][1]["task_id"] == "T-1"

        # task-archive now has both entries.
        archives = cache.get(tmp_path, "task-archive")
        assert archives is not None
        assert len(archives) == 2


# ---------------------------------------------------------------------------
# Integration test — archive service caching
# ---------------------------------------------------------------------------


class TestArchiveServiceCaching:
    def test_archive_service_caches_repeated_calls(
        self, tmp_path: Path, write_record,
    ) -> None:
        scope_dir = tmp_path / "qmd" / "scope"
        write_record(scope_dir, "T-001.json", {
            "record_type": "task-archive",
            "task_id": "T-001",
            "record_id": "rec-T-001",
        })

        service = TaskArchiveService(workspace_root=tmp_path)
        first = service.iter_task_archive_records(scope_dir)
        second = service.iter_task_archive_records(scope_dir)

        # Same list object — proves the second call hit cache, not disk.
        assert first is second
        assert len(first) == 1
        assert first[0][1]["task_id"] == "T-001"

    def test_scope_level_scan_in_archive_service(
        self, tmp_path: Path, write_record,
    ) -> None:
        scope_dir = tmp_path / "qmd" / "scope"
        write_record(scope_dir, "archive.json", {
            "record_type": "task-archive",
            "task_id": "T-100",
            "record_id": "rec-T-100",
        })
        write_record(scope_dir, "retro.json", {
            "record_type": "task-retrospective",
            "task_id": "T-100",
            "record_id": "retro-T-100",
        })

        service = TaskArchiveService(workspace_root=tmp_path)
        archives = service.iter_task_archive_records(scope_dir)
        retros = service.iter_task_retrospective_records(scope_dir)

        assert len(archives) == 1
        assert archives[0][1]["task_id"] == "T-100"
        assert len(retros) == 1
        assert retros[0][1]["task_id"] == "T-100"

        # Second call for each type should return the same cached object.
        assert service.iter_task_archive_records(scope_dir) is archives
        assert service.iter_task_retrospective_records(scope_dir) is retros
