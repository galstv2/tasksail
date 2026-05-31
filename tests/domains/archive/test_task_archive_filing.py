from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.domains.archive._archive_filing_base import TaskArchiveFilingTestBase


class TaskArchiveFilingTests(TaskArchiveFilingTestBase):
    def sha256(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

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

    def test_task_archive_copies_handoff_and_slice_artifacts_to_canonical_and_mirror(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            self.write_branch_handoff_snapshot_source(repo_root)
            handoffs_dir = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs"
            steps_dir = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            (handoffs_dir / "intake.md").write_bytes(b"intake bytes\n")
            (handoffs_dir / "code-changes.diff").write_bytes(b"diff --git a/file b/file\n")
            (handoffs_dir / ".publish-in-progress").write_text("transient\n", encoding="utf-8")
            (handoffs_dir / "ignore.lock").write_text("lock\n", encoding="utf-8")
            (handoffs_dir / "ignore.tmp").write_text("tmp\n", encoding="utf-8")
            (handoffs_dir / "nested").mkdir()
            (steps_dir / "draft.tmp").write_text("tmp\n", encoding="utf-8")
            (steps_dir / "notes.txt").write_text("not markdown\n", encoding="utf-8")
            symlink_path = handoffs_dir / "linked-intake.md"
            try:
                symlink_path.symlink_to(handoffs_dir / "intake.md")
            except (OSError, NotImplementedError):
                symlink_path = None

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_dir = self.task_archive_dir(context_pack_dir)
            mirror_dir = self.mirror_task_archive_dir(repo_root)
            for relative_path in (
                "handoffs/intake.md",
                "handoffs/implementation-spec.md",
                "handoffs/code-changes.diff",
                "handoffs/final-summary.md",
                "handoffs/branch-handoffs.json",
                "ImplementationSteps/slice-1.md",
                "ImplementationSteps/slice-2.md",
                "handoff-artifacts-manifest.json",
            ):
                self.assertTrue((archive_dir / relative_path).exists(), relative_path)
                self.assertTrue((mirror_dir / relative_path).exists(), relative_path)
                self.assertEqual(
                    (archive_dir / relative_path).read_bytes(),
                    (mirror_dir / relative_path).read_bytes(),
                )

            self.assertFalse((archive_dir / "ImplementationSteps" / "slice-template.md").exists())
            self.assertFalse((archive_dir / "handoffs" / ".publish-in-progress").exists())
            self.assertFalse((archive_dir / "handoffs" / "ignore.lock").exists())
            self.assertFalse((archive_dir / "handoffs" / "ignore.tmp").exists())
            self.assertFalse((archive_dir / "ImplementationSteps" / "draft.tmp").exists())
            self.assertFalse((archive_dir / "ImplementationSteps" / "notes.txt").exists())
            if symlink_path is not None:
                self.assertFalse((archive_dir / "handoffs" / "linked-intake.md").exists())

            self.assertEqual(
                (handoffs_dir / "intake.md").read_bytes(),
                (archive_dir / "handoffs" / "intake.md").read_bytes(),
            )
            self.assertEqual(
                (steps_dir / "slice-1.md").read_bytes(),
                (archive_dir / "ImplementationSteps" / "slice-1.md").read_bytes(),
            )

            manifest = json.loads(self.task_archive_manifest_path(context_pack_dir).read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema_version"], "handoff-artifacts/v1")
            self.assertEqual(manifest["task_id"], "CAP-2001")
            manifest_files = {entry["archive_relative_path"]: entry for entry in manifest["files"]}
            intake_entry = manifest_files["handoffs/intake.md"]
            self.assertEqual(
                intake_entry["source_relative_path"],
                "AgentWorkSpace/tasks/CAP-2001/handoffs/intake.md",
            )
            self.assertEqual(intake_entry["kind"], "handoff")
            self.assertEqual(intake_entry["size_bytes"], len(b"intake bytes\n"))
            self.assertEqual(intake_entry["sha256"], self.sha256(handoffs_dir / "intake.md"))
            self.assertEqual(
                manifest_files["ImplementationSteps/slice-1.md"]["sha256"],
                self.sha256(steps_dir / "slice-1.md"),
            )
            skipped = {
                (entry["source_relative_path"], entry["reason"])
                for entry in manifest["skipped"]
            }
            self.assertIn(("AgentWorkSpace/tasks/CAP-2001/handoffs/.publish-in-progress", "transient"), skipped)
            self.assertIn(("AgentWorkSpace/tasks/CAP-2001/handoffs/ignore.lock", "transient"), skipped)
            self.assertIn(("AgentWorkSpace/tasks/CAP-2001/handoffs/ignore.tmp", "transient"), skipped)
            self.assertIn(("AgentWorkSpace/tasks/CAP-2001/handoffs/nested", "directory"), skipped)
            self.assertIn(("AgentWorkSpace/tasks/CAP-2001/ImplementationSteps/draft.tmp", "transient"), skipped)
            if symlink_path is not None:
                self.assertIn(("AgentWorkSpace/tasks/CAP-2001/handoffs/linked-intake.md", "non-regular"), skipped)

            payload = json.loads(Path(result["record_path"]).read_text(encoding="utf-8"))
            self.assertEqual(payload["handoff_artifacts"]["manifest_path"], "handoff-artifacts-manifest.json")
            self.assertEqual(payload["handoff_artifacts"]["implementation_step_file_count"], 2)
            self.assertEqual(
                payload["handoff_artifacts"]["handoff_file_count"],
                sum(1 for entry in manifest["files"] if entry["kind"] == "handoff"),
            )
            self.assertEqual(
                payload["handoff_artifacts"]["total_size_bytes"],
                sum(entry["size_bytes"] for entry in manifest["files"]),
            )
            archive_markdown = self.task_archive_markdown_path(context_pack_dir).read_text(encoding="utf-8")
            self.assertIn("## Archived Handoff Artifacts", archive_markdown)
            self.assertIn("- Manifest: handoff-artifacts-manifest.json", archive_markdown)

    def test_task_archive_copies_terminal_events_snapshot_to_canonical_and_mirror(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_branch_handoff_snapshot_source(repo_root)
            terminal_payload = {
                "events": [
                    {
                        "eventId": "visible-event",
                        "source": "runtime.queue",
                        "role": "queue",
                        "severity": "info",
                        "visible": True,
                        "message": "Visible event.",
                        "createdAt": "2026-05-25T00:00:00Z",
                    },
                    {
                        "eventId": "hidden-event",
                        "source": "runtime.queue",
                        "role": "queue",
                        "severity": "info",
                        "visible": False,
                        "message": "Hidden event.",
                        "createdAt": "2026-05-25T00:00:01Z",
                    },
                ]
            }
            runtime_terminal_path = (
                repo_root
                / ".platform-state"
                / "runtime"
                / "tasks"
                / "CAP-2001"
                / "terminal-events.json"
            )
            runtime_terminal_path.parent.mkdir(parents=True, exist_ok=True)
            runtime_terminal_path.write_text(json.dumps(terminal_payload, indent=2) + "\n", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            canonical = self.task_archive_dir(context_pack_dir) / "terminal-events.json"
            mirror = self.mirror_task_archive_dir(repo_root) / "terminal-events.json"
            self.assertEqual(json.loads(canonical.read_text(encoding="utf-8")), terminal_payload)
            self.assertEqual(json.loads(mirror.read_text(encoding="utf-8")), terminal_payload)
            manifest = json.loads(self.task_archive_manifest_path(context_pack_dir).read_text(encoding="utf-8"))
            self.assertNotIn(
                "terminal-events.json",
                [entry["archive_relative_path"] for entry in manifest["files"]],
            )

    def test_task_archive_skips_missing_terminal_events_snapshot_for_legacy_tasks(self) -> None:
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
            self.assertFalse((self.task_archive_dir(context_pack_dir) / "terminal-events.json").exists())
            self.assertFalse((self.mirror_task_archive_dir(repo_root) / "terminal-events.json").exists())

    def test_task_archive_fails_invalid_existing_terminal_events_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.write_branch_handoff_snapshot_source(repo_root)
            runtime_terminal_path = (
                repo_root
                / ".platform-state"
                / "runtime"
                / "tasks"
                / "CAP-2001"
                / "terminal-events.json"
            )
            runtime_terminal_path.parent.mkdir(parents=True, exist_ok=True)
            runtime_terminal_path.write_text('{"events": "not-a-list"}\n', encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("Runtime terminal event snapshot is invalid", completed.stderr)
            self.assertFalse((self.task_archive_dir(context_pack_dir) / "archive.json").exists())

    def test_task_archive_uses_task_scoped_artifacts_not_workspace_level_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self.seed_implementation_steps(repo_root)
            self.write_file(
                repo_root / "AgentWorkSpace" / "handoffs" / "intake.md",
                "stale workspace intake\n",
            )
            self.write_file(
                repo_root / "AgentWorkSpace" / "ImplementationSteps" / "slice-1.md",
                "stale workspace slice\n",
            )
            self.write_file(
                repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "intake.md",
                "active task intake\n",
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            archive_dir = self.task_archive_dir(context_pack_dir)
            self.assertEqual(
                (archive_dir / "handoffs" / "intake.md").read_text(encoding="utf-8"),
                "active task intake\n",
            )
            self.assertIn(
                "Implement the archive artifact copy.",
                (archive_dir / "ImplementationSteps" / "slice-1.md").read_text(encoding="utf-8"),
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


    def _write_task_sidecar(self, repo_root: Path, task_id: str, slice_format: str | None) -> Path:
        """Write a .task.json sidecar under AgentWorkSpace/tasks/<task_id>/."""
        task_dir = repo_root / "AgentWorkSpace" / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        sidecar: dict = {
            "schema_version": 2,
            "taskId": task_id,
            "contextPackBinding": {
                "contextPackPath": None,
                "dataHostDir": None,
                "dataContainerDir": None,
                "repoBindings": [],
            },
            "materialization": {
                "strategy": "copy",
                "cloned": [],
                "skipped": [],
                "composeProjectName": "",
            },
            "frozenAt": "2026-01-01T00:00:00.000Z",
            "finalizedAt": None,
            "state": "active",
        }
        if slice_format is not None:
            sidecar["sliceArtifactFormat"] = slice_format
        path = task_dir / ".task.json"
        path.write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
        return path

    def _run_archive_script_with_task_env(
        self,
        *,
        repo_root: Path,
        context_pack_dir: Path,
        task_env: str | None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        if task_env is None:
            env.pop("TASKSAIL_TASK_ID", None)
        else:
            env["TASKSAIL_TASK_ID"] = task_env
        return subprocess.run(
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
            env=env,
        )

    def test_archive_xml_slices_included_and_template_skipped(self) -> None:
        """XML mode archives slice-N.xml and skips slice-template.xml."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self._write_task_sidecar(repo_root, "CAP-2001", "xml")
            impl_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            impl_steps.mkdir(parents=True, exist_ok=True)
            (impl_steps / "slice-1.xml").write_text(
                '<?xml version="1.0"?><executionSlice id="slice-1"/>', encoding="utf-8"
            )
            (impl_steps / "slice-template.xml").write_text(
                '<?xml version="1.0"?><executionSlice id="slice-N"/>', encoding="utf-8"
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            manifest_path = self.task_archive_manifest_path(context_pack_dir)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            archived_names = [
                Path(f["archive_relative_path"]).name
                for f in manifest["files"]
                if f["kind"] == "implementation-step"
            ]
            self.assertIn("slice-1.xml", archived_names, "slice-1.xml should be archived in xml mode")
            self.assertNotIn("slice-template.xml", archived_names, "slice-template.xml must be skipped")

    def test_archive_slice_format_uses_archived_task_id_not_task_env(self) -> None:
        """Archive slice format is resolved from the task being archived, not ambient env."""
        for task_env in (None, "STALE-TASK"):
            with self.subTest(task_env=task_env):
                with tempfile.TemporaryDirectory() as temp_root:
                    temp_path = Path(temp_root)
                    repo_root = temp_path / "repo"
                    context_pack_dir = temp_path / "sample-org"
                    context_pack_dir.mkdir(parents=True, exist_ok=True)
                    self.base_handoffs(repo_root, child_task=False)
                    self._write_task_sidecar(repo_root, "CAP-2001", "xml")
                    active_root = (
                        repo_root / "AgentWorkSpace"
                        if task_env is None
                        else repo_root / "AgentWorkSpace" / "tasks" / task_env
                    )
                    shutil.copytree(
                        repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs",
                        active_root / "handoffs",
                    )
                    if task_env is not None:
                        self._write_task_sidecar(repo_root, task_env, "markdown")
                    impl_steps = active_root / "ImplementationSteps"
                    impl_steps.mkdir(parents=True, exist_ok=True)
                    (impl_steps / "slice-1.xml").write_text(
                        '<?xml version="1.0"?><executionSlice id="slice-1"/>',
                        encoding="utf-8",
                    )

                    completed = self._run_archive_script_with_task_env(
                        repo_root=repo_root,
                        context_pack_dir=context_pack_dir,
                        task_env=task_env,
                    )

                    self.assertEqual(completed.returncode, 0, msg=completed.stderr)
                    manifest = json.loads(
                        self.task_archive_manifest_path(context_pack_dir).read_text(encoding="utf-8")
                    )
                    archived_names = [
                        Path(f["archive_relative_path"]).name
                        for f in manifest["files"]
                        if f["kind"] == "implementation-step"
                    ]
                    self.assertEqual(archived_names, ["slice-1.xml"])

    def test_archive_xml_mode_fails_when_stray_md_slice_present(self) -> None:
        """XML archive mode fails closed when a wrong-format slice-N.md is present."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self._write_task_sidecar(repo_root, "CAP-2001", "xml")
            impl_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            impl_steps.mkdir(parents=True, exist_ok=True)
            # Wrong-format file: markdown slice in xml mode
            (impl_steps / "slice-1.md").write_text("# Slice 1\nContent.", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertNotEqual(completed.returncode, 0, "archive should fail when wrong-format slice found")
            self.assertIn("wrong-format", completed.stderr)
            self.assertIn("slice-1.md", completed.stderr)

    def test_archive_markdown_mode_fails_when_stray_xml_slice_present(self) -> None:
        """Markdown archive mode fails closed when a wrong-format slice-N.xml is present."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self._write_task_sidecar(repo_root, "CAP-2001", "markdown")
            impl_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            impl_steps.mkdir(parents=True, exist_ok=True)
            # Wrong-format file: xml slice in markdown mode
            (impl_steps / "slice-1.xml").write_text(
                '<?xml version="1.0"?><executionSlice id="slice-1"/>', encoding="utf-8"
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertNotEqual(completed.returncode, 0, "archive should fail when wrong-format slice found")
            self.assertIn("wrong-format", completed.stderr)
            self.assertIn("slice-1.xml", completed.stderr)

    def test_archive_invalid_sidecar_slice_format_fails(self) -> None:
        """Invalid sliceArtifactFormat in .task.json fails archive as corrupt task metadata."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            self._write_task_sidecar(repo_root, "CAP-2001", "invalid-format")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertNotEqual(completed.returncode, 0, "archive should fail on invalid sliceArtifactFormat")
            self.assertIn("invalid", completed.stderr.lower())

    def test_archive_missing_sidecar_slice_format_defaults_to_markdown(self) -> None:
        """Missing sliceArtifactFormat in .task.json archives as markdown (legacy behavior)."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            # Write sidecar without sliceArtifactFormat field
            self._write_task_sidecar(repo_root, "CAP-2001", None)
            impl_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            impl_steps.mkdir(parents=True, exist_ok=True)
            (impl_steps / "slice-1.md").write_text("# Slice 1\nContent.", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            manifest_path = self.task_archive_manifest_path(context_pack_dir)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            archived_names = [
                Path(f["archive_relative_path"]).name
                for f in manifest["files"]
                if f["kind"] == "implementation-step"
            ]
            self.assertIn("slice-1.md", archived_names)

    def test_archive_markdown_behavior_unchanged_without_sidecar(self) -> None:
        """Markdown archive behavior is unchanged when no .task.json sidecar exists."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.base_handoffs(repo_root, child_task=False)
            # No sidecar written — legacy behavior
            impl_steps = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
            impl_steps.mkdir(parents=True, exist_ok=True)
            (impl_steps / "slice-1.md").write_text("# Slice 1\nContent.", encoding="utf-8")
            (impl_steps / "slice-template.md").write_text("# Template", encoding="utf-8")

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            manifest_path = self.task_archive_manifest_path(context_pack_dir)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            archived_names = [
                Path(f["archive_relative_path"]).name
                for f in manifest["files"]
                if f["kind"] == "implementation-step"
            ]
            self.assertIn("slice-1.md", archived_names)
            self.assertNotIn("slice-template.md", archived_names)


if __name__ == "__main__":
    unittest.main()
