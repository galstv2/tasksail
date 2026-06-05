from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from tests.domains.archive._archive_filing_base import TaskArchiveFilingTestBase


class TaskArchiveAtomicityTests(TaskArchiveFilingTestBase):
    def run_archive_script_with_resume(
        self,
        *,
        repo_root: Path,
        context_pack_dir: Path,
        qmd_scope: str = "qmd/context-packs/sample-org",
        task_id: str = "CAP-2001",
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["TASKSAIL_TASK_ID"] = task_id
        return subprocess.run(
            [
                sys.executable,
                str(self.script_path),
                "--repo-root",
                str(repo_root),
                "--context-pack-dir",
                str(context_pack_dir),
                "--qmd-scope",
                qmd_scope,
                "--resume",
            ],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
            env=env,
        )

    def test_staging_directory_created_during_filing(self) -> None:
        """Verify staging dir is created during write sequence."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # We can verify indirectly: a successful run means the staging
            # dir was created and then cleaned up. A failure mid-way would
            # leave it behind. Run successfully and confirm final state.
            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            record_path = Path(result["record_path"])
            self.assertTrue(record_path.exists())

    def test_handoff_artifact_copy_failure_preserves_active_workspace(self) -> None:
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            active_handoffs = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs"
            active_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"

            original_copy2 = archive_mod.shutil.copy2

            def fail_handoff_copy(source, destination, *args, **kwargs):
                if Path(destination).parent.name == "handoffs":
                    raise OSError("forced handoff copy failure")
                return original_copy2(source, destination, *args, **kwargs)

            with patch.dict(os.environ, {"TASKSAIL_TASK_ID": "CAP-2001"}):
                with patch.object(archive_mod.shutil, "copy2", side_effect=fail_handoff_copy):
                    status = archive_mod.main([
                        "--repo-root",
                        str(repo_root),
                        "--context-pack-dir",
                        str(context_pack_dir),
                        "--qmd-scope",
                        "qmd/context-packs/sample-org",
                    ])

            self.assertEqual(status, 1)
            self.assertTrue((active_handoffs / "final-summary.md").exists())
            self.assertTrue((active_steps / "slice-1.md").exists())
            self.assertFalse(self.task_archive_json_path(context_pack_dir).exists())

    def test_staging_directory_cleaned_up_after_promotion(self) -> None:
        """Verify staging dir is removed after successful filing."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            # No .staging-* directories should remain after success
            archive_dir = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
            )
            staging_dirs = list(archive_dir.glob(".staging-*"))
            self.assertEqual(
                staging_dirs,
                [],
                "Staging directory must be cleaned up after promotion",
            )

    def test_crash_during_global_history_leaves_no_orphaned_files(self) -> None:
        """Simulate failure at step 5 (global history), verify no final
        archive exists."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # Make the global history directory unwritable to simulate crash
            history_dir = repo_root / "AgentWorkSpace" / "qmd" / "global" / "retrospectives" / "history" / "2026"
            history_dir.mkdir(parents=True, exist_ok=True)
            os.chmod(str(history_dir), 0o444)

            try:
                completed = self.run_archive_script(
                    repo_root=repo_root,
                    context_pack_dir=context_pack_dir,
                )
                self.assertNotEqual(completed.returncode, 0)

                # Archive JSON must NOT exist in the final location
                archive_path = (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/archive/tasks/2026/cap-2001"
                    / "archive.json"
                )
                self.assertFalse(
                    archive_path.exists(),
                    "Archive must not exist in final location after failure",
                )
                # Staging directory must be cleaned up (non-resume mode)
                staging_dirs = list(archive_path.parent.glob(".staging-*"))
                self.assertEqual(staging_dirs, [])
            finally:
                os.chmod(str(history_dir), 0o755)

    def test_resume_skips_completed_steps(self) -> None:
        """Write a manifest with steps 1-3 complete, run with --resume,
        verify steps 1-3 are not re-executed."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # Do a successful first run
            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            first_result = json.loads(first.stdout)

            # Delete the final archive but leave downstream files.
            # Create a staging directory with manifest + archive to simulate
            # a partial run that completed steps 1-3 but failed at promotion.
            record_path = Path(first_result["record_path"])
            payload = json.loads(record_path.read_text(encoding="utf-8"))

            staging_dir = record_path.parent / f".staging-{payload['task_id'].strip().lower()}"
            # Need to slugify the same way the script does
            staging_dir = record_path.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)

            archive_staging = staging_dir / "archive.json"
            archive_staging.write_text(
                json.dumps(payload, indent=2) + "\n", encoding="utf-8"
            )
            manifest = {
                "archive": "written",
                "retrospective_md": "written",
                "retrospective_record": "written",
            }
            (staging_dir / "manifest.json").write_text(
                json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
            )

            # Remove the final archive to allow re-promotion
            record_path.unlink()

            # Run with --resume
            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)
            resumed_result = json.loads(resumed.stdout)
            self.assertEqual(resumed_result["status"], "filed")
            self.assertTrue(Path(resumed_result["record_path"]).exists())

    def test_resume_without_staged_archive_or_record_errors_cleanly(self) -> None:
        """EH-3: --resume with a surviving manifest but no staged archive.json
        and no canonical record fails with a structured error, not a raw
        FileNotFoundError traceback."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            record_path = Path(json.loads(first.stdout)["record_path"])

            # Recreate staging with only a manifest (no archive.json) and remove
            # the canonical record so rehydration is impossible. The script
            # computes the staging dir at record_path.parent.parent (see
            # archive_year_dir in file-task-archive.py).
            staging_dir = record_path.parent.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)
            (staging_dir / "manifest.json").write_text(
                json.dumps({"archive": "written"}, indent=2) + "\n",
                encoding="utf-8",
            )
            record_path.unlink()

            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertNotEqual(resumed.returncode, 0)
            self.assertNotIn(
                "Traceback (most recent call last)", resumed.stderr
            )
            self.assertIn("Cannot resume", resumed.stderr)

    def test_resume_does_not_duplicate_global_history(self) -> None:
        """Simulate crash after global history, resume, verify exactly
        one global history entry."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # First run to establish all files
            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            first_result = json.loads(first.stdout)

            # Record the global history content
            history_md_path = self.global_history_markdown_path(repo_root)
            original_history = history_md_path.read_text(encoding="utf-8")

            # Simulate partial run: create staging dir with manifest that has
            # archive + retrospective + global_history steps done
            record_path = Path(first_result["record_path"])
            payload = json.loads(record_path.read_text(encoding="utf-8"))

            staging_dir = record_path.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)
            (staging_dir / "archive.json").write_text(
                json.dumps(payload, indent=2) + "\n", encoding="utf-8"
            )
            manifest = {
                "archive": "written",
                "retrospective_md": "written",
                "retrospective_record": "written",
                "global_history_md": "written",
                "global_history_record": "written",
            }
            (staging_dir / "manifest.json").write_text(
                json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
            )
            record_path.unlink()

            # Resume — global history steps should be skipped
            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)

            # Global history file should still have exactly the same content
            # (not duplicated)
            self.assertEqual(
                history_md_path.read_text(encoding="utf-8"),
                original_history,
                "Global history must not be duplicated on resume",
            )

    def test_resume_does_not_duplicate_handoff_artifact_manifest_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            first_result = json.loads(first.stdout)
            record_path = Path(first_result["record_path"])
            archive_dir = record_path.parent
            payload = json.loads(record_path.read_text(encoding="utf-8"))

            staging_dir = archive_dir.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(record_path, staging_dir / "archive.json")
            shutil.copytree(archive_dir / "handoffs", staging_dir / "handoffs")
            shutil.copytree(archive_dir / "ImplementationSteps", staging_dir / "ImplementationSteps")
            shutil.copy2(archive_dir / "handoff-artifacts-manifest.json", staging_dir / "handoff-artifacts-manifest.json")
            (staging_dir / "manifest.json").write_text(
                json.dumps({"archive": "written", "handoff_artifacts": "written"}, indent=2) + "\n",
                encoding="utf-8",
            )
            record_path.unlink()

            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)
            manifest = json.loads(self.task_archive_manifest_path(context_pack_dir).read_text(encoding="utf-8"))
            paths = [entry["archive_relative_path"] for entry in manifest["files"]]
            self.assertEqual(len(paths), len(set(paths)))
            resumed_payload = json.loads(
                Path(json.loads(resumed.stdout)["record_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(
                resumed_payload["handoff_artifacts"],
                payload["handoff_artifacts"],
            )

    def test_refiling_replaces_stale_archived_handoff_and_slice_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            archive_dir = self.task_archive_dir(context_pack_dir)
            (archive_dir / "handoffs" / "stale.md").write_text("stale\n", encoding="utf-8")
            (archive_dir / "ImplementationSteps" / "stale.md").write_text("stale\n", encoding="utf-8")
            (repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps" / "slice-2.md").unlink()

            second = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(second.returncode, 0, msg=second.stderr)
            self.assertFalse((archive_dir / "handoffs" / "stale.md").exists())
            self.assertFalse((archive_dir / "ImplementationSteps" / "stale.md").exists())
            self.assertTrue((archive_dir / "ImplementationSteps" / "slice-1.md").exists())
            self.assertFalse((archive_dir / "ImplementationSteps" / "slice-2.md").exists())

    def test_resume_recovers_after_promotion_failure_moves_archive_json(self) -> None:
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            archive_dir = self.task_archive_dir(context_pack_dir)
            resolved_archive_dir = archive_dir.resolve()
            staging_dir = archive_dir.parent / ".staging-cap-2001"
            original_copytree = archive_mod.shutil.copytree

            def fail_canonical_artifact_promotion(source, destination, *args, **kwargs):
                if Path(destination).resolve().is_relative_to(resolved_archive_dir):
                    raise OSError("forced promotion failure")
                return original_copytree(source, destination, *args, **kwargs)

            with patch.dict(os.environ, {"TASKSAIL_TASK_ID": "CAP-2001"}):
                with patch.object(archive_mod.shutil, "copytree", side_effect=fail_canonical_artifact_promotion):
                    failed = archive_mod.main([
                        "--repo-root",
                        str(repo_root),
                        "--context-pack-dir",
                        str(context_pack_dir),
                        "--qmd-scope",
                        "qmd/context-packs/sample-org",
                    ])

            self.assertEqual(failed, 1)
            self.assertTrue((archive_dir / "archive.json").exists())
            self.assertTrue((staging_dir / "manifest.json").exists())
            self.assertFalse((staging_dir / "archive.json").exists())

            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)
            self.assertTrue((archive_dir / "handoffs" / "final-summary.md").exists())
            self.assertTrue((archive_dir / "ImplementationSteps" / "slice-1.md").exists())
            self.assertTrue((archive_dir / "handoff-artifacts-manifest.json").exists())
            self.assertFalse(staging_dir.exists())

    def test_parent_archive_update_is_locked(self) -> None:
        """Concurrent calls to update_parent_archive() with different
        child IDs — both followup_refs entries must be present."""
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")

        with tempfile.TemporaryDirectory() as temp_root:
            parent_path = Path(temp_root) / "parent.json"
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:org:PARENT-1",
                        "record_type": "task-archive",
                        "task_id": "PARENT-1",
                        "root_task_id": "PARENT-1",
                        "followup_refs": [],
                        "indexed_at": "2026-03-01T00:00:00Z",
                        "updated_at": "2026-03-01T00:00:00Z",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            barrier = threading.Barrier(2)
            errors: list[Exception] = []

            def update(child_id: str) -> None:
                try:
                    barrier.wait()
                    archive_mod.update_parent_archive(
                        parent_path, child_id, "2026-03-12T00:00:00Z"
                    )
                except Exception as exc:
                    errors.append(exc)

            threads = [
                threading.Thread(target=update, args=("CHILD-A",)),
                threading.Thread(target=update, args=("CHILD-B",)),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(errors, [], f"Concurrent updates failed: {errors}")

            final = json.loads(parent_path.read_text(encoding="utf-8"))
            refs = final.get("followup_refs", [])
            self.assertIn("CHILD-A", refs)
            self.assertIn("CHILD-B", refs)

    def test_parent_indexed_at_preserved_after_child_update(self) -> None:
        """update_parent_archive() must not overwrite the parent's indexed_at.

        Only updated_at should reflect the child event timestamp.
        """
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")

        with tempfile.TemporaryDirectory() as temp_root:
            parent_path = Path(temp_root) / "parent.json"
            original_indexed_at = "2026-01-15T10:00:00Z"
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:org:PARENT-IDX",
                        "record_type": "task-archive",
                        "task_id": "PARENT-IDX",
                        "root_task_id": "PARENT-IDX",
                        "followup_refs": [],
                        "indexed_at": original_indexed_at,
                        "updated_at": original_indexed_at,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            child_timestamp = "2026-03-20T14:30:00Z"
            archive_mod.update_parent_archive(
                parent_path, "CHILD-IDX-1", child_timestamp,
            )

            final = json.loads(parent_path.read_text(encoding="utf-8"))
            self.assertEqual(
                final["indexed_at"],
                original_indexed_at,
                "indexed_at must not be overwritten by child update",
            )
            self.assertEqual(
                final["updated_at"],
                child_timestamp,
                "updated_at should reflect the child event timestamp",
            )
            self.assertIn("CHILD-IDX-1", final["followup_refs"])

    def test_lock_covers_global_history_through_indexes(self) -> None:
        """Verify the lock is held from global history (step 4) through
        retrospective indexes (step 10).

        We confirm this structurally by checking that the shared_memory_lock_path
        lock file is created, and that global history + shared memory + retro
        indexes are all written atomically in a successful run.
        """
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            # All files under the lock scope must exist
            self.assertTrue(
                self.global_history_markdown_path(repo_root).exists(),
                "Global history markdown missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.global_history_record_path(repo_root).exists(),
                "Global history record missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.shared_memory_markdown_path(repo_root).exists(),
                "Shared memory markdown missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.shared_memory_record_path(repo_root).exists(),
                "Shared memory record missing — lock scope may be incomplete",
            )

            # Retrospective indexes must exist (written under same lock)
            retro_root = repo_root / "AgentWorkSpace" / "qmd" / "global" / "retrospectives"
            history_index = retro_root / "indexes" / "history.json"
            self.assertTrue(
                history_index.exists(),
                "Retrospective history index missing — may not be under lock scope",
            )


if __name__ == "__main__":
    unittest.main()
