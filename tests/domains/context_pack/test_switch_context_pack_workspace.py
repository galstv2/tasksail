from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any
import unittest


class SwitchContextPackWorkspaceTests(unittest.TestCase):
    """Tests for the workspace sync Python CLI.

    The original workspace-sync wrapper was a composite entrypoint that ran
    activation *then* workspace sync and emitted a JSON envelope. That wrapper
    has been removed and the canonical entrypoint for workspace-folder
    synchronisation is now the
    Python script ``sync-context-pack-workspace.py`` which delegates to
    ``WorkspaceContextSyncService``.

    Tests that relied on wrapper-specific behaviour (activation
    orchestration, env-state clearing, the JSON envelope format) are
    skipped with a note.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.script_path = (
            cls.repo_root
            / "src"
            / "backend"
            / "scripts"
            / "python"
            / "sync-context-pack-workspace.py"
        )

    def run_script(
        self,
        *args: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(self.script_path), *args],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
            env=env,
        )

    def write_file(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def parse_stdout_json(
        self, completed: subprocess.CompletedProcess[str]
    ) -> dict[str, Any]:
        self.assertTrue(completed.stdout.strip(), msg=completed.stderr)
        return json.loads(completed.stdout)

    def write_workspace_file(
        self,
        workspace_root: Path,
        folders: list[dict[str, str]],
    ) -> None:
        self.write_file(
            workspace_root / "tasksail.code-workspace",
            json.dumps({"folders": folders, "settings": {}}, indent=2)
            + "\n",
        )

    def write_manifest(
        self,
        context_pack_dir: Path,
        *,
        repo_paths: list[tuple[str, Path]],
    ) -> None:
        payload = {
            "manifest_version": "qmd-repo-sources/v1",
            "context_pack_id": context_pack_dir.name,
            "qmd_scope_root": f"qmd/context-packs/{context_pack_dir.name}",
            "estate_type": "distributed-platform",
            "repositories": [
                {
                    "repo_id": repo_id,
                    "repo_name": repo_id.replace("-", " ").title(),
                    "local_paths": [str(repo_path.resolve())],
                    "system_layer": "backend",
                }
                for repo_id, repo_path in repo_paths
            ],
        }
        self.write_file(
            context_pack_dir / "qmd" / "repo-sources.json",
            json.dumps(payload, indent=2) + "\n",
        )

    @unittest.skip(
        "Activation orchestration was handled by the removed shell wrapper; "
        "the Python sync CLI does not perform activation."
    )
    def test_apply_runs_activation_before_sync_and_returns_stable_json(
        self,
    ) -> None:
        pass

    @unittest.skip(
        "Activation failure propagation was handled by the removed shell "
        "wrapper; the Python sync CLI does not perform activation."
    )
    def test_activation_failure_propagates_with_real_exit_code(self) -> None:
        pass

    @unittest.skip(
        "Post-activation sync failure was handled by the removed shell "
        "wrapper; the Python sync CLI does not perform activation."
    )
    def test_workspace_sync_failure_propagates_after_activation(self) -> None:
        pass

    def test_monolith_focus_selection_round_trips_through_wrapper(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            workspace_root = temp_path / "workspace"
            context_pack_dir = temp_path / "contexts" / "mono-pack"
            monolith_root = temp_path / "mono-repo"

            (monolith_root / ".git").mkdir(parents=True, exist_ok=True)
            (monolith_root / "services" / "billing").mkdir(parents=True)
            (monolith_root / "services" / "identity").mkdir(parents=True)
            self.write_workspace_file(workspace_root, [{"path": "."}])
            self.write_file(
                context_pack_dir / "qmd" / "repo-sources.json",
                json.dumps(
                    {
                        "manifest_version": "qmd-repo-sources/v1",
                        "context_pack_id": "mono-pack",
                        "display_name": "Mono Pack",
                        "estate_type": "monolith",
                        "default_scope_mode": "focused",
                        "qmd_scope_root": "qmd/context-packs/mono-pack",
                        "repositories": [
                            {
                                "repo_id": "mono-repo",
                                "repo_name": "Mono Repo",
                                "local_paths": [str(monolith_root.resolve())],
                                "system_layer": "shared",
                            }
                        ],
                        "focusable_areas": [
                            {
                                "focus_id": "services-billing",
                                "focus_name": "Billing Service",
                                "focus_type": "service",
                                "relative_path": "services/billing",
                                "default_focusable": True,
                            },
                            {
                                "focus_id": "services-identity",
                                "focus_name": "Identity Service",
                                "focus_type": "service",
                                "relative_path": "services/identity",
                            },
                        ],
                        "primary_focus_area_ids": ["services-billing"],
                    },
                    indent=2,
                )
                + "\n",
            )

            apply = self.run_script(
                "--action", "apply",
                "--context-pack-dir", str(context_pack_dir),
                "--workspace-root", str(workspace_root),
                "--selected-focus-id", "services-billing",
                "--selected-focus-id", "services-identity",
            )

            self.assertEqual(apply.returncode, 0, msg=apply.stderr)
            apply_payload = self.parse_stdout_json(apply)
            self.assertEqual(
                apply_payload["selected_repo_ids"],
                [],
            )
            self.assertEqual(
                apply_payload["selected_focus_ids"],
                ["services-billing", "services-identity"],
            )
            workspace_payload = json.loads(
                (
                    workspace_root
                    / "tasksail.code-workspace"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(
                workspace_payload["folders"],
                [
                    {"path": "."},
                    {"path": str(context_pack_dir.resolve())},
                    {"path": str(
                        (monolith_root / "services" / "billing").resolve()
                    )},
                    {"path": str(
                        (monolith_root / "services" / "identity").resolve()
                    )},
                ],
            )



if __name__ == "__main__":
    unittest.main()
