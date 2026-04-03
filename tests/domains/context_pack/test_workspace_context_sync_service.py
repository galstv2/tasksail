from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from src.backend.mcp.context_estate_discovery import discover_estate
from src.backend.mcp.context_estate_draft_index import write_draft_artifact
from src.backend.mcp.context_estate_manifest import write_approved_manifest
from src.backend.mcp.workspace_context_sync_service import (
    WorkspaceContextSyncService,
)


class WorkspaceContextSyncServiceTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def write_workspace_file(
        self,
        workspace_root: Path,
        folders: list[dict[str, str]],
    ) -> Path:
        workspace_path = (
            workspace_root / "tasksail.code-workspace"
        )
        workspace_path.write_text(
            json.dumps({"folders": folders, "settings": {}}, indent=2) + "\n",
            encoding="utf-8",
        )
        return workspace_path

    def build_distributed_manifest(
        self,
        *,
        workspace_root: Path,
        context_pack_dir: Path,
        repo_roots: list[Path],
    ) -> None:
        draft_payload = discover_estate(
            workspace_root / "estate-root",
            mode="distributed",
        )
        write_draft_artifact(
            context_pack_dir,
            draft_payload,
            generated_at="2026-03-08T00:00:00Z",
        )
        review_payload = {
            "context_pack_id": context_pack_dir.name,
            "display_name": context_pack_dir.name,
            "estate_type": "distributed-platform",
            "repositories": [
                {
                    "repo_id": repo_root.relative_to(
                        workspace_root / "estate-root"
                    )
                    .as_posix()
                    .replace("/", "-"),
                    "system_layer": (
                        "backend"
                        if "api" in repo_root.name
                        else "frontend"
                    ),
                }
                for repo_root in repo_roots
            ],
        }
        write_approved_manifest(
            context_pack_dir,
            draft_payload,
            review_payload,
            approved_at="2026-03-08T01:00:00Z",
        )

    def build_monolith_manifest(
        self,
        *,
        discovery_root: Path,
        context_pack_dir: Path,
    ) -> None:
        draft_payload = discover_estate(discovery_root, mode="monolith")
        write_draft_artifact(
            context_pack_dir,
            draft_payload,
            generated_at="2026-03-08T00:00:00Z",
        )
        review_payload = {
            "context_pack_id": context_pack_dir.name,
            "display_name": context_pack_dir.name,
            "estate_type": "monolith",
            "default_scope_mode": "focused",
            "repository": {
                "repo_id": discovery_root.name,
                "repo_name": discovery_root.name.replace("-", " ").title(),
                "system_layer": "shared",
            },
            "primary_focus_area_ids": ["services-billing"],
            "focusable_areas": [
                {
                    "relative_path": "services/billing",
                    "default_focusable": True,
                    "adjacent_focus_area_ids": ["services-identity"],
                },
                {
                    "relative_path": "services/identity",
                    "adjacent_focus_area_ids": ["services-billing"],
                },
            ],
        }
        write_approved_manifest(
            context_pack_dir,
            draft_payload,
            review_payload,
            approved_at="2026-03-08T01:00:00Z",
        )

    def test_preview_add_remove_computation(self) -> None:
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
                workspace_root=workspace_root
            )
            preview = service.preview_sync(
                context_pack_dir,
                scope_mode="focused",
            )

            self.assertEqual(
                preview["folders_to_add"],
                [
                    str(context_pack_dir.resolve()),
                    str(repo_one.resolve()),
                ],
            )
            self.assertEqual(preview["folders_to_remove"], [])

    def test_apply_writes_expected_folder_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            operator_folder = workspace_root / "notes"
            self.create_git_repo(repo_one)
            operator_folder.mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one],
            )
            workspace_path = self.write_workspace_file(
                workspace_root,
                [{"path": "."}, {"path": str(operator_folder)}],
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            service.apply_sync(
                context_pack_dir,
                scope_mode="focused",
            )

            workspace_payload = json.loads(
                workspace_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                workspace_payload["folders"],
                [
                    {"path": "."},
                    {"path": str(operator_folder)},
                    {"path": str(context_pack_dir.resolve())},
                    {"path": str(repo_one.resolve())},
                ],
            )

    def test_clear_preserves_platform_owned_and_operator_owned_folders(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            operator_folder = workspace_root / "notes"
            self.create_git_repo(repo_one)
            operator_folder.mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)
            self.build_distributed_manifest(
                workspace_root=workspace_root,
                context_pack_dir=context_pack_dir,
                repo_roots=[repo_one],
            )
            workspace_path = self.write_workspace_file(
                workspace_root,
                [{"path": "."}, {"path": str(operator_folder)}],
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            service.apply_sync(
                context_pack_dir,
                scope_mode="focused",
            )
            clear_result = service.clear_context_pack_workspace()

            workspace_payload = json.loads(
                workspace_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                workspace_payload["folders"],
                [{"path": "."}, {"path": str(operator_folder)}],
            )
            self.assertEqual(
                clear_result["folders_to_remove"],
                [str(context_pack_dir.resolve()), str(repo_one.resolve())],
            )

    def test_duplicate_real_path_is_deduplicated_safely(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            estate_root = workspace_root / "estate-root"
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_one = estate_root / "services" / "orders-api"
            repo_link = estate_root / "aliases" / "orders-api-link"
            self.create_git_repo(repo_one)
            repo_link.parent.mkdir(parents=True, exist_ok=True)
            repo_link.symlink_to(repo_one, target_is_directory=True)
            context_pack_dir.mkdir(parents=True)

            manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "qmd-repo-sources/v1",
                        "context_pack_id": "orders-estate",
                        "estate_type": "distributed-platform",
                        "qmd_scope_root": "qmd/context-packs/orders-estate",
                        "repositories": [
                            {
                                "repo_id": "services-orders-api",
                                "repo_name": "Orders Api",
                                "local_paths": [str(repo_one.resolve())],
                                "system_layer": "backend",
                            },
                            {
                                "repo_id": "orders-api-link",
                                "repo_name": "Orders Api Link",
                                "local_paths": [str(repo_link)],
                                "system_layer": "backend",
                            },
                        ],
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            self.write_workspace_file(workspace_root, [{"path": "."}])

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            preview = service.preview_sync(
                context_pack_dir,
                scope_mode="focused",
            )

            self.assertEqual(
                preview["folders_to_add"],
                [str(context_pack_dir.resolve()), str(repo_one.resolve())],
            )

    def test_relative_manifest_path_outside_context_pack_is_rejected(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            context_pack_dir.mkdir(parents=True)
            self.write_workspace_file(workspace_root, [{"path": "."}])
            manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "qmd-repo-sources/v1",
                        "context_pack_id": "orders-estate",
                        "qmd_scope_root": "qmd/context-packs/orders-estate",
                        "repositories": [
                            {
                                "repo_id": "escape",
                                "repo_name": "Escape",
                                "local_paths": ["../escape"],
                                "system_layer": "backend",
                            }
                        ],
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root
            )
            with self.assertRaisesRegex(ValueError, "Field 'local_paths'"):
                service.preview_sync(context_pack_dir)

    def test_workspace_and_state_path_out_of_bounds_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            with self.assertRaisesRegex(ValueError, "workspace_file"):
                WorkspaceContextSyncService(
                    workspace_root=workspace_root,
                    workspace_file="../outside.code-workspace",
                )
            with self.assertRaisesRegex(ValueError, "state_file"):
                WorkspaceContextSyncService(
                    workspace_root=workspace_root,
                    state_file="../outside.json",
                )

    def test_sync_state_read_write_round_trip(self) -> None:
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
                now=lambda: "2026-03-08T02:00:00Z",
            )
            service.apply_sync(context_pack_dir)
            state = service.load_sync_state()

            self.assertEqual(state["active_context_pack_id"], "orders-estate")
            self.assertEqual(state["status"], "success")
            self.assertEqual(state["scope_mode"], "focused")
            self.assertEqual(
                state["selected_repo_ids"],
                ["services-orders-api"],
            )
            self.assertEqual(
                state["managed_folders"],
                [str(context_pack_dir.resolve()), str(repo_one.resolve())],
            )

    def test_existing_operator_owned_target_folder_is_preserved_not_managed(
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
            self.write_workspace_file(
                workspace_root,
                [{"path": "."}, {"path": str(repo_one.resolve())}],
            )

            service = WorkspaceContextSyncService(
                workspace_root=workspace_root,
                now=lambda: "2026-03-08T02:00:00Z",
            )
            service.apply_sync(context_pack_dir)
            state = service.load_sync_state()

            self.assertEqual(
                state["managed_folders"],
                [str(context_pack_dir.resolve())],
            )

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
                    str(context_pack_dir.resolve()),
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
                    str(context_pack_dir.resolve()),
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
                    str(context_pack_dir.resolve()),
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
                    {"path": str(context_pack_dir.resolve())},
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
                    str(context_pack_dir.resolve()),
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
                    str(context_pack_dir.resolve()),
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
