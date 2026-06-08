from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.workspace_context_sync.service import (
    WorkspaceContextSyncService,
)


class WorkspaceContextSyncStateOnlyTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def write_manifest(self, context_pack_dir: Path, repo_root: Path) -> None:
        manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(
                {
                    "manifest_version": "qmd-repo-sources/v2",
                    "manifest_status": "approved",
                    "context_pack_id": context_pack_dir.name,
                    "estate_type": "distributed-platform",
                    "qmd_scope_root": f"qmd/context-packs/{context_pack_dir.name}",
                    "primary_working_repo_ids": ["orders-api"],
                    "primary_focus_area_ids": [],
                    "repositories": [
                        {
                            "repo_id": "orders-api",
                            "repo_name": "Orders API",
                            "local_paths": [
                                {
                                    "host": str(repo_root.resolve()),
                                    "container": None,
                                }
                            ],
                            "system_layer": "backend",
                            "repository_type": "primary",
                        }
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def write_workspace(self, workspace_root: Path, payload: dict) -> Path:
        workspace_file = workspace_root / "tasksail.code-workspace"
        workspace_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return workspace_file

    def test_apply_and_clear_leave_workspace_file_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_root = workspace_root / "estate-root" / "orders-api"
            self.create_git_repo(repo_root)
            self.write_manifest(context_pack_dir, repo_root)
            workspace_file = self.write_workspace(
                workspace_root,
                {"folders": [{"path": "."}, {"path": "notes"}], "settings": {}},
            )
            before = workspace_file.read_bytes()

            service = WorkspaceContextSyncService(workspace_root=workspace_root)
            apply_result = service.apply_sync(context_pack_dir)
            after_apply = workspace_file.read_bytes()
            clear_result = service.clear_context_pack_workspace()

            self.assertEqual(after_apply, before)
            self.assertEqual(workspace_file.read_bytes(), before)
            self.assertEqual(apply_result["folders_to_add"], [])
            self.assertEqual(apply_result["folders_to_remove"], [])
            self.assertEqual(apply_result["managed_folders"], [])
            self.assertEqual(clear_result["folders_to_add"], [])
            self.assertEqual(clear_result["folders_to_remove"], [])
            self.assertEqual(clear_result["managed_folders"], [])

    def test_apply_succeeds_when_workspace_file_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            repo_root = workspace_root / "estate-root" / "orders-api"
            self.create_git_repo(repo_root)
            self.write_manifest(context_pack_dir, repo_root)

            service = WorkspaceContextSyncService(workspace_root=workspace_root)
            result = service.apply_sync(context_pack_dir)
            state = service.load_sync_state()

            self.assertEqual(result["managed_folders"], [])
            self.assertEqual(state["managed_folders"], [])

    def test_inspect_health_reports_active_without_workspace_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            workspace_file = self.write_workspace(
                workspace_root,
                {"folders": [{"path": "."}, {"path": "/tmp/unrelated"}]},
            )
            state_file = workspace_root / ".platform-state" / "workspace-context-sync.json"
            state_file.parent.mkdir(parents=True, exist_ok=True)
            state_file.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "workspace_file": str(workspace_file),
                        "active_context_pack_dir": str((workspace_root / "contexts" / "orders-estate").resolve()),
                        "active_context_pack_id": "orders-estate",
                        "scope_mode": "focused",
                        "selected_repo_ids": ["orders-api"],
                        "selected_focus_ids": [],
                        "managed_folders": ["/tmp/missing-managed-folder"],
                        "last_synced_at": "2026-03-08T00:00:00Z",
                        "status": "success",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            service = WorkspaceContextSyncService(workspace_root=workspace_root)
            result = service.inspect_sync_health()

            self.assertEqual(result["status"], "active")
            self.assertEqual(result["managed_folders"], [])
            self.assertEqual(result["attached_managed_folders"], [])
            self.assertEqual(result["missing_managed_folders"], [])
            self.assertFalse(result["drift_detected"])

    def test_preview_can_report_empty_workspace_deltas(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            workspace_root = Path(temp_root)
            context_pack_dir = workspace_root / "contexts" / "orders-estate"
            self.write_manifest(context_pack_dir, workspace_root / "missing-repo")
            self.write_workspace(workspace_root, {"folders": [{"path": "."}]})

            service = WorkspaceContextSyncService(workspace_root=workspace_root)
            result = service.preview_sync(context_pack_dir)

            self.assertEqual(result["folders_to_add"], [])
            self.assertEqual(result["folders_to_remove"], [])
            self.assertEqual(result["managed_folders"], [])


if __name__ == "__main__":
    unittest.main()
