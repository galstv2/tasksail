from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.domains.archive._archive_filing_base import TaskArchiveFilingTestBase


class TaskArchiveFilingTests(TaskArchiveFilingTestBase):
    def write_active_planner_focus_snapshot(self, repo_root: Path) -> dict[str, object]:
        snapshot = {
            "version": 1,
            "contextPackDir": "/contextpacks/sample-org",
            "contextPackId": "sample-org",
            "title": "Parent task",
            "primaryRepoId": "repo",
            "primaryRepoRoot": "/repos/repo",
            "primaryFocusRelativePath": "src/api",
            "primaryFocusTargetKind": "directory",
            "primaryFocusTargets": [],
            "selectedTestTarget": None,
            "supportTargets": [],
            "deepFocusEnabled": True,
            "contextPackBinding": {
                "contextPackDir": "/contextpacks/sample-org",
                "contextPackId": "sample-org",
                "scopeMode": "selected",
                "selectedRepoIds": ["repo"],
                "selectedFocusIds": [],
                "deepFocusEnabled": True,
                "selectedFocusPath": "src/api",
                "selectedFocusTargetKind": "directory",
                "selectedFocusTargets": [],
                "selectedTestTarget": None,
                "selectedSupportTargets": [],
            },
        }
        snapshot_path = (
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001"
            / ".planner-focus-snapshot.json"
        )
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
        return snapshot

    def write_branch_handoff_snapshot_source(self, repo_root: Path) -> None:
        handoffs_path = (
            repo_root
            / "AgentWorkSpace"
            / "tasks"
            / "CAP-2001"
            / "handoffs"
            / "branch-handoffs.json"
        )
        handoffs_path.parent.mkdir(parents=True, exist_ok=True)
        handoffs_path.write_text(
            json.dumps(
                [
                    {
                        "repo_root": str(repo_root),
                        "repo_label": "repo",
                        "branch": "task/CAP-2001",
                        "base_commit_sha": "base",
                        "head_commit_sha": "head",
                        "commits_ahead": 1,
                        "status": "ready-for-operator-review",
                    }
                ],
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def test_task_archive_copies_planner_focus_snapshot_to_canonical_and_mirror(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_branch_handoff_snapshot_source(repo_root)
            snapshot = self.write_active_planner_focus_snapshot(repo_root)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            canonical_snapshot_path = self.task_archive_snapshot_path(
                context_pack_dir
            )
            mirror_snapshot_path = self.mirror_task_archive_snapshot_path(
                repo_root
            )
            self.assertEqual(
                json.loads(canonical_snapshot_path.read_text(encoding="utf-8")),
                snapshot,
            )
            self.assertEqual(
                json.loads(mirror_snapshot_path.read_text(encoding="utf-8")),
                snapshot,
            )

    def test_task_archive_synthesizes_planner_focus_snapshot_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_branch_handoff_snapshot_source(repo_root)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            canonical_snapshot_path = self.task_archive_snapshot_path(
                context_pack_dir
            )
            mirror_snapshot_path = self.mirror_task_archive_snapshot_path(
                repo_root
            )
            snapshot = json.loads(canonical_snapshot_path.read_text(encoding="utf-8"))
            self.assertEqual(
                Path(snapshot["contextPackDir"]).resolve(),
                context_pack_dir.resolve(),
            )
            self.assertEqual(snapshot["contextPackId"], "sample-org")
            self.assertEqual(snapshot["primaryRepoId"], "repo")
            self.assertEqual(Path(snapshot["primaryRepoRoot"]).resolve(), repo_root.resolve())
            self.assertEqual(
                json.loads(mirror_snapshot_path.read_text(encoding="utf-8")),
                snapshot,
            )

    def test_task_archive_synthesizes_planner_focus_snapshot_when_malformed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_branch_handoff_snapshot_source(repo_root)
            snapshot_path = (
                repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001"
                / ".planner-focus-snapshot.json"
            )
            snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            snapshot_path.write_text("{bad-json}\n", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            canonical_snapshot_path = self.task_archive_snapshot_path(
                context_pack_dir
            )
            snapshot = json.loads(canonical_snapshot_path.read_text(encoding="utf-8"))
            self.assertEqual(snapshot["primaryRepoId"], "repo")
            self.assertEqual(Path(snapshot["primaryRepoRoot"]).resolve(), repo_root.resolve())

    def test_task_archive_does_not_read_planner_conversation_history_for_snapshot_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_active_planner_focus_snapshot(repo_root)
            history_path = repo_root / ".platform-state" / "planner-conversation-history.json"
            history_path.parent.mkdir(parents=True, exist_ok=True)
            history_path.write_text("{this would fail if parsed}\n", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

    def test_child_task_archive_filing_preserves_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=True)

            parent_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026/cap-1000"
                / "archive.json"
            )
            parent_path.parent.mkdir(parents=True, exist_ok=True)
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:sample-org:CAP-1000",
                        "record_type": "task-archive",
                        "task_id": "CAP-1000",
                        "root_task_id": "CAP-1000",
                        "task_title": "Parent Task",
                        "context_pack_id": "sample-org",
                        "qmd_scope": "qmd/context-packs/sample-org",
                        "repo_name": "repo",
                        "child_depth": 0,
                        "followup_refs": [],
                    },
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            _env_child = os.environ.copy()
            _env_child["TASKSAIL_TASK_ID"] = "CAP-2001"
            completed = subprocess.run(
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
                env=_env_child,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_path = Path(result["record_path"])
            archive_payload = json.loads(
                archive_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                archive_path.resolve(),
                self.task_archive_json_path(context_pack_dir).resolve(),
            )
            self.assertEqual(
                Path(result["record_md_path"]).resolve(),
                self.task_archive_markdown_path(context_pack_dir).resolve(),
            )
            self.assertEqual(archive_payload["parent_task_id"], "CAP-1000")
            self.assertEqual(archive_payload["root_task_id"], "CAP-1000")
            self.assertEqual(
                archive_payload["parent_qmd_record_id"],
                "task:sample-org:CAP-1000",
            )
            self.assertEqual(archive_payload["child_depth"], 1)
            self.assertEqual(archive_payload["followup_refs"], ["CAP-2002"])
            self.assertIn(
                "Inherited queue-ordering constraint",
                archive_payload["inherited_parent_context"],
            )
            self.assertIn(
                "Clarified closeout lineage",
                archive_payload["child_task_outcome_delta"],
            )

            tasks_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json"
            )
            lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json"
            )
            repo_task_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json"
            )
            root_lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-1000"
                / "lineage.json"
            )
            parent_children_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-parent-task"
                / "CAP-1000"
                / "children.json"
            )

            self.assertTrue(tasks_index_path.exists())
            self.assertTrue(lineage_index_path.exists())
            self.assertTrue(repo_task_index_path.exists())
            self.assertTrue(root_lineage_index_path.exists())
            self.assertTrue(parent_children_index_path.exists())

            tasks_index = json.loads(
                tasks_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(tasks_index["tasks"][1]["task_id"], "CAP-2001")

            lineage_index = json.loads(
                lineage_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                lineage_index["lineage_roots"][0]["root_task_id"],
                "CAP-1000",
            )

            parent_children_index = json.loads(
                parent_children_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                parent_children_index["children"][0]["task_id"],
                "CAP-2001",
            )

            updated_parent = json.loads(
                parent_path.read_text(encoding="utf-8")
            )
            self.assertIn("CAP-2001", updated_parent["followup_refs"])

    def test_standard_task_archive_filing_keeps_lineage_blank(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            _env_std = os.environ.copy()
            _env_std["TASKSAIL_TASK_ID"] = "CAP-2001"
            completed = subprocess.run(
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
                env=_env_std,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_payload = json.loads(
                Path(result["record_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(
                Path(result["record_path"]).resolve(),
                self.task_archive_json_path(context_pack_dir).resolve(),
            )
            self.assertEqual(
                Path(result["record_md_path"]).resolve(),
                self.task_archive_markdown_path(context_pack_dir).resolve(),
            )
            self.assertEqual(archive_payload["parent_task_id"], "")
            self.assertEqual(archive_payload["root_task_id"], "CAP-2001")
            self.assertEqual(archive_payload["child_depth"], 0)

            tasks_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json"
            )
            lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json"
            )
            repo_task_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json"
            )
            root_lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-2001"
                / "lineage.json"
            )
            parent_children_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-parent-task"
                / "CAP-2001"
                / "children.json"
            )

            self.assertTrue(tasks_index_path.exists())
            self.assertTrue(lineage_index_path.exists())
            self.assertTrue(repo_task_index_path.exists())
            self.assertTrue(root_lineage_index_path.exists())
            self.assertFalse(parent_children_index_path.exists())

            self.assertIn("tasks_index", result["index_outputs"])
            self.assertIn("lineage_index", result["index_outputs"])
            self.assertIn("repo_task_index", result["index_outputs"])
            self.assertIn("root_lineage_index", result["index_outputs"])

    def test_archive_payload_includes_difficulty_level_and_tag(self) -> None:
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
            archive_payload = json.loads(
                Path(result["record_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(archive_payload["difficulty_level"], "Medium")
            self.assertIn("difficulty:medium", archive_payload["tags"])

    def test_branch_handoffs_are_written_to_canonical_archive_and_agent_mirror(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            handoffs = [
                {
                    "repo_root": "/repos/platform",
                    "repo_label": "platform",
                    "branch": "task/CAP-2001",
                    "base_commit_sha": "abc123",
                    "head_commit_sha": "def456",
                    "commits_ahead": 2,
                    "status": "ready-for-operator-review",
                }
            ]
            handoffs_path = (
                repo_root
                / "AgentWorkSpace"
                / "tasks"
                / "CAP-2001"
                / "handoffs"
                / "branch-handoffs.json"
            )
            handoffs_path.write_text(
                json.dumps(handoffs, indent=2) + "\n",
                encoding="utf-8",
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)

            canonical_json_path = Path(result["record_path"])
            canonical_md_path = self.task_archive_markdown_path(context_pack_dir)
            mirror_json_path = self.mirror_task_archive_json_path(repo_root)
            mirror_md_path = self.mirror_task_archive_markdown_path(repo_root)
            self.assertEqual(canonical_json_path.name, "archive.json")
            self.assertEqual(canonical_json_path.parent.name, "cap-2001")
            self.assertEqual(mirror_json_path.name, "archive.json")
            self.assertEqual(mirror_json_path.parent.name, "cap-2001")

            canonical_payload = json.loads(
                canonical_json_path.read_text(encoding="utf-8")
            )
            mirror_payload = json.loads(mirror_json_path.read_text(encoding="utf-8"))
            canonical_markdown = canonical_md_path.read_text(encoding="utf-8")
            mirror_markdown = mirror_md_path.read_text(encoding="utf-8")

            self.assertEqual(canonical_payload["branch_handoffs"], handoffs)
            self.assertEqual(mirror_payload["branch_handoffs"], handoffs)
            self.assertIn("Source Branches for Operator Review", canonical_markdown)
            self.assertIn("Source Branches for Operator Review", mirror_markdown)
            self.assertIn("task/CAP-2001", canonical_markdown)
            self.assertIn("task/CAP-2001", mirror_markdown)

    def test_task_archive_strips_template_comments_from_payload_and_markdown(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            self.write_file(
                repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "professional-task.md",
                """
                # Professional Task

                ## Task Metadata

                - Task ID: CAP-2001
                - Task Title: Child Task Closeout
                - Initialized At (UTC): 2026-03-07T00:00:00Z
                - Active Branch: main
                - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

                ## Task Lineage

                - Task Kind: standard
                - Parent Task ID:
                - Root Task ID: CAP-2001
                - Parent QMD Record ID:
                - Parent QMD Scope:
                - Follow-Up Reason:

                ## Raw Request

                Refine the prior implementation. <!-- do not archive -->

                ## Business Goal

                <!-- (1-3 sentences) template only -->
                Deliver a clean archive.
                """,
            )
            self.write_file(
                repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "final-summary.md",
                """
                # Final Summary

                ## Task Metadata

                - Task ID: CAP-2001
                - Task Title: Child Task Closeout
                - Initialized At (UTC): 2026-03-07T00:00:00Z
                - Active Branch: main
                - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

                ## Task Lineage

                - Task Kind: standard
                - Parent Task ID:
                - Root Task ID: CAP-2001
                - Parent QMD Record ID:
                - Parent QMD Scope:
                - Follow-Up Reason:

                ## Closeout Owner Agent ID

                qa

                ## Completed Work

                Completed archive sanitization. <!-- internal note -->

                ## Key Design Decisions

                - Strip template comments before archival. <!-- not for archive -->

                ## Known Limitations

                - None.

                ## Test Result Summary

                Passed archive verification. <!-- hidden -->

                ## Rollout or Operational Notes

                None.

                ## Follow-Up Backlog

                - None.

                ## Difficulty Assessment

                - Difficulty Level: Medium <!-- internal -->
                """,
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            record_path = Path(result["record_path"])
            markdown_path = self.task_archive_markdown_path(context_pack_dir)
            archive_payload = json.loads(record_path.read_text(encoding="utf-8"))
            archive_markdown = markdown_path.read_text(encoding="utf-8")

            self.assertEqual(archive_payload["business_goal"], "Deliver a clean archive.")
            self.assertEqual(
                archive_payload["completed_work_summary"],
                "Completed archive sanitization.",
            )
            self.assertEqual(archive_payload["difficulty_level"], "Medium")
            self.assertNotIn("<!--", json.dumps(archive_payload))
            self.assertNotIn("<!--", archive_markdown)


if __name__ == "__main__":
    unittest.main()
