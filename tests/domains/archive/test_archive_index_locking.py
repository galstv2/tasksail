"""Concurrent-writer tests for archive index locking.

Verifies that:
  (a) Two concurrent ``write_archive_indexes`` calls against the same
      context pack both persist — neither loses entries.
  (b) A concurrent ``write_archive_indexes`` + ``patch_task_archive_md``
      pair against the same scope both survive — the patched markdown
      reflects both writers' changes.

Uses ``threading.Thread`` for in-process concurrency (no real sockets,
satisfying tests/conftest.py bind guard).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Ensure lib/ is importable from scripts/python/
_SCRIPTS_PYTHON = _REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))


def _make_payload(task_id: str, repo_name: str = "repo") -> dict:
    return {
        "task_id": task_id,
        "root_task_id": task_id,
        "parent_task_id": "",
        "repo_name": repo_name,
    }


def _seed_archive_record(scope_dir: Path, task_id: str, repo_name: str = "repo") -> Path:
    """Write a minimal archive JSON record so the index scanner finds it."""
    slug = task_id.lower().replace(" ", "-")
    year = "2026"
    record_dir = scope_dir / "archive" / "tasks" / year / slug
    record_dir.mkdir(parents=True, exist_ok=True)
    record_path = record_dir / "archive.json"
    record_path.write_text(
        json.dumps(
            {
                "schema_version": "qmd-record/v1",
                "record_id": f"task:org:{task_id}",
                "record_type": "task-archive",
                "task_id": task_id,
                "root_task_id": task_id,
                "parent_task_id": "",
                "task_title": f"Task {task_id}",
                "context_pack_id": "org",
                "qmd_scope": "qmd/context-packs/org",
                "repo_name": repo_name,
                "child_depth": 0,
                "followup_refs": [],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return record_path


class TestArchiveIndexLocking(unittest.TestCase):
    """Verify per-scope file lock serialises concurrent index writers."""

    def test_two_concurrent_write_archive_indexes_both_persist(self) -> None:
        """(a) Two concurrent write_archive_indexes calls — both task entries
        must appear in the final tasks index."""
        from lib.archive.indexes import write_archive_indexes

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # context_pack_dir is the parent of the qmd scope
            context_pack_dir = tmp_path / "org"
            qmd_scope = "qmd/context-packs/org"
            scope_dir = context_pack_dir / qmd_scope

            task_a = "CONC-A001"
            task_b = "CONC-B001"
            _seed_archive_record(scope_dir, task_a)
            _seed_archive_record(scope_dir, task_b)

            errors: list[Exception] = []

            def call_write(task_id: str) -> None:
                try:
                    write_archive_indexes(
                        context_pack_dir,
                        qmd_scope,
                        _make_payload(task_id),
                        parent_record_path=None,
                    )
                except Exception as exc:
                    errors.append(exc)

            barrier = threading.Barrier(2)

            def run(task_id: str) -> None:
                barrier.wait()
                call_write(task_id)

            threads = [
                threading.Thread(target=run, args=(task_a,)),
                threading.Thread(target=run, args=(task_b,)),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30.0)

            self.assertEqual(errors, [], f"Concurrent write_archive_indexes failed: {errors}")

            tasks_index_path = scope_dir / "indexes" / "tasks.json"
            self.assertTrue(tasks_index_path.exists(), "tasks index not written")
            tasks_index = json.loads(tasks_index_path.read_text(encoding="utf-8"))
            found_ids = {t["task_id"] for t in tasks_index.get("tasks", [])}
            self.assertIn(task_a, found_ids, f"{task_a} missing from tasks index")
            self.assertIn(task_b, found_ids, f"{task_b} missing from tasks index")

    def test_concurrent_write_archive_indexes_and_patch_task_archive_md(
        self,
    ) -> None:
        """(b) Concurrent write_archive_indexes + patch_task_archive_md —
        both writers' distinct sentinel content must appear in the final file."""
        if not os.environ.get("TASKSAIL_AGENT_REGISTRY_PATH", "").strip():
            self.skipTest(
                "TASKSAIL_AGENT_REGISTRY_PATH is not set; skipping archive "
                "reward writer integration that imports reinforcement models."
            )

        from lib.archive.indexes import write_archive_indexes

        from src.backend.mcp.reinforcement.models import SettlementRecord  # noqa: I001
        from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            context_pack_dir = tmp_path / "org"
            qmd_scope = "qmd/context-packs/org"
            scope_dir = context_pack_dir / qmd_scope

            task_id = "CONC-C001"
            record_path = _seed_archive_record(scope_dir, task_id)

            # Create the markdown file that patch_task_archive_md will modify.
            archive_md_path = record_path.parent / "archive.md"
            archive_md_path.write_text(
                f"# Task Archive — {task_id}\n\nSENTINEL_INDEX_WRITER\n",
                encoding="utf-8",
            )

            settlement = SettlementRecord(
                settlement_id="S-CONC-001",
                trigger="streak",
                tasks_included=[task_id],
                per_agent_rewards={"software-engineer": 1000},
                settled_at="2026-01-01T00:00:00Z",
            )

            errors: list[Exception] = []

            def run_write_indexes() -> None:
                try:
                    write_archive_indexes(
                        context_pack_dir,
                        qmd_scope,
                        _make_payload(task_id),
                        parent_record_path=None,
                    )
                except Exception as exc:
                    errors.append(exc)

            def run_patch_md() -> None:
                try:
                    writer = QmdRewardWriter(tmp_path)
                    writer.patch_task_archive_md(archive_md_path, settlement)
                except Exception as exc:
                    errors.append(exc)

            barrier = threading.Barrier(2)

            def run_a() -> None:
                barrier.wait()
                run_write_indexes()

            def run_b() -> None:
                barrier.wait()
                run_patch_md()

            threads = [
                threading.Thread(target=run_a),
                threading.Thread(target=run_b),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30.0)

            self.assertEqual(errors, [], f"Concurrent index+patch failed: {errors}")

            # The markdown must contain both the original sentinel (from
            # index writer pass) and the reward section (from patcher).
            final_md = archive_md_path.read_text(encoding="utf-8")
            self.assertIn(
                "SENTINEL_INDEX_WRITER",
                final_md,
                "Original sentinel content was clobbered by patch_task_archive_md",
            )
            self.assertIn(
                "## Reward Received",
                final_md,
                "Reward section not written by patch_task_archive_md",
            )
            self.assertIn(
                "S-CONC-001",
                final_md,
                "Settlement ID missing from patched archive markdown",
            )

            # tasks index must also exist from the index writer
            tasks_index_path = scope_dir / "indexes" / "tasks.json"
            self.assertTrue(tasks_index_path.exists(), "tasks index not written")


if __name__ == "__main__":
    unittest.main()
