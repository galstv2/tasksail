"""Creation-time category/focus boundary guards.

These prove that context-pack creation classifies repo/folder KIND via
repo_category and routes the operator's working-target selection ONLY through
primary_working_repo_ids / primary_focus_area_ids — never by treating
repository_type as a creation-time primary/support classification.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate.bootstrap_builders import (
    _build_monolith_focusable_areas,
)
from src.backend.mcp.context_estate.bootstrap_normalization import (
    normalize_bootstrap_answers,
)
from src.backend.mcp.context_estate.discovery import discover_estate
from src.backend.mcp.context_estate.manifest import build_approved_manifest


class FocusCategoryBoundaryTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def test_repo_focus_not_backfilled_from_repository_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            repo_root = Path(temp_root) / "orders-api"
            self.create_git_repo(repo_root)
            normalized = normalize_bootstrap_answers(
                {
                    "context_pack_id": "orders-estate",
                    "estate_name": "Orders Estate",
                    "repositories": [
                        {
                            "repo_root": str(repo_root),
                            "repo_name": "Orders API",
                            "system_layer": "backend",
                            "repositoryType": "primary",
                        }
                    ],
                    "primary_working_repo_ids": ["orders-api"],
                }
            )
            # Legacy repository_type (kind axis) is still recorded, but repo_focus
            # (focus axis) must NOT be backfilled from it at creation time.
            self.assertEqual(
                normalized["repositories"][0]["repository_type"], "primary"
            )
            self.assertNotEqual(
                normalized["repositories"][0].get("repo_focus"), "primary"
            )
            self.assertFalse(normalized["repositories"][0].get("repo_focus"))

    def test_repo_focus_preserved_when_explicitly_provided(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            repo_root = Path(temp_root) / "orders-api"
            self.create_git_repo(repo_root)
            normalized = normalize_bootstrap_answers(
                {
                    "context_pack_id": "orders-estate",
                    "estate_name": "Orders Estate",
                    "repositories": [
                        {
                            "repo_root": str(repo_root),
                            "repo_name": "Orders API",
                            "system_layer": "backend",
                            "repoFocus": "support",
                        }
                    ],
                    "primary_working_repo_ids": [],
                }
            )
            self.assertEqual(
                normalized["repositories"][0]["repo_focus"], "support"
            )

    def test_distributed_focus_derived_solely_from_primary_working_repo_ids(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            web_repo = discovery_root / "services" / "orders-web"
            lib_repo = discovery_root / "packages" / "shared-lib"
            for repo in (api_repo, web_repo, lib_repo):
                self.create_git_repo(repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            # Renderer-created payload carries NO per-repo repository_type; the
            # operator selects only the library repo as the working target. A
            # 'library' kind being primary proves focus is not category-driven.
            review_payload = {
                "context_pack_id": "orders-estate",
                "display_name": "Orders Estate",
                "estate_type": "distributed-platform",
                "primary_working_repo_ids": ["packages-shared-lib"],
                "repositories": [
                    {"repo_id": "services-orders-api", "system_layer": "backend"},
                    {"repo_id": "services-orders-web", "system_layer": "frontend"},
                    {"repo_id": "packages-shared-lib", "system_layer": "shared"},
                ],
            }

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            focus = {r["repo_id"]: r["repo_focus"] for r in manifest["repositories"]}
            self.assertEqual(focus["packages-shared-lib"], "primary")
            self.assertEqual(focus["services-orders-api"], "support")
            self.assertEqual(focus["services-orders-web"], "support")
            for repo in manifest["repositories"]:
                self.assertEqual(repo["repository_type"], repo["repo_focus"])

    def test_monolith_manifest_sets_repo_focus_primary_on_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="monolith")
            review_payload = {
                "context_pack_id": "mono-pack",
                "display_name": "Mono Pack",
                "estate_type": "monolith",
                "repository": {
                    "repo_id": "mono-repo",
                    "repo_name": "Mono Repo",
                    "system_layer": "shared",
                },
                "primary_focus_area_ids": ["services-billing"],
                "focusable_areas": [{"relative_path": "services/billing"}],
            }

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            # build_approved_manifest is self-consistent for the monolith root:
            # both repository_type and repo_focus are primary, without relying on
            # the downstream PackWriter backfill.
            root = manifest["repositories"][0]
            self.assertEqual(root["repository_type"], "primary")
            self.assertEqual(root["repo_focus"], "primary")

    def test_monolith_root_category_is_most_frequent_focus_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono"
            self.create_git_repo(root)
            # Two service folders, one docs folder → dominant kind is service.
            (root / "services" / "billing").mkdir(parents=True)
            (root / "services" / "orders").mkdir(parents=True)
            (root / "docs").mkdir(parents=True)

            payload = discover_estate(root, mode="monolith")

            # Root category = the MOST FREQUENT focus-area category
            # (service x2 beats documentation x1); no folder recursion.
            self.assertEqual(payload["root_repo_category"], "service")
            cats = {
                a["relative_path"]: a.get("focus_category")
                for a in payload["candidate_focus_areas"]
            }
            self.assertEqual(cats["services/billing"], "service")
            self.assertEqual(cats["services/orders"], "service")
            self.assertEqual(cats["docs"], "documentation")

    def test_monolith_focus_category_persists_to_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="monolith")
            review_payload = {
                "context_pack_id": "mono-pack",
                "display_name": "Mono Pack",
                "estate_type": "monolith",
                "repository": {
                    "repo_id": "mono",
                    "repo_name": "Mono",
                    "system_layer": "shared",
                },
                "primary_focus_area_ids": ["services-billing"],
                "focusable_areas": [
                    {"relative_path": "services/billing", "focus_category": "service"},
                ],
            }

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            focus_area = manifest["focusable_areas"][0]
            self.assertEqual(focus_area["focus_category"], "service")

    def test_focus_category_falls_back_to_content_probe(self) -> None:
        # A generically-named monolith folder whose name/type heuristic resolves
        # to 'unknown' is classified by its CONTENTS (the same probe distributed
        # repos use), rather than defaulting to 'unknown'.
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root) / "mono"
            self.create_git_repo(root)
            billing = root / "billing"
            billing.mkdir()
            (billing / "package.json").write_text(
                '{"dependencies": {"express": "4"}}', encoding="utf-8"
            )

            payload = discover_estate(root, mode="monolith")

            cats = {
                a["relative_path"]: a.get("focus_category")
                for a in payload["candidate_focus_areas"]
            }
            # 'billing' is not a recognized focus-type folder name, but its
            # contents (express) classify it as a service.
            self.assertEqual(cats["billing"], "service")

    def test_operator_authored_focus_category_survives_review_payload(self) -> None:
        # Regression: the review-payload builder must carry the operator's
        # authored focus_category through, not silently fall back to the
        # discovery-derived value.
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)

            discovery_payload = discover_estate(discovery_root, mode="monolith")
            # Discovery classifies services/billing as 'service'; the operator
            # overrides it to 'library' and that choice must win.
            answers = {
                "focusable_areas": [
                    {
                        "relative_path": "services/billing",
                        "focus_category": "library",
                        "focus_category_authored": True,
                    }
                ]
            }

            built = _build_monolith_focusable_areas(answers, discovery_payload)
            entry = next(
                e for e in built if e["relative_path"] == "services/billing"
            )
            self.assertEqual(entry["focus_category"], "library")
            self.assertTrue(entry["focus_category_authored"])


if __name__ == "__main__":
    unittest.main()
