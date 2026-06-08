from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services.archive_service import TaskArchiveService  # noqa: E402


class TaskArchiveServiceTests(unittest.TestCase):
    def create_service_for_temp_context_pack(
        self,
        workspace_root: Path,
    ) -> TaskArchiveService:
        service = TaskArchiveService(workspace_root=workspace_root)

        def resolve_temp_context_pack(value: str) -> Path:
            return Path(value).resolve()

        service._resolve_context_pack_dir = resolve_temp_context_pack
        return service

    def create_archive(
        self,
        context_pack_dir: Path,
        *,
        scope: str,
        file_name: str,
        record: dict[str, object],
    ) -> Path:
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

    def create_retrospective(
        self,
        context_pack_dir: Path,
        *,
        scope: str,
        task_id: str,
        record: dict[str, object],
    ) -> Path:
        path = (
            context_pack_dir
            / scope
            / "archive"
            / "retrospectives"
            / "platform"
            / "2026"
            / task_id.lower()
            / "retrospective.md.record.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return path

    def create_shared_memory(
        self,
        workspace_root: Path,
        record: dict[str, object],
    ) -> Path:
        path = (
            workspace_root
            / (
                "qmd/global/retrospectives/"
                "shared-retrospective-memory.md.record.json"
            )
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        markdown = path.with_name("shared-retrospective-memory.md")
        markdown.write_text(
            "# Shared Retrospective Memory\n",
            encoding="utf-8",
        )
        return path

    def test_iter_task_archive_records_skips_invalid_and_non_archive_payloads(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "context-pack"
            scope_dir = (
                context_pack_dir / "qmd" / "context-packs" / "sample-org"
            )
            archive_dir = scope_dir / "archive" / "tasks" / "platform" / "2026"
            archive_dir.mkdir(parents=True, exist_ok=True)

            (archive_dir / "invalid.json").write_text(
                "{not-json}\n",
                encoding="utf-8",
            )
            (archive_dir / "note.json").write_text(
                json.dumps(
                    {"record_type": "status-note", "task_id": "CAP-0002"},
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            (archive_dir / "list-payload.json").write_text(
                json.dumps([{"record_type": "task-archive"}], indent=2) + "\n",
                encoding="utf-8",
            )
            self.create_archive(
                context_pack_dir,
                scope="qmd/context-packs/sample-org",
                file_name="cap-0001.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:platform:CAP-0001",
                    "task_id": "CAP-0001",
                },
            )
            (
                archive_dir
                / "cap-0001"
                / "planner-focus-snapshot.json"
            ).write_text(
                json.dumps({"version": 1, "task_id": "CAP-0001"}, indent=2) + "\n",
                encoding="utf-8",
            )

            service = TaskArchiveService(workspace_root=Path(temp_root))
            records = service.iter_task_archive_records(scope_dir)

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0][1]["task_id"], "CAP-0001")

    def test_resolve_task_archive_by_task_id_rejects_ambiguous_matches(
        self,
    ) -> None:
        service = TaskArchiveService()
        archive_records = [
            (
                Path("first.json"),
                {
                    "record_id": "task:platform:CAP-1000-a",
                    "task_id": "CAP-1000",
                },
            ),
            (
                Path("second.json"),
                {
                    "record_id": "task:platform:CAP-1000-b",
                    "task_id": "CAP-1000",
                },
            ),
        ]

        with self.assertRaisesRegex(
            ValueError,
            "Ambiguous task archive task_id 'CAP-1000'",
        ):
            service.resolve_task_archive_by_task_id(
                archive_records,
                task_id="CAP-1000",
                failure_label="task archive",
            )

    def test_resolve_task_retrospective_by_task_id(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_retrospective(
                context_pack_dir,
                scope=scope,
                task_id="CAP-1001",
                record={
                    "record_type": "task-retrospective",
                    "record_id": "task-retrospective:sample-org:CAP-1001",
                    "task_id": "CAP-1001",
                    "task_title": "Retrospective Task",
                    "root_task_id": "CAP-1001",
                    "workflow_roles_present": ["Documentation"],
                    "action_items": ["Capture learning earlier."],
                    "agent_contributions": {
                        "Documentation": ["Summarized the learning."]
                    },
                },
            )

            service = self.create_service_for_temp_context_pack(workspace_root)
            summary = service.build_task_retrospective_summary(
                context_pack_dir=str(context_pack_dir),
                qmd_scope=scope,
                task_id="CAP-1001",
            )

            self.assertEqual(
                summary["retrospective_record"]["task_id"],
                "CAP-1001",
            )
            self.assertEqual(
                summary["retrospective_record"]["action_items"],
                ["Capture learning earlier."],
            )
            self.assertIn(
                "Documentation",
                summary["retrospective_record"]["agent_contributions"],
            )

    def test_missing_retrospective_does_not_break_task_archive_resolution(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1001.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-1001",
                    "task_id": "CAP-1001",
                    "root_task_id": "CAP-1001",
                    "task_title": "Archive Task",
                },
            )
            service = TaskArchiveService(workspace_root=workspace_root)
            scope_dir = context_pack_dir / scope

            records = service.iter_task_archive_records(scope_dir)
            resolution = service.resolve_task_archive_by_task_id(
                records,
                task_id="CAP-1001",
                failure_label="task archive",
            )

            self.assertEqual(resolution.record["task_id"], "CAP-1001")
            self.assertEqual(
                str(resolution.path).split("/archive/tasks/", 1)[1],
                "platform/2026/cap-1001/archive.json",
            )

    def test_shared_retrospective_memory_resolution_returns_current_synthesis(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            self.create_shared_memory(
                workspace_root,
                {
                    "record_type": "glopml-retrospective-memory",
                    "record_id": "glopml-retrospective-memory:shared",
                    "source_path": (
                        "qmd/global/retrospectives/"
                        "shared-retrospective-memory.md"
                    ),
                    "synthesized_from_task_ids": ["CAP-1001"],
                    "open_action_items": ["Keep feedback loops short."],
                    "recurring_strengths": ["Clear handoffs."],
                    "recurring_bottlenecks": ["Late retrospective capture."],
                    "validated_improvements": ["Archive meeting outcomes."],
                    "anti_patterns": ["Skipping closeout learning."],
                    "updated_at_utc": "2026-03-07T00:00:00Z",
                },
            )

            service = TaskArchiveService(workspace_root=workspace_root)
            summary = service.load_shared_retrospective_memory()

            self.assertEqual(
                summary["shared_memory_record"]["synthesized_from_task_ids"],
                ["CAP-1001"],
            )
            self.assertIn(
                "Clear handoffs.",
                summary["shared_memory_record"]["recurring_strengths"],
            )

    def test_lineage_lookup_rejects_symlink_scope_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            external_scope = workspace_root / "external-scope"
            external_scope.mkdir(parents=True, exist_ok=True)
            (context_pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
            (context_pack_dir / "linked-scope").symlink_to(
                external_scope,
                target_is_directory=True,
            )

            service = self.create_service_for_temp_context_pack(workspace_root)

            with self.assertRaisesRegex(ValueError, "qmd_scope"):
                service.build_task_lineage_summary(
                    context_pack_dir=str(context_pack_dir),
                    qmd_scope="linked-scope",
                    root_task_id="CAP-1001",
                )

    def test_shared_retrospective_memory_rejects_escaped_global_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            self.create_shared_memory(
                workspace_root,
                {
                    "record_type": "glopml-retrospective-memory",
                    "record_id": "glopml-retrospective-memory:shared",
                    "source_path": (
                        "qmd/global/retrospectives/"
                        "shared-retrospective-memory.md"
                    ),
                },
            )

            service = TaskArchiveService(
                workspace_root=workspace_root,
                global_retrospective_root="../outside",
            )

            with self.assertRaisesRegex(
                ValueError,
                "glopml_retrospective_root",
            ):
                service.load_shared_retrospective_memory()


    # Graceful empty-scope behavior.

    def test_iter_task_archive_records_returns_empty_for_missing_scope(
        self,
    ) -> None:
        """Non-existent scope_dir must return [] instead of raising."""
        with tempfile.TemporaryDirectory() as temp_root:
            missing = Path(temp_root) / "does-not-exist"
            service = TaskArchiveService(workspace_root=Path(temp_root))
            self.assertEqual(service.iter_task_archive_records(missing), [])

    def test_iter_task_retrospective_records_returns_empty_for_missing_scope(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            missing = Path(temp_root) / "does-not-exist"
            service = TaskArchiveService(workspace_root=Path(temp_root))
            self.assertEqual(
                service.iter_task_retrospective_records(missing), []
            )

    def test_iter_global_retrospective_history_returns_empty_for_missing_dir(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            service = TaskArchiveService(workspace_root=Path(temp_root))
            # No history/ directory exists — should return [] not raise
            self.assertEqual(
                service.iter_glopml_retrospective_history_records(
                    Path(temp_root)
                ),
                [],
            )


if __name__ == "__main__":
    unittest.main()
