from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tests.domains.archive._archive_filing_base import TaskArchiveFilingTestBase


class TaskArchiveRetrospectiveTests(TaskArchiveFilingTestBase):
    def test_task_closeout_writes_context_pack_retrospective_archive(
        self,
    ) -> None:
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
            result = json.loads(completed.stdout)
            retrospective_markdown_path = self.retrospective_markdown_path(
                context_pack_dir
            )
            self.assertEqual(
                Path(result["retrospective_markdown_path"]).resolve(),
                retrospective_markdown_path.resolve(),
            )
            self.assertTrue(retrospective_markdown_path.exists())
            markdown = retrospective_markdown_path.read_text(encoding="utf-8")
            self.assertIn("# Retrospective Input", markdown)
            self.assertIn("## Ron's Contribution (QA)", markdown)

    def test_task_closeout_writes_context_pack_retrospective_sidecar(
        self,
    ) -> None:
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
            result = json.loads(completed.stdout)
            retrospective_record_path = self.retrospective_record_path(
                context_pack_dir
            )
            self.assertEqual(
                Path(result["retrospective_record_path"]).resolve(),
                retrospective_record_path.resolve(),
            )
            self.assertTrue(retrospective_record_path.exists())

    def test_retrospective_archive_markdown_preserves_agent_contributions(
        self,
    ) -> None:
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
            markdown = self.retrospective_markdown_path(
                context_pack_dir
            ).read_text(encoding="utf-8")
            self.assertIn(
                "The archive wiring stayed deterministic.",
                markdown,
            )
            self.assertIn(
                "QA state stayed visible and the closeout notes stayed concise.",
                markdown,
            )
            self.assertIn(
                "Do not archive a task without a retrospective.",
                markdown,
            )

    def test_retrospective_sidecar_contains_structured_payload(self) -> None:
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
            payload = json.loads(
                self.retrospective_record_path(context_pack_dir).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(payload["record_type"], "task-retrospective")
            self.assertEqual(payload["artifact_type"], "task-retrospective")
            self.assertEqual(payload["task_id"], "CAP-2001")
            self.assertEqual(
                payload["source_path"],
                "archive/retrospectives/repo/2026/cap-2001/retrospective.md",
            )
            self.assertEqual(
                payload["retrospective_summary"],
                "The task archived cleanly and preserved its learning trail.",
            )
            self.assertEqual(
                payload["what_went_well"],
                ["The archive contract stayed deterministic."],
            )
            self.assertEqual(
                payload["what_could_have_gone_better"],
                ["The retrospective could have been captured earlier."],
            )
            self.assertEqual(
                payload["action_items"],
                ["Capture the retrospective before the archive command."],
            )
            self.assertEqual(
                payload["agent_contributions"]["Software Engineer"],
                ["The archive wiring stayed deterministic."],
            )
            self.assertIn("QA", payload["workflow_roles_present"])
            self.assertEqual(
                payload["reusable_team_learnings"],
                ["Archive legality should derive from repo artifacts."],
            )
            self.assertEqual(
                payload["anti_patterns"],
                ["Do not archive a task without a retrospective."],
            )

    def test_task_closeout_writes_global_retrospective_history_entry(
        self,
    ) -> None:
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
            result = json.loads(completed.stdout)
            history_markdown_path = self.global_history_markdown_path(repo_root)
            history_record_path = self.global_history_record_path(repo_root)
            self.assertEqual(
                Path(result["global_history_markdown_path"]).resolve(),
                history_markdown_path.resolve(),
            )
            self.assertEqual(
                Path(result["global_history_record_path"]).resolve(),
                history_record_path.resolve(),
            )
            self.assertTrue(history_markdown_path.exists())
            self.assertTrue(history_record_path.exists())
            payload = json.loads(history_record_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["record_type"], "global-retrospective-entry")
            self.assertEqual(
                payload["global_retrospective_root"],
                "AgentWorkSpace/qmd/global/retrospectives",
            )

    def test_task_closeout_updates_shared_retrospective_memory(self) -> None:
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
            shared_memory_path = self.shared_memory_markdown_path(repo_root)
            self.assertTrue(shared_memory_path.exists())
            markdown = shared_memory_path.read_text(encoding="utf-8")
            self.assertIn("# Shared Retrospective Memory", markdown)
            self.assertIn("## Contributing Tasks", markdown)
            self.assertIn("CAP-2001: Child Task Closeout", markdown)
            self.assertIn("## Recurring Strengths", markdown)

    def test_task_closeout_rejects_qmd_scope_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            external_scope = temp_path / "external-scope"
            external_scope.mkdir(parents=True, exist_ok=True)
            (context_pack_dir / "linked-scope").symlink_to(
                external_scope,
                target_is_directory=True,
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
                qmd_scope="linked-scope",
            )

            self.assertEqual(completed.returncode, 1)
            self.assertIn("qmd_scope", completed.stderr)

    def test_shared_retrospective_memory_sidecar_tracks_source_task_ids(
        self,
    ) -> None:
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
            payload = json.loads(
                self.shared_memory_record_path(repo_root).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                payload["record_type"],
                "global-retrospective-memory",
            )
            self.assertEqual(payload["synthesized_from_task_ids"], ["CAP-2001"])
            self.assertIn(
                "The archive contract stayed deterministic.",
                payload["recurring_strengths"],
            )
            self.assertIn(
                "Capture the retrospective before the archive command.",
                payload["open_action_items"],
            )

    def test_global_retrospective_paths_do_not_modify_context_pack_archive_paths(
        self,
    ) -> None:
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
            result = json.loads(completed.stdout)
            self.assertEqual(
                Path(result["retrospective_markdown_path"]).resolve(),
                self.retrospective_markdown_path(context_pack_dir).resolve(),
            )
            self.assertEqual(
                Path(result["global_history_markdown_path"]).resolve(),
                self.global_history_markdown_path(repo_root).resolve(),
            )
            self.assertTrue(
                str(self.global_history_markdown_path(repo_root).resolve()).startswith(
                    str(repo_root.resolve())
                )
            )
            self.assertFalse(
                str(self.global_history_markdown_path(repo_root).resolve()).startswith(
                    str(context_pack_dir.resolve())
                )
            )

    def test_archive_filing_fails_when_retrospective_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            blocking_path = self.retrospective_markdown_path(context_pack_dir)
            blocking_path.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn(
                "Archive downstream writes failed. Staging directory cleaned up.",
                completed.stderr,
            )
            # Transactional: archive JSON must NOT exist when downstream writes fail
            archive_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
                / "cap-2001.json"
            )
            self.assertFalse(archive_path.exists())
            # Staging directory must also be cleaned up
            staging_dirs = list(archive_path.parent.glob(".staging-*"))
            self.assertEqual(staging_dirs, [])
            self.assertFalse(
                self.retrospective_record_path(context_pack_dir).exists()
            )

    def test_historical_task_archives_remain_readable_without_retrospectives(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "sample-org"
            legacy_record_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
                / "cap-1999.json"
            )
            legacy_record_path.parent.mkdir(parents=True, exist_ok=True)
            legacy_record_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:sample-org:CAP-1999",
                        "record_type": "task-archive",
                        "task_id": "CAP-1999",
                        "root_task_id": "CAP-1999",
                        "task_title": "Legacy Archive",
                        "context_pack_id": "sample-org",
                        "qmd_scope": "qmd/context-packs/sample-org",
                        "repo_name": "repo",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            service = self.load_index_service(context_pack_dir)
            task_index = service.build_global_task_index(
                scope_dir=context_pack_dir / "qmd/context-packs/sample-org"
            )

            self.assertEqual(task_index["tasks"][0]["task_id"], "CAP-1999")

    def test_archive_refiling_rebuilds_missing_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            _env_refile = os.environ.copy()
            _env_refile["TASKSAIL_TASK_ID"] = "CAP-2001"
            first_run = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
                env=_env_refile,
            )
            self.assertEqual(first_run.returncode, 0, msg=first_run.stderr)
            first_result = json.loads(first_run.stdout)
            record_path = Path(first_result["record_path"])
            first_payload = json.loads(record_path.read_text(encoding="utf-8"))
            first_created_at = first_payload["created_at"]

            for index_path in [
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-2001"
                / "lineage.json",
            ]:
                index_path.unlink()

            second_run = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
                env=_env_refile,
            )
            self.assertEqual(second_run.returncode, 0, msg=second_run.stderr)
            second_result = json.loads(second_run.stdout)

            second_payload = json.loads(
                record_path.read_text(encoding="utf-8")
            )
            self.assertEqual(second_payload["created_at"], first_created_at)
            self.assertEqual(second_result["record_path"], str(record_path))

            self.assertTrue(
                (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/indexes/tasks.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/indexes/lineage.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / (
                        "qmd/context-packs/sample-org/archive/indexes/"
                        "by-repo/repo"
                    )
                    / "tasks.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / (
                        "qmd/context-packs/sample-org/archive/indexes/"
                        "by-root-task"
                    )
                    / "CAP-2001"
                    / "lineage.json"
                ).exists()
            )


if __name__ == "__main__":
    unittest.main()
