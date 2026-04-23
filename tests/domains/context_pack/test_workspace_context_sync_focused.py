from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from src.backend.mcp.workspace_context_sync_service import (
    WorkspaceContextSyncService,
)
from tests.domains.context_pack.test_workspace_context_sync_service import (
    WorkspaceContextSyncServiceTests,
)


class WorkspaceContextSyncFocusedTests(WorkspaceContextSyncServiceTests):
    """Focused-mode, monolith, and health-inspection tests for WorkspaceContextSyncService."""

    def test_focused_mode_defaults_to_one_primary_repo_for_distributed_estate(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            repo_two = estate_root / "services" / "orders-web"
            self.create_git_repo(repo_one)
            self.create_git_repo(repo_two)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one, repo_two],
            )
            manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
            manifest_payload = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            manifest_payload["primary_working_repo_ids"] = [
                "services-orders-web"
            ]
            manifest_path.write_text(
                json.dumps(manifest_payload, indent=2) + "\n",
                encoding="utf-8",
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
            )
            preview = service.preview_sync(context_pack_dir)

            self.assertEqual(preview["scope_mode"], "focused")
            self.assertEqual(
                preview["selected_repo_ids"],
                ["services-orders-web"],
            )
            self.assertEqual(
                preview["folders_to_add"],
                [
                    str(repo_two.resolve()),
                ],
            )

    def test_focused_mode_allows_multiple_selected_repo_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            repo_two = estate_root / "services" / "orders-web"
            self.create_git_repo(repo_one)
            self.create_git_repo(repo_two)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one, repo_two],
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
            )
            preview = service.preview_sync(
                context_pack_dir,
                selected_repo_ids=[
                    "services-orders-api",
                    "services-orders-web",
                ],
                scope_mode="focused",
            )

            self.assertEqual(
                preview["selected_repo_ids"],
                ["services-orders-api", "services-orders-web"],
            )
            self.assertEqual(
                preview["folders_to_add"],
                [
                    str(repo_one.resolve()),
                    str(repo_two.resolve()),
                ],
            )

    def test_monolith_focused_mode_keeps_repo_attached_and_selects_focus_id(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            monolith_root = workspace_root / "mono-repo"
            context_pack_dir = workspace_root / "contexts" / "mono-pack"
            self.create_git_repo(monolith_root)
            (monolith_root / "services" / "billing").mkdir(parents=True)
            (monolith_root / "services" / "identity").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_monolith_manifest(
                discovery_root=monolith_root,
                context_pack_dir=context_pack_dir,
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            preview = service.preview_sync(context_pack_dir)

            self.assertEqual(preview["scope_mode"], "focused")
            self.assertEqual(preview["selected_repo_ids"], [])
            self.assertEqual(
                preview["selected_focus_ids"],
                ["services-billing"],
            )
            self.assertEqual(
                preview["folders_to_add"],
                [
                    str((monolith_root / "services" / "billing").resolve()),
                ],
            )

    def test_monolith_selected_focus_id_is_persisted_without_folder_changes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            monolith_root = workspace_root / "mono-repo"
            context_pack_dir = workspace_root / "contexts" / "mono-pack"
            self.create_git_repo(monolith_root)
            (monolith_root / "services" / "billing").mkdir(parents=True)
            (monolith_root / "services" / "identity").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_monolith_manifest(
                discovery_root=monolith_root,
                context_pack_dir=context_pack_dir,
            )
            workspace_path = self.write_workspace_file(
                workspace_root,
                [{"path": "."}],
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            service.apply_sync(
                context_pack_dir,
                selected_focus_ids=["services-identity"],
                scope_mode="focused",
            )

            workspace_payload = json.loads(
                workspace_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                workspace_payload["folders"],
                [
                    {"path": "."},
                    {"path": str(
                        (monolith_root / "services" / "identity").resolve()
                    )},
                ],
            )
            state = service.load_sync_state()
            self.assertEqual(state["selected_repo_ids"], [])
            self.assertEqual(
                state["selected_focus_ids"],
                ["services-identity"],
            )

    def test_monolith_allows_multiple_selected_focus_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            monolith_root = workspace_root / "mono-repo"
            context_pack_dir = workspace_root / "contexts" / "mono-pack"
            self.create_git_repo(monolith_root)
            (monolith_root / "services" / "billing").mkdir(parents=True)
            (monolith_root / "services" / "identity").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_monolith_manifest(
                discovery_root=monolith_root,
                context_pack_dir=context_pack_dir,
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            preview = service.preview_sync(
                context_pack_dir,
                selected_focus_ids=[
                    "services-billing",
                    "services-identity",
                ],
                scope_mode="focused",
            )

            self.assertEqual(preview["selected_repo_ids"], [])
            self.assertEqual(
                preview["selected_focus_ids"],
                ["services-billing", "services-identity"],
            )
            self.assertEqual(
                preview["folders_to_add"],
                [
                    str((monolith_root / "services" / "billing").resolve()),
                    str((monolith_root / "services" / "identity").resolve()),
                ],
            )

    def test_monolith_rejects_unknown_focus_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            monolith_root = workspace_root / "mono-repo"
            context_pack_dir = workspace_root / "contexts" / "mono-pack"
            self.create_git_repo(monolith_root)
            (monolith_root / "services" / "billing").mkdir(parents=True)
            (monolith_root / "services" / "identity").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_monolith_manifest(
                discovery_root=monolith_root,
                context_pack_dir=context_pack_dir,
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            with self.assertRaisesRegex(ValueError, "Selected focus ids"):
                service.preview_sync(
                    context_pack_dir,
                    selected_focus_ids=["missing-focus"],
                )

    def test_inspect_sync_health_reports_active_drift_and_restore(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            self.create_git_repo(repo_one)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one],
            )
            workspace_path = self.write_workspace_file(
                workspace_root,
                [{"path": "."}],
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-08T02:00:00Z",
            )
            service.apply_sync(context_pack_dir)
            workspace_path.write_text(
                json.dumps(
                    {"folders": [{"path": "."}], "settings": {}},
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            health = service.inspect_sync_health()

            self.assertEqual(health["status"], "active-dirty-workspace")
            self.assertTrue(health["drift_detected"])
            self.assertTrue(health["restore_available"])
            self.assertEqual(
                health["missing_managed_folders"],
                [
                    str(repo_one.resolve()),
                ],
            )

    def test_inspect_sync_health_reports_clean_active_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            self.create_git_repo(repo_one)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one],
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
            )
            service.apply_sync(context_pack_dir)

            health = service.inspect_sync_health()

            self.assertEqual(health["status"], "active")
            self.assertFalse(health["drift_detected"])
            self.assertFalse(health["restore_available"])

    def test_absolute_local_paths_outside_workspace_boundary_are_rejected(
        self,
    ) -> None:
        """Absolute local_paths outside workspace_root.parent resolve to None when missing."""
        with tempfile.TemporaryDirectory() as outer:
            with tempfile.TemporaryDirectory() as separate:
                workspace_root = Path(outer) / "workspace"
                workspace_root.mkdir()
                self.write_workspace_file(workspace_root, [{"path": "."}])
                context_pack_dir = workspace_root / "contexts" / "pack"
                context_pack_dir.mkdir(parents=True)

                outside_dir = Path(separate) / "escape-target"
                # Do NOT create outside_dir so it doesn't exist

                service = WorkspaceContextSyncService(
                    workspace_root=workspace_root,
                )

                result = service._resolve_manifest_target_path(
                    context_pack_dir,
                    str(outside_dir),
                )
                self.assertIsNone(result)

    def test_absolute_local_paths_within_workspace_boundary_are_accepted(
        self,
    ) -> None:
        """Absolute local_paths under workspace_root.parent should resolve."""
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root) / "workspace"
            workspace_root.mkdir()
            self.write_workspace_file(workspace_root, [{"path": "."}])
            context_pack_dir = workspace_root / "contexts" / "pack"
            context_pack_dir.mkdir(parents=True)

            sibling_dir = Path(temp_root) / "repos" / "my-api"
            sibling_dir.mkdir(parents=True)

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
            )
            result = service._resolve_manifest_target_path(
                context_pack_dir,
                str(sibling_dir),
            )
            self.assertIsNotNone(result)
            self.assertEqual(result, sibling_dir.resolve())


if __name__ == "__main__":
    unittest.main()
