from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate_discovery import discover_estate
from src.backend.mcp.context_estate_draft_index import (
    DEFAULT_DRAFT_FILE,
    resolve_draft_artifact_path,
    write_draft_artifact,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "src" / "backend" / "scripts" / "python" / "discover-context-estate.py"


class ContextEstateDraftIndexTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_resolve_draft_artifact_path_uses_predictable_qmd_location(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            context_pack_dir.mkdir(parents=True)

            draft_path = resolve_draft_artifact_path(context_pack_dir)

            self.assertEqual(
                draft_path,
                context_pack_dir.resolve() / DEFAULT_DRAFT_FILE,
            )

    def test_write_draft_artifact_round_trips_generated_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "billing-pack"
            repo_root = discovery_root / "services" / "billing-api"
            self.create_git_repo(repo_root)
            context_pack_dir.mkdir(parents=True)

            discovery_payload = discover_estate(
                discovery_root,
                mode="distributed",
            )
            draft_path = write_draft_artifact(
                context_pack_dir,
                discovery_payload,
                generated_at="2026-03-08T00:00:00Z",
            )

            artifact = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(
                artifact["schema_version"],
                "qmd-draft-structure/v1",
            )
            self.assertEqual(
                artifact["artifact_type"],
                "discovery-structure-draft",
            )
            self.assertEqual(artifact["artifact_status"], "generated")
            self.assertEqual(artifact["context_pack_id"], "billing-pack")
            self.assertEqual(
                [
                    repo["relative_path"]
                    for repo in artifact["candidate_repos"]
                ],
                ["services/billing-api"],
            )

    def test_build_draft_artifact_refreshes_existing_file_safely(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "identity").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)

            first_payload = discover_estate(discovery_root, mode="monolith")
            draft_path = write_draft_artifact(
                context_pack_dir,
                first_payload,
                generated_at="2026-03-08T00:00:00Z",
            )

            (discovery_root / "services" / "billing").mkdir(parents=True)
            refreshed_payload = discover_estate(
                discovery_root,
                mode="monolith",
            )
            write_draft_artifact(
                context_pack_dir,
                refreshed_payload,
                generated_at="2026-03-08T01:00:00Z",
            )

            artifact = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact["generated_at"], "2026-03-08T01:00:00Z")
            self.assertEqual(
                [
                    area["relative_path"]
                    for area in artifact["candidate_focus_areas"]
                ],
                ["services/billing", "services/identity"],
            )

    def test_resolve_draft_artifact_path_rejects_manifest_overwrite(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "contexts" / "sample-pack"
            context_pack_dir.mkdir(parents=True)

            with self.assertRaisesRegex(
                ValueError,
                "Draft artifact path must remain distinct",
            ):
                resolve_draft_artifact_path(
                    context_pack_dir,
                    "qmd/repo-sources.json",
                )

    def test_cli_writes_draft_artifact_without_mutating_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "platform-root"
            repo_root = discovery_root / "repos" / "payments-api"
            self.create_git_repo(repo_root)

            context_pack_dir = Path(temp_root) / "contexts" / "payments-pack"
            manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            original_manifest = {
                "context_pack_id": "payments-pack",
                "repositories": [],
            }
            manifest_path.write_text(
                json.dumps(original_manifest, indent=2) + "\n",
                encoding="utf-8",
            )

            completed = self.run_script(
                "--root",
                str(discovery_root),
                "--format",
                "json",
                "--write-qmd-draft",
                "--context-pack-dir",
                str(context_pack_dir),
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            draft_path = (
                context_pack_dir
                / "qmd"
                / "bootstrap"
                / "discovery-structure.json"
            )
            self.assertTrue(draft_path.exists())
            self.assertEqual(payload["qmd_draft_artifact_status"], "written")
            self.assertEqual(
                payload["qmd_draft_artifact_path"],
                str(draft_path.resolve()),
            )

            artifact = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact["artifact_status"], "generated")
            self.assertEqual(
                json.loads(manifest_path.read_text(encoding="utf-8")),
                original_manifest,
            )

    def test_cli_rejects_outside_context_pack_draft_target(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "platform-root"
            repo_root = discovery_root / "repos" / "payments-api"
            self.create_git_repo(repo_root)
            context_pack_dir = Path(temp_root) / "contexts" / "payments-pack"
            context_pack_dir.mkdir(parents=True)

            completed = self.run_script(
                "--root",
                str(discovery_root),
                "--write-qmd-draft",
                "--context-pack-dir",
                str(context_pack_dir),
                "--draft-file",
                "../outside.json",
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("context_estate.discovery.qmd_draft_write_failed", completed.stderr)
            self.assertIn("draft_file", completed.stderr)


if __name__ == "__main__":
    unittest.main()
