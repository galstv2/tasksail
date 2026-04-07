from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services.qmd_index_service import QmdIndexService  # noqa: E402


class QmdIndexServiceTests(unittest.TestCase):
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
            / file_name
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return path

    def create_global_history_record(
        self,
        workspace_root: Path,
        *,
        file_name: str,
        record: dict[str, object],
    ) -> Path:
        path = (
            workspace_root
            / "qmd/global/retrospectives/history/2026"
            / file_name
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return path

    def test_build_root_and_parent_lineage_indexes_for_multi_child_chain(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-1000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-1000",
                    "task_id": "CAP-1000",
                    "root_task_id": "CAP-1000",
                    "task_title": "Root Task",
                    "repo_name": "platform",
                    "followup_refs": ["CAP-2000", "CAP-3000"],
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-2000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-2000",
                    "task_id": "CAP-2000",
                    "root_task_id": "CAP-1000",
                    "parent_task_id": "CAP-1000",
                    "task_title": "Child A",
                    "repo_name": "platform",
                    "child_depth": 1,
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-3000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-3000",
                    "task_id": "CAP-3000",
                    "root_task_id": "CAP-1000",
                    "parent_task_id": "CAP-2000",
                    "task_title": "Grandchild",
                    "repo_name": "platform",
                    "child_depth": 2,
                },
            )

            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            root_index = service.build_root_lineage_index(
                scope_dir=scope_dir,
                root_task_id="CAP-1000",
            )
            parent_index = service.build_parent_children_index(
                scope_dir=scope_dir,
                parent_task_id="CAP-1000",
            )
            top_level = service.build_top_level_lineage_index(
                scope_dir=scope_dir
            )

            self.assertEqual(root_index["root_task_id"], "CAP-1000")
            self.assertEqual(
                [item["task_id"] for item in root_index["direct_children"]],
                ["CAP-2000"],
            )
            self.assertEqual(
                [item["task_id"] for item in root_index["descendants"]],
                ["CAP-3000"],
            )
            self.assertEqual(
                root_index["open_followup_refs"],
                ["CAP-2000", "CAP-3000"],
            )
            self.assertEqual(
                parent_index["parent_record_id"],
                "task:sample-org:CAP-1000",
            )
            self.assertEqual(
                [item["task_id"] for item in parent_index["children"]],
                ["CAP-2000"],
            )
            self.assertEqual(
                top_level["lineage_roots"][0]["root_task_id"],
                "CAP-1000",
            )

    def test_repository_and_task_indexes_anchor_to_canonical_records(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            archive_path = self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-4000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-4000",
                    "task_id": "CAP-4000",
                    "task_title": "Repo Index Task",
                    "repo_name": "billing-api",
                    "root_task_id": "CAP-4000",
                    "workflow_status": "completed",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            repo_index = service.build_repository_index(
                scope_dir=scope_dir,
                repositories=[
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "system_layer": "backend",
                        "languages": ["python"],
                        "bounded_context": "billing",
                        "status": "seeded",
                        "existing_roots": ["/tmp/billing-api"],
                    }
                ],
            )
            task_index = service.build_global_task_index(scope_dir=scope_dir)
            repo_task_index = service.build_repo_task_index(
                scope_dir=scope_dir,
                repo_name="billing-api",
            )

            self.assertEqual(
                repo_index["repositories"][0]["archive_index_path"],
                (
                    "qmd/context-packs/sample-org/archive/indexes/"
                    "by-repo/billing-api/tasks.json"
                ),
            )
            self.assertEqual(
                task_index["tasks"][0]["record_id"],
                "task:sample-org:CAP-4000",
            )
            self.assertEqual(
                Path(task_index["tasks"][0]["archive_path"]).resolve(),
                archive_path.resolve(),
            )
            self.assertEqual(
                repo_task_index["tasks"][0]["record_id"],
                "task:sample-org:CAP-4000",
            )

    def test_historical_records_without_optional_fields_still_build_indexes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-5000.json",
                record={
                    "record_type": "task-archive",
                    "task_id": "CAP-5000",
                    "title": "Legacy Task",
                    "repo_name": "legacy-repo",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            task_index = service.build_global_task_index(scope_dir=scope_dir)
            root_index = service.build_root_lineage_index(
                scope_dir=scope_dir,
                root_task_id="CAP-5000",
            )

            self.assertEqual(
                task_index["tasks"][0]["root_task_id"],
                "CAP-5000",
            )
            self.assertEqual(task_index["tasks"][0]["record_id"], "")
            self.assertEqual(root_index["latest_task_id"], "CAP-5000")

    def test_build_retrospective_history_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            self.create_global_history_record(
                workspace_root,
                file_name="cap-1000.md.record.json",
                record={
                    "record_type": "glopml-retrospective-entry",
                    "record_id": "global-retrospective-entry:CAP-1000",
                    "task_id": "CAP-1000",
                    "task_title": "First Task",
                    "retrospective_summary": "First summary.",
                    "indexed_at": "2026-03-07T00:00:00Z",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T01:00:00Z",
            )

            index = service.build_retrospective_history_index(
                repo_root=workspace_root,
            )

            self.assertEqual(
                index["index_type"],
                "retrospective-history-index",
            )
            self.assertEqual(index["retrospectives"][0]["task_id"], "CAP-1000")

    def test_build_retrospective_action_items_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            self.create_global_history_record(
                workspace_root,
                file_name="cap-1000.md.record.json",
                record={
                    "record_type": "glopml-retrospective-entry",
                    "task_id": "CAP-1000",
                    "action_items": ["Shorten feedback loops."],
                },
            )
            self.create_global_history_record(
                workspace_root,
                file_name="cap-1001.md.record.json",
                record={
                    "record_type": "glopml-retrospective-entry",
                    "task_id": "CAP-1001",
                    "action_items": [
                        "Shorten feedback loops.",
                        "Write clearer closeouts.",
                    ],
                },
            )
            service = QmdIndexService(workspace_root=workspace_root)

            index = service.build_retrospective_action_items_index(
                repo_root=workspace_root,
            )

            self.assertEqual(
                index["action_items"][0]["action_item"],
                "Shorten feedback loops.",
            )
            self.assertEqual(index["action_items"][0]["count"], 2)

    def test_build_retrospective_theme_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            self.create_global_history_record(
                workspace_root,
                file_name="cap-1000.md.record.json",
                record={
                    "record_type": "glopml-retrospective-entry",
                    "task_id": "CAP-1000",
                    "what_went_well": ["Clear handoffs."],
                    "what_could_have_gone_better": ["Late QA."],
                    "reusable_team_learnings": ["Archive learnings."],
                    "anti_patterns": ["Skipping retrospective."],
                },
            )
            service = QmdIndexService(workspace_root=workspace_root)

            index = service.build_retrospective_theme_index(
                repo_root=workspace_root,
            )

            categories = {
                (item["category"], item["theme"])
                for item in index["themes"]
            }
            self.assertIn(("strength", "Clear handoffs."), categories)
            self.assertIn(("bottleneck", "Late QA."), categories)
            self.assertIn(("learning", "Archive learnings."), categories)
            self.assertIn(
                ("anti-pattern", "Skipping retrospective."),
                categories,
            )

    def test_retrospective_indexes_exclude_task_archive_record_types(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            self.create_global_history_record(
                workspace_root,
                file_name="cap-1000.md.record.json",
                record={
                    "record_type": "glopml-retrospective-entry",
                    "task_id": "CAP-1000",
                    "action_items": ["Keep the loop short."],
                },
            )
            self.create_global_history_record(
                workspace_root,
                file_name="cap-9999.json",
                record={
                    "record_type": "task-archive",
                    "task_id": "CAP-9999",
                    "action_items": ["Should not appear."],
                },
            )
            service = QmdIndexService(workspace_root=workspace_root)

            action_index = service.build_retrospective_action_items_index(
                repo_root=workspace_root,
            )

            self.assertEqual(
                [
                    item["action_item"]
                    for item in action_index["action_items"]
                ],
                ["Keep the loop short."],
            )


    def test_task_descriptor_cache_returns_consistent_results(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-6000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-6000",
                    "task_id": "CAP-6000",
                    "task_title": "Cached Task",
                    "repo_name": "platform",
                    "root_task_id": "CAP-6000",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            first = service.build_global_task_index(scope_dir=scope_dir)
            second = service.build_global_task_index(scope_dir=scope_dir)

            self.assertEqual(first["tasks"], second["tasks"])

    def test_task_descriptor_cache_returns_same_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-7000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-7000",
                    "task_id": "CAP-7000",
                    "task_title": "Task A",
                    "repo_name": "alpha",
                    "root_task_id": "CAP-7000",
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-7001.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-7001",
                    "task_id": "CAP-7001",
                    "task_title": "Task B",
                    "repo_name": "beta",
                    "root_task_id": "CAP-7001",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            first = service.task_descriptors(scope_dir)
            second = service.task_descriptors(scope_dir)
            self.assertIs(first, second)

    def test_build_global_task_index_does_not_mutate_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-7000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-7000",
                    "task_id": "CAP-7000",
                    "task_title": "Task A",
                    "repo_name": "beta",
                    "root_task_id": "CAP-7000",
                },
            )
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-7001.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-7001",
                    "task_id": "CAP-7001",
                    "task_title": "Task B",
                    "repo_name": "alpha",
                    "root_task_id": "CAP-7001",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            before = service.task_descriptors(scope_dir)
            original_order = [item["task_id"] for item in before]
            service.build_global_task_index(scope_dir=scope_dir)
            after_order = [item["task_id"] for item in before]
            self.assertEqual(original_order, after_order)

    def test_invalidate_descriptor_cache_preserves_record_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-8500.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-8500",
                    "task_id": "CAP-8500",
                    "task_title": "Preserved Cache",
                    "repo_name": "platform",
                    "root_task_id": "CAP-8500",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            # Populate both record cache and descriptor cache.
            records_before = (
                service.archive_service.iter_task_archive_records(scope_dir)
            )

            # Descriptor-only invalidation should NOT clear the record cache.
            service.invalidate_descriptor_cache(scope_dir)

            records_after = (
                service.archive_service.iter_task_archive_records(scope_dir)
            )
            # Same object identity — proves records were served from cache.
            self.assertIs(records_before, records_after)

    def test_invalidate_archive_cache_clears_descriptor_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-8000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-8000",
                    "task_id": "CAP-8000",
                    "task_title": "Original",
                    "repo_name": "platform",
                    "root_task_id": "CAP-8000",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            before = service.build_global_task_index(scope_dir=scope_dir)
            self.assertEqual(len(before["tasks"]), 1)

            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-8001.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-8001",
                    "task_id": "CAP-8001",
                    "task_title": "New Record",
                    "repo_name": "platform",
                    "root_task_id": "CAP-8001",
                },
            )
            service.invalidate_archive_cache(scope_dir)

            after = service.build_global_task_index(scope_dir=scope_dir)
            self.assertEqual(len(after["tasks"]), 2)


    def test_invalidation_propagates_to_lineage_service(self) -> None:
        from src.backend.mcp.repo_context_mcp.services.lineage_service import (
            LineageService,
        )

        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-9000.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-9000",
                    "task_id": "CAP-9000",
                    "task_title": "Propagation Test",
                    "repo_name": "platform",
                    "root_task_id": "CAP-9000",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            lineage_svc = LineageService(
                workspace_root=workspace_root,
                qmd_index_service=service,
            )
            service.set_lineage_service(lineage_svc)

            # Populate lineage index cache.
            lineage_svc._lineage_index(scope_dir)
            self.assertIn(str(scope_dir), lineage_svc._index_cache)

            # Invalidate via QmdIndexService — should cascade.
            service.invalidate_descriptor_cache(scope_dir)
            self.assertNotIn(str(scope_dir), lineage_svc._index_cache)

    def test_invalidation_propagates_to_lineage_service_global(self) -> None:
        from src.backend.mcp.repo_context_mcp.services.lineage_service import (
            LineageService,
        )

        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "context-pack"
            scope = "qmd/context-packs/sample-org"
            self.create_archive(
                context_pack_dir,
                scope=scope,
                file_name="cap-9100.json",
                record={
                    "record_type": "task-archive",
                    "record_id": "task:sample-org:CAP-9100",
                    "task_id": "CAP-9100",
                    "task_title": "Global Propagation Test",
                    "repo_name": "platform",
                    "root_task_id": "CAP-9100",
                },
            )
            service = QmdIndexService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-07T00:00:00Z",
            )
            scope_dir = context_pack_dir / scope

            lineage_svc = LineageService(
                workspace_root=workspace_root,
                qmd_index_service=service,
            )
            service.set_lineage_service(lineage_svc)

            lineage_svc._lineage_index(scope_dir)
            self.assertTrue(len(lineage_svc._index_cache) > 0)

            # Global invalidation — no scope_dir arg.
            service.invalidate_descriptor_cache()
            self.assertEqual(len(lineage_svc._index_cache), 0)


if __name__ == "__main__":
    unittest.main()
