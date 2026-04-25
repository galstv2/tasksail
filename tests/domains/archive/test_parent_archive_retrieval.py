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


class ParentArchiveRetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = load_repo_context_app()

    def create_archive(self, context_pack_dir: Path, *, scope: str, file_name: str, record: dict[str, object]) -> Path:
        path = context_pack_dir / scope / "archive" / "tasks" / "platform" / "2026" / file_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return path

    def run_carry_forward_summary(
        self,
        workspace_root: Path,
        *,
        context_pack_dir: Path,
        parent_qmd_scope: str,
        parent_qmd_record_id: str | None = None,
        parent_task_id: str | None = None,
    ) -> dict[str, object]:
        with mock.patch("pathlib.Path.cwd", return_value=workspace_root):
            return self.app.build_carry_forward_summary(
                context_pack_dir=str(context_pack_dir),
                parent_qmd_scope=parent_qmd_scope,
                parent_qmd_record_id=parent_qmd_record_id,
                parent_task_id=parent_task_id,
            )

    def test_parent_archive_lookup_by_record_id_returns_carry_forward_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-1000",
                    "record_type": "task-archive",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Queue Automation Hardening",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                    "related_repos": ["platform-tests"],
                    "service_name": "queue-control-plane",
                    "related_services": ["repo-context-mcp"],
                    "workflow_path": "standard",
                    "workflow_status": "completed-with-followup",
                    "test_status": "passed",
                    "qa_status": "issues-found",
                    "task_summary": "Completed the queue automation hardening pass.",
                    "business_goal": "Stabilize queue intake and closeout handling.",
                    "implementation_summary": "Updated queue scripts and reset ordering to avoid stale active items.",
                    "slice_ids": ["slice-06-workflow-artifacts-and-task-generator.md"],
                    "touched_files": ["src/backend/platform/queue/pollDropbox.ts", "src/backend/platform/queue/completePendingItem.ts"],
                    "key_decisions": ["Preserve queue ordering during closeout", "Keep handoff reset explicit"],
                    "constraints": ["Do not bypass pendingitems sequencing"],
                    "known_limitations": ["Terminal follow-up trigger not implemented yet"],
                    "followup_refs": ["CAP-1001"],
                    "provenance_sources": ["AgentWorkSpace/tasks/CAP-1000/handoffs/final-summary.md"],
                },
            )

            summary = self.run_carry_forward_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                parent_qmd_scope=scope,
                parent_qmd_record_id="task:platform:CAP-1000",
            )

            self.assertEqual(summary["parent_task_id"], "CAP-1000")
            self.assertEqual(summary["root_task_id"], "CAP-1000")
            self.assertEqual(summary["parent_qmd_record_id"], "task:platform:CAP-1000")
            self.assertIn("Stabilize queue intake", summary["business_goal"])
            self.assertIn("Preserve queue ordering during closeout", summary["key_decisions"])
            self.assertIn("Do not bypass pendingitems sequencing", summary["inherited_constraints"])
            self.assertIn("CAP-1001", summary["followup_backlog"])
            self.assertIn("Carry-Forward Summary", summary["rendered_summary_markdown"])

    def test_parent_archive_lookup_fails_for_mismatched_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-1000",
                    "record_type": "task-archive",
                    "task_id": "CAP-1000",
                    "task_title": "Queue Automation Hardening",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                },
            )

            with self.assertRaises(ValueError):
                self.run_carry_forward_summary(
                    Path(temp_root),
                    context_pack_dir=context_pack_dir,
                    parent_qmd_scope="qmd/context-packs/other-org",
                    parent_qmd_record_id="task:platform:CAP-1000",
                )

    def test_parent_archive_lookup_by_task_id_supports_contract_shape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-1000",
                    "record_type": "task-archive",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Queue Automation Hardening",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                    "workflow_status": "completed",
                    "summary": "Completed queue hardening work.",
                },
            )

            summary = self.run_carry_forward_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                parent_qmd_scope=scope,
                parent_task_id="CAP-1000",
            )

            required_fields = {
                "summary_type",
                "parent_qmd_scope",
                "parent_qmd_record_id",
                "parent_archive_path",
                "parent_task_id",
                "root_task_id",
                "parent_task_title",
                "task_summary",
                "business_goal",
                "implementation_summary",
                "touched_repos",
                "key_decisions",
                "inherited_constraints",
                "known_limitations",
                "followup_backlog",
                "rendered_summary_markdown",
            }
            self.assertTrue(required_fields.issubset(summary.keys()))
            self.assertEqual(summary["parent_task_id"], "CAP-1000")

    def test_parent_archive_lookup_accepts_absolute_external_context_pack_dir(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root) / "workspace-root"
            workspace_root.mkdir(parents=True, exist_ok=True)
            context_pack_dir = Path(temp_root) / "external-context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-1000",
                    "record_type": "task-archive",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "External Context Pack Parent",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                },
            )

            summary = self.run_carry_forward_summary(
                workspace_root,
                context_pack_dir=context_pack_dir,
                parent_qmd_scope=scope,
                parent_task_id="CAP-1000",
            )

            self.assertEqual(summary["parent_task_id"], "CAP-1000")
            self.assertEqual(summary["parent_qmd_scope"], scope)

    def test_parent_archive_lookup_ignores_missing_retrospective_for_legacy_task(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-1000",
                    "record_type": "task-archive",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Legacy Queue Automation Hardening",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                    "workflow_status": "completed",
                    "summary": "Completed legacy queue hardening work.",
                },
            )
            retrospective_sidecar = (
                context_pack_dir
                / scope
                / "archive/retrospectives/tasksail/2026/cap-1000"
                / "retrospective.md.record.json"
            )
            retrospective_sidecar.parent.mkdir(parents=True, exist_ok=True)
            retrospective_sidecar.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task-retrospective:sample-org:CAP-1000",
                        "record_type": "task-retrospective",
                        "task_id": "CAP-1000",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            summary = self.run_carry_forward_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                parent_qmd_scope=scope,
                parent_task_id="CAP-1000",
            )

            self.assertEqual(summary["parent_task_id"], "CAP-1000")
            self.assertIn(
                "Completed legacy queue hardening work.",
                summary["task_summary"],
            )

    def test_parent_archive_lookup_tolerates_missing_retrospective_history(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-2000.json",
                record={
                    "schema_version": "qmd-record/v1",
                    "record_id": "task:platform:CAP-2000",
                    "record_type": "task-archive",
                    "task_id": "CAP-2000",
                    "root_task_id": "CAP-2000",
                    "task_title": "Archive Without Global Retrospective",
                    "context_pack_id": "sample-org",
                    "qmd_scope": scope,
                    "repo_name": "tasksail",
                    "summary": "Archive lookup should not depend on global retrospective history.",
                },
            )

            summary = self.run_carry_forward_summary(
                Path(temp_root),
                context_pack_dir=context_pack_dir,
                parent_qmd_scope=scope,
                parent_task_id="CAP-2000",
            )

            self.assertEqual(summary["parent_task_id"], "CAP-2000")
            self.assertIn(
                "Archive lookup should not depend on global retrospective history.",
                summary["task_summary"],
            )


if __name__ == "__main__":
    unittest.main()
