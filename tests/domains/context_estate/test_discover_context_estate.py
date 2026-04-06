from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.backend.mcp.context_estate_discovery import discover_estate


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "src" / "backend" / "scripts" / "python" / "discover-context-estate.py"


class DiscoverContextEstateTests(unittest.TestCase):
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

    def test_distributed_root_discovers_nested_git_repositories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "platform-root"
            orders_api = root / "services" / "orders-api"
            orders_web = root / "services" / "orders-web"
            noise_dir = root / "node_modules" / "noise"
            docs_dir = root / "docs"

            self.create_git_repo(orders_api)
            self.create_git_repo(orders_web)
            (orders_api / "src").mkdir(parents=True)
            (orders_web / "docs").mkdir(parents=True)
            noise_dir.mkdir(parents=True)
            docs_dir.mkdir(parents=True)

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(payload["estate_type"], "distributed")
            self.assertEqual(
                [
                    repo["relative_path"]
                    for repo in payload["candidate_repos"]
                ],
                ["services/orders-api", "services/orders-web"],
            )
            self.assertEqual(payload["candidate_focus_areas"], [])
            self.assertEqual(
                [
                    signal["relative_path"]
                    for signal in payload["high_signal_paths"]
                ],
                ["docs", "services"],
            )

    def test_monolith_root_discovers_focus_areas(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono-repo"
            self.create_git_repo(root)
            (root / "services" / "billing").mkdir(parents=True)
            (root / "services" / "identity").mkdir(parents=True)
            (root / "packages" / "shared-ui").mkdir(parents=True)
            (root / "docs").mkdir(parents=True)
            (root / "infra").mkdir(parents=True)
            (root / "shared").mkdir(parents=True)

            payload = discover_estate(root, mode="monolith")

            self.assertEqual(payload["estate_type"], "monolith")
            self.assertEqual(payload["candidate_repos"], [])
            self.assertEqual(
                [
                    area["relative_path"]
                    for area in payload["candidate_focus_areas"]
                ],
                [
                    "docs",
                    "infra",
                    "packages/shared-ui",
                    "services/billing",
                    "services/identity",
                    "shared",
                ],
            )
            focus_types = {
                area["relative_path"]: area["focus_type"]
                for area in payload["candidate_focus_areas"]
            }
            repository_types = {
                area["relative_path"]: area["repository_type"]
                for area in payload["candidate_focus_areas"]
            }
            self.assertEqual(focus_types["services/billing"], "service")
            self.assertEqual(focus_types["packages/shared-ui"], "package")
            self.assertEqual(focus_types["docs"], "docs")
            self.assertEqual(repository_types["services/billing"], "primary")
            self.assertEqual(repository_types["packages/shared-ui"], "support")
            self.assertEqual(repository_types["docs"], "support")

    def test_auto_mode_infers_monolith_for_git_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono-repo"
            self.create_git_repo(root)
            (root / "services" / "catalog").mkdir(parents=True)
            (root / "docs").mkdir(parents=True)

            payload = discover_estate(root)

            self.assertEqual(payload["estate_type"], "monolith")
            self.assertEqual(payload["candidate_repos"], [])
            self.assertEqual(
                [
                    area["relative_path"]
                    for area in payload["candidate_focus_areas"]
                ],
                ["docs", "services/catalog"],
            )

    def test_invalid_root_path_fails_cleanly(self) -> None:
        missing_root = REPO_ROOT / "does-not-exist-for-discovery"
        with self.assertRaisesRegex(ValueError, "Root path does not exist"):
            discover_estate(missing_root, mode="auto")

        completed = self.run_script(
            "--root",
            str(missing_root),
            "--format",
            "json",
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("Root path does not exist", completed.stderr)

    def test_allow_missing_root_creates_directory_for_bootstrap(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            missing_root = Path(temp_root) / "new-project-root"

            payload = discover_estate(
                missing_root,
                mode="monolith",
                allow_missing=True,
            )

            self.assertTrue(missing_root.is_dir())
            self.assertEqual(payload["root_path"], str(missing_root.resolve()))
            self.assertEqual(payload["candidate_repos"], [])
            self.assertEqual(payload["candidate_focus_areas"], [])
            self.assertIn(
                "No candidate focus areas were discovered under the provided "
                "root.",
                payload["warnings"],
            )

    def test_discovery_normalizes_symlinked_repo_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "platform-root"
            actual_repo = root / "services" / "catalog-api"
            symlink_repo = root / "catalog-api-link"
            self.create_git_repo(actual_repo)
            symlink_repo.parent.mkdir(parents=True, exist_ok=True)
            symlink_repo.symlink_to(actual_repo, target_is_directory=True)

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(len(payload["candidate_repos"]), 1)
            repo_entry = payload["candidate_repos"][0]
            self.assertEqual(repo_entry["path"], str(actual_repo.resolve()))
            self.assertEqual(
                repo_entry["relative_path"],
                "services/catalog-api",
            )

    def test_script_outputs_json_contract_for_synthetic_estate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "platform-root"
            repo_one = root / "repos" / "payments-api"
            repo_two = root / "repos" / "payments-web"
            self.create_git_repo(repo_one)
            self.create_git_repo(repo_two)
            (root / "docs").mkdir(parents=True)

            before_paths = sorted(
                path.relative_to(root).as_posix()
                for path in root.rglob("*")
            )

            completed = self.run_script(
                "--root",
                str(root),
                "--format",
                "json",
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload["estate_type"], "distributed")
            self.assertEqual(payload["root_path"], str(root.resolve()))
            self.assertIn("candidate_repos", payload)
            self.assertIn("candidate_focus_areas", payload)
            self.assertIn("warnings", payload)
            self.assertIn("discovered_at", payload)
            self.assertEqual(
                [repo["relative_path"] for repo in payload["candidate_repos"]],
                ["repos/payments-api", "repos/payments-web"],
            )

            after_paths = sorted(
                path.relative_to(root).as_posix()
                for path in root.rglob("*")
            )
            self.assertEqual(before_paths, after_paths)


if __name__ == "__main__":
    unittest.main()
