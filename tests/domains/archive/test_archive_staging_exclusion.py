"""Tests for archive scanner staging-dir exclusion and index-write ordering.

Covers Track E (R4) fixes:
  (a) _iter_records_by_type excludes .staging-* paths.
  (b) Normal records outside staging are still returned (no over-exclusion).
  (c) After canonical promotion, write_archive_indexes writes a tasks.json
      with a canonical archive_path for the task; .staging-* peers never appear.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_SCRIPTS_PYTHON = _REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from src.backend.mcp.repo_context_mcp.services.archive_service import TaskArchiveService  # noqa: E402


def _write_archive_record(path: Path, task_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "qmd-record/v1",
                "record_type": "task-archive",
                "record_id": f"task:org:{task_id}",
                "task_id": task_id,
                "root_task_id": task_id,
                "parent_task_id": "",
                "task_title": f"Task {task_id}",
                "repo_name": "org",
                "child_depth": 0,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


class TestStagingExclusion(unittest.TestCase):
    """_iter_records_by_type must exclude .staging-* directory paths."""

    def test_staging_dir_record_excluded_canonical_returned(self) -> None:
        """Planted .staging-task-b/archive.json is NOT returned;
        archive/tasks/2026/task-a/archive.json IS returned."""
        with tempfile.TemporaryDirectory() as tmp:
            scope_dir = Path(tmp) / "scope"
            year_dir = scope_dir / "archive" / "tasks" / "2026"

            # Canonical record (task-a) — must be returned.
            canonical = year_dir / "task-a" / "archive.json"
            _write_archive_record(canonical, "TASK-A")

            # Staging record (task-b) — must be excluded.
            staging = year_dir / ".staging-task-b" / "archive.json"
            _write_archive_record(staging, "TASK-B")

            service = TaskArchiveService()
            records = service.iter_task_archive_records(scope_dir)

        task_ids = [r[1]["task_id"] for r in records]
        paths = [str(r[0]) for r in records]

        self.assertEqual(task_ids, ["TASK-A"], f"Expected only TASK-A; got {task_ids}")
        self.assertFalse(
            any(".staging-" in p for p in paths),
            f"A .staging- path leaked through: {paths}",
        )

    def test_normal_hidden_dir_not_excluded(self) -> None:
        """Negative over-match guard: a record nested under a normal non-staging
        directory is still returned; only .staging-* components are excluded."""
        with tempfile.TemporaryDirectory() as tmp:
            scope_dir = Path(tmp) / "scope"

            # Canonical record with a normal (non-staging) parent.
            canonical = (
                scope_dir / "archive" / "tasks" / "2026" / "task-c" / "archive.json"
            )
            _write_archive_record(canonical, "TASK-C")

            service = TaskArchiveService()
            records = service.iter_task_archive_records(scope_dir)

        task_ids = [r[1]["task_id"] for r in records]
        self.assertIn("TASK-C", task_ids, "Normal record was incorrectly excluded")


class TestIndexWriteOrdering(unittest.TestCase):
    """After canonical promotion, write_archive_indexes stores a canonical
    archive_path in tasks.json; .staging-* peers never appear there."""

    def _seed_canonical_record(self, scope_dir: Path, task_id: str) -> Path:
        slug = task_id.lower().replace(" ", "-")
        path = scope_dir / "archive" / "tasks" / "2026" / slug / "archive.json"
        _write_archive_record(path, task_id)
        return path

    def test_tasks_index_contains_canonical_path_not_staging(self) -> None:
        """After canonical promotion (record at canonical path, staging gone),
        write_archive_indexes must produce a tasks.json entry whose archive_path
        is the canonical path.  A concurrent .staging-* peer must not appear."""
        from lib.archive.indexes import write_archive_indexes

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            context_pack_dir = tmp_path / "org"
            qmd_scope = "qmd/context-packs/org"
            scope_dir = context_pack_dir / qmd_scope

            # Canonical record already promoted (task-a).
            task_id = "INDEX-A001"
            canonical_path = self._seed_canonical_record(scope_dir, task_id)

            # Peer staging record (task-b still filing) — must NOT appear in index.
            staging_path = (
                scope_dir
                / "archive"
                / "tasks"
                / "2026"
                / ".staging-index-b002"
                / "archive.json"
            )
            _write_archive_record(staging_path, "INDEX-B002")

            payload = {
                "task_id": task_id,
                "root_task_id": task_id,
                "parent_task_id": "",
                "repo_name": "org",
            }
            write_archive_indexes(
                context_pack_dir,
                qmd_scope,
                payload,
                parent_record_path=None,
            )

            tasks_index_path = scope_dir / "indexes" / "tasks.json"
            self.assertTrue(tasks_index_path.exists(), "tasks.json was not written")
            tasks_index = json.loads(tasks_index_path.read_text(encoding="utf-8"))
            tasks = tasks_index.get("tasks", [])

            # The just-archived task must appear.
            found = [t for t in tasks if t.get("task_id") == task_id]
            self.assertTrue(found, f"{task_id} missing from tasks index: {tasks}")

            # Its archive_path must be the canonical path (not staging).
            archive_path = found[0].get("archive_path", "")
            self.assertNotIn(
                ".staging-",
                archive_path,
                f"Staging path leaked into index for {task_id}: {archive_path}",
            )
            # Resolve both sides to handle /tmp -> /private/tmp symlink on macOS.
            self.assertEqual(
                Path(archive_path).resolve(),
                canonical_path.resolve(),
                f"archive_path mismatch: expected {canonical_path}, got {archive_path}",
            )

            # The staging peer must NOT appear in the index at all.
            staging_ids = [t.get("task_id") for t in tasks if ".staging-" in str(t.get("archive_path", ""))]
            self.assertEqual(
                staging_ids,
                [],
                f"Staging paths leaked into tasks index: {staging_ids}",
            )


if __name__ == "__main__":
    unittest.main()
