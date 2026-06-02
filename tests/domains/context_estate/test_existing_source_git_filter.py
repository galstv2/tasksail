"""Focused tests for existing-source missing-Git discovery warnings.

Covers ``collect_missing_git_repo_warnings`` behavior surfaced through
``discover_estate``: distributed repo-like folders without a top-level Git
marker are reported in ``skipped_repos_missing_git`` (and mirrored into
``warnings``), grouping folders that contain discovered Git repos are not
warned on, ``.git`` files count as valid markers, and monolith roots without
Git emit a single root-level warning while focus-area discovery is unchanged.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate_discovery import discover_estate


def missing_git_message(repo_name: str) -> str:
    return (
        f"repo {repo_name} does not have .git folder, if you would like it "
        "part of this context pack please initialize git in this repo."
    )


class ExistingSourceGitFilterTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def skipped_relative_paths(self, payload: dict) -> list[str]:
        return [item["relative_path"] for item in payload["skipped_repos_missing_git"]]

    def candidate_relative_paths(self, payload: dict) -> list[str]:
        return [repo["relative_path"] for repo in payload["candidate_repos"]]

    def test_distributed_top_level_sibling_without_git_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "estate"
            self.create_git_repo(root / "api")
            (root / "web").mkdir(parents=True)

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(self.candidate_relative_paths(payload), ["api"])
            self.assertEqual(self.skipped_relative_paths(payload), ["web"])
            warning = payload["skipped_repos_missing_git"][0]
            self.assertEqual(warning["repo_name"], "web")
            self.assertEqual(warning["message"], missing_git_message("web"))
            self.assertIn(missing_git_message("web"), payload["warnings"])

    def test_distributed_platform_uses_same_missing_git_behavior(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "estate"
            self.create_git_repo(root / "api")
            (root / "web").mkdir(parents=True)

            payload = discover_estate(root, mode="distributed-platform")

            self.assertEqual(payload["estate_type"], "distributed-platform")
            self.assertEqual(self.candidate_relative_paths(payload), ["api"])
            self.assertEqual(self.skipped_relative_paths(payload), ["web"])

    def test_grouping_folder_with_nested_sibling_warns_only_on_sibling(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "estate"
            self.create_git_repo(root / "services" / "api")
            (root / "services" / "web").mkdir(parents=True)

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(
                self.candidate_relative_paths(payload), ["services/api"]
            )
            # The grouping folder itself is never warned on.
            self.assertNotIn("services", self.skipped_relative_paths(payload))
            self.assertEqual(
                self.skipped_relative_paths(payload), ["services/web"]
            )
            self.assertEqual(
                payload["skipped_repos_missing_git"][0]["repo_name"], "web"
            )

    def test_all_distributed_folders_invalid_yields_no_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "estate"
            (root / "api").mkdir(parents=True)
            (root / "web").mkdir(parents=True)

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(payload["candidate_repos"], [])
            self.assertEqual(
                sorted(self.skipped_relative_paths(payload)), ["api", "web"]
            )
            for name in ("api", "web"):
                self.assertIn(missing_git_message(name), payload["warnings"])

    def test_git_file_marker_is_valid_and_not_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "estate"
            worktree_repo = root / "api"
            worktree_repo.mkdir(parents=True)
            # A ``.git`` file (worktree/submodule) is a valid marker.
            (worktree_repo / ".git").write_text("gitdir: /elsewhere/.git/worktrees/api\n")

            payload = discover_estate(root, mode="distributed")

            self.assertEqual(self.candidate_relative_paths(payload), ["api"])
            self.assertEqual(payload["skipped_repos_missing_git"], [])

    def test_monolith_root_without_git_emits_single_root_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono-app"
            (root / "src").mkdir(parents=True)
            (root / "docs").mkdir(parents=True)

            payload = discover_estate(root, mode="monolith")

            self.assertEqual(payload["estate_type"], "monolith")
            # Focus-area discovery is unchanged.
            self.assertEqual(
                sorted(
                    area["relative_path"]
                    for area in payload["candidate_focus_areas"]
                ),
                ["docs", "src"],
            )
            # Exactly one root-level missing-Git warning, not per focus area.
            self.assertEqual(len(payload["skipped_repos_missing_git"]), 1)
            warning = payload["skipped_repos_missing_git"][0]
            self.assertEqual(warning["repo_name"], "mono-app")
            self.assertIn(missing_git_message("mono-app"), payload["warnings"])

    def test_monolith_subtree_of_git_repo_has_no_root_warning(self) -> None:
        # Selecting a subtree of a monorepo: the .git lives in an ancestor, so
        # the subtree is Git-backed and must not be warned.
        with tempfile.TemporaryDirectory() as temp_root:
            monorepo = Path(temp_root) / "monorepo"
            self.create_git_repo(monorepo)
            subtree = monorepo / "services" / "billing"
            (subtree / "src").mkdir(parents=True)

            payload = discover_estate(subtree, mode="monolith")

            self.assertEqual(payload["skipped_repos_missing_git"], [])
            self.assertFalse(
                any("does not have .git" in w for w in payload["warnings"])
            )

    def test_monolith_root_with_git_has_no_root_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono-app"
            self.create_git_repo(root)
            (root / "src").mkdir(parents=True)

            payload = discover_estate(root, mode="monolith")

            self.assertEqual(payload["skipped_repos_missing_git"], [])

    def test_allow_missing_helper_root_has_no_root_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            missing_root = Path(temp_root) / "new-project-root"

            payload = discover_estate(
                missing_root,
                mode="monolith",
                allow_missing=True,
            )

            self.assertTrue(missing_root.is_dir())
            self.assertEqual(payload["skipped_repos_missing_git"], [])

    def test_auto_mode_git_root_stays_monolith_without_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono-app"
            self.create_git_repo(root)
            (root / "src").mkdir(parents=True)

            payload = discover_estate(root)

            self.assertEqual(payload["estate_type"], "monolith")
            self.assertEqual(payload["skipped_repos_missing_git"], [])


if __name__ == "__main__":
    unittest.main()
