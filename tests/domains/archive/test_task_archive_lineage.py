from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_repo_context_app():
    from src.backend.mcp.repo_context_mcp import app
    return app


class TaskArchiveLineageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = load_repo_context_app()

    def create_archive(self, context_pack_dir: Path, *, scope: str, file_name: str, record: dict[str, object]) -> Path:
        path = (
            context_pack_dir
            / scope
            / "archive"
            / "tasks"
            / "platform"
            / "2026"
            / Path(file_name).stem
            / "archive.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return path

    def run_lineage_summary(
        self,
        workspace_root: Path,
        *,
        context_pack_dir: Path,
        qmd_scope: str,
        task_id: str | None = None,
        root_task_id: str | None = None,
    ) -> dict[str, object]:
        with mock.patch("pathlib.Path.cwd", return_value=workspace_root):
            return self.app.build_task_lineage_summary(
                context_pack_dir=str(context_pack_dir),
                qmd_scope=qmd_scope,
                task_id=task_id,
                root_task_id=root_task_id,
            )

    def test_lineage_summary_distinguishes_parent_siblings_and_root_history(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            base = {
                "schema_version": "qmd-record/v1",
                "record_type": "task-archive",
                "context_pack_id": "sample-org",
                "qmd_scope": scope,
                "repo_name": "tasksail",
                "service_name": "repo-context-mcp",
            }
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    **base,
                    "record_id": "task:platform:CAP-1000",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Root Task",
                    "child_depth": 0,
                    "followup_refs": ["CAP-1001", "CAP-1002"],
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1001.json",
                record={
                    **base,
                    "record_id": "task:platform:CAP-1001",
                    "task_id": "CAP-1001",
                    "root_task_id": "CAP-1000",
                    "parent_task_id": "CAP-1000",
                    "parent_qmd_record_id": "task:platform:CAP-1000",
                    "parent_qmd_scope": scope,
                    "followup_reason": "Address operator feedback",
                    "task_title": "Child Task One",
                    "child_depth": 1,
                    "followup_refs": ["CAP-1003"],
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1002.json",
                record={
                    **base,
                    "record_id": "task:platform:CAP-1002",
                    "task_id": "CAP-1002",
                    "root_task_id": "CAP-1000",
                    "parent_task_id": "CAP-1000",
                    "parent_qmd_record_id": "task:platform:CAP-1000",
                    "parent_qmd_scope": scope,
                    "task_title": "Child Task Two",
                    "child_depth": 1,
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1003.json",
                record={
                    **base,
                    "record_id": "task:platform:CAP-1003",
                    "task_id": "CAP-1003",
                    "root_task_id": "CAP-1000",
                    "parent_task_id": "CAP-1001",
                    "parent_qmd_record_id": "task:platform:CAP-1001",
                    "parent_qmd_scope": scope,
                    "task_title": "Grandchild Task",
                    "child_depth": 2,
                },
            )

            summary = self.run_lineage_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                qmd_scope=scope,
                task_id="CAP-1001",
            )

            self.assertEqual(summary["direct_parent"]["task_id"], "CAP-1000")
            self.assertEqual(summary["root_archive"]["task_id"], "CAP-1000")
            self.assertEqual([item["task_id"] for item in summary["direct_children"]], ["CAP-1003"])
            self.assertEqual([item["task_id"] for item in summary["sibling_followups"]], ["CAP-1002"])
            self.assertEqual(
                [item["task_id"] for item in summary["root_lineage_records"]],
                ["CAP-1000", "CAP-1001", "CAP-1002", "CAP-1003"],
            )
            self.assertTrue(
                str(summary["root_archive"]["archive_path"]).endswith(
                    "/archive/tasks/platform/2026/cap-1000/archive.json"
                )
            )
            self.assertIn("Broader Root Lineage", summary["rendered_summary_markdown"])

    def test_root_lineage_lookup_stays_scoped_to_requested_context_pack(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope_a = "qmd/context-packs/sample-org"
            scope_b = "qmd/context-packs/other-org"
            base = {
                "schema_version": "qmd-record/v1",
                "record_type": "task-archive",
                "repo_name": "tasksail",
            }
            self.create_archive(
                context_pack_dir,
                scope=scope_a,
                file_name="cap-1000.json",
                record={
                    **base,
                    "record_id": "task:sample-org:CAP-1000",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope_a,
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Sample Root",
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope_b,
                file_name="cap-1000.json",
                record={
                    **base,
                    "record_id": "task:other-org:CAP-1000",
                    "context_pack_id": "other-org",
                    "qmd_scope": scope_b,
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Other Root",
                },
            )

            summary = self.run_lineage_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                qmd_scope=scope_a,
                root_task_id="CAP-1000",
            )

            self.assertEqual(summary["root_archive"]["record_id"], "task:sample-org:CAP-1000")
            self.assertEqual(len(summary["root_lineage_records"]), 1)

    def test_lineage_lookup_requires_known_archive_in_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"

            with self.assertRaises(ValueError):
                self.run_lineage_summary(
                    Path(temp_root),
                    context_pack_dir=context_pack_dir,
                    qmd_scope=scope,
                    task_id="CAP-4040",
                )


if __name__ == "__main__":
    unittest.main()
