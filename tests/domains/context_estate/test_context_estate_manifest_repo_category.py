from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate_discovery import discover_estate
from src.backend.mcp.context_estate_manifest import (
    build_approved_manifest,
    write_approved_manifest,
)
from src.backend.mcp.context_pack_bootstrap import (
    _build_distributed_review_payload,
    bootstrap_context_pack,
    normalize_bootstrap_answers,
)


class ContextEstateManifestRepoCategoryTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def create_dotnet_project(self, path: Path, csproj: str) -> None:
        self.create_git_repo(path)
        (path / f"{path.name}.csproj").write_text(csproj, encoding="utf-8")

    def test_write_manifest_carries_discovered_dotnet_service_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            service_repo = discovery_root / "orders-api"
            self.create_dotnet_project(
                service_repo,
                '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
            )
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "orders-estate",
                    "estate_name": "Orders Estate",
                    "repositories": [
                        {
                            "repo_root": str(service_repo),
                            "repo_name": "Orders API",
                            "repo_id": "orders-api",
                            "system_layer": "backend",
                        }
                    ],
                    "primary_working_repo_ids": ["orders-api"],
                }
            )
            review_payload = _build_distributed_review_payload(answers, draft_payload)
            manifest_path = write_approved_manifest(
                context_pack_dir,
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
            )

            repo = json.loads(manifest_path.read_text(encoding="utf-8"))["repositories"][0]
            self.assertEqual(repo["repo_category"], "service")
            self.assertFalse(repo["repo_category_authored"])

    def test_write_manifest_carries_discovered_dotnet_package_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "shared-estate"
            package_repo = discovery_root / "shared-sdk"
            self.create_dotnet_project(
                package_repo,
                (
                    '<Project Sdk="Microsoft.NET.Sdk">'
                    "<PropertyGroup><PackageId>Shared.Sdk</PackageId></PropertyGroup>"
                    "</Project>"
                ),
            )
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "shared-estate",
                    "estate_name": "Shared Estate",
                    "repositories": [
                        {
                            "repo_root": str(package_repo),
                            "repo_name": "Shared SDK",
                            "repo_id": "shared-sdk",
                            "system_layer": "shared",
                        }
                    ],
                    "primary_working_repo_ids": ["shared-sdk"],
                }
            )
            review_payload = _build_distributed_review_payload(answers, draft_payload)
            manifest_path = write_approved_manifest(
                context_pack_dir,
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
            )

            repo = json.loads(manifest_path.read_text(encoding="utf-8"))["repositories"][0]
            self.assertEqual(repo["repo_category"], "library")
            self.assertFalse(repo["repo_category_authored"])

    def test_distributed_manifest_rejects_authored_conflicting_repo_focus(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            web_repo = discovery_root / "services" / "orders-web"
            self.create_git_repo(api_repo)
            self.create_git_repo(web_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            review_payload = {
                "context_pack_id": "orders-estate",
                "display_name": "Orders Estate",
                "estate_type": "distributed-platform",
                "primary_working_repo_ids": ["services-orders-api"],
                "repositories": [
                    {
                        "repo_id": "services-orders-api",
                        "system_layer": "backend",
                        "repo_focus": "support",
                        "repo_focus_authored": True,
                    },
                    {
                        "repo_id": "services-orders-web",
                        "system_layer": "frontend",
                    },
                ],
            }

            with self.assertRaisesRegex(
                ValueError,
                "primary_working_repo_ids and repo_focus entries are inconsistent",
            ):
                build_approved_manifest(
                    draft_payload,
                    review_payload,
                    approved_at="2026-03-08T01:00:00Z",
                    context_pack_dir=context_pack_dir,
                )

    def test_distributed_manifest_normalizes_non_authored_focus_from_primary_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            web_repo = discovery_root / "services" / "orders-web"
            self.create_git_repo(api_repo)
            self.create_git_repo(web_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            review_payload = {
                "context_pack_id": "orders-estate",
                "display_name": "Orders Estate",
                "estate_type": "distributed-platform",
                "primary_working_repo_ids": ["services-orders-api"],
                "repositories": [
                    {
                        "repo_id": "services-orders-api",
                        "system_layer": "backend",
                        "repo_focus": "support",
                        "repo_focus_authored": False,
                        "repository_type": "support",
                        "repository_type_authored": False,
                    },
                    {
                        "repo_id": "services-orders-web",
                        "system_layer": "frontend",
                    },
                ],
            }

            manifest_path = write_approved_manifest(
                context_pack_dir,
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
            )

            repo_map = {
                repo["repo_id"]: repo
                for repo in json.loads(manifest_path.read_text(encoding="utf-8"))["repositories"]
            }
            self.assertEqual(repo_map["services-orders-api"]["repo_focus"], "primary")
            self.assertEqual(repo_map["services-orders-api"]["repository_type"], "primary")
            self.assertFalse(repo_map["services-orders-api"]["repo_focus_authored"])
            self.assertEqual(repo_map["services-orders-web"]["repo_focus"], "support")
            self.assertEqual(repo_map["services-orders-web"]["repository_type"], "support")
            self.assertFalse(repo_map["services-orders-web"]["repo_focus_authored"])

    def test_bootstrap_review_payload_category_fallback_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            answer_repo = discovery_root / "answer"
            candidate_repo = discovery_root / "candidate"
            layer_repo = discovery_root / "layer"
            for repo_root in (answer_repo, candidate_repo, layer_repo):
                self.create_git_repo(repo_root)

            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "category-estate",
                    "estate_name": "Category Estate",
                    "repositories": [
                        {
                            "repo_root": str(answer_repo),
                            "repo_name": "Answer",
                            "repo_id": "answer",
                            "system_layer": "backend",
                            "repo_category": "tool",
                            "repo_category_authored": True,
                        },
                        {
                            "repo_root": str(candidate_repo),
                            "repo_name": "Candidate",
                            "repo_id": "candidate",
                            "system_layer": "backend",
                        },
                        {
                            "repo_root": str(layer_repo),
                            "repo_name": "Layer",
                            "repo_id": "layer",
                            "system_layer": "backend",
                        },
                    ],
                    "primary_working_repo_ids": ["answer"],
                }
            )
            review_payload = _build_distributed_review_payload(
                answers,
                {
                    "candidate_repos": [
                        {
                            "repo_id": "answer",
                            "repo_name": "Answer",
                            "path": str(answer_repo.resolve()),
                            "relative_path": "answer",
                            "high_signal_paths": [],
                            "repo_category": "library",
                        },
                        {
                            "repo_id": "candidate",
                            "repo_name": "Candidate",
                            "path": str(candidate_repo.resolve()),
                            "relative_path": "candidate",
                            "high_signal_paths": [],
                            "repo_category": "library",
                        },
                        {
                            "repo_id": "layer",
                            "repo_name": "Layer",
                            "path": str(layer_repo.resolve()),
                            "relative_path": "layer",
                            "high_signal_paths": [],
                        },
                    ]
                },
            )

            repo_map = {repo["repo_id"]: repo for repo in review_payload["repositories"]}
            self.assertEqual(repo_map["answer"]["repo_category"], "tool")
            self.assertTrue(repo_map["answer"]["repo_category_authored"])
            self.assertEqual(repo_map["candidate"]["repo_category"], "library")
            self.assertFalse(repo_map["candidate"]["repo_category_authored"])
            self.assertEqual(repo_map["layer"]["repo_category"], "service")
            self.assertFalse(repo_map["layer"]["repo_category_authored"])

    def test_distributed_non_authored_unknown_category_uses_candidate_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            service_repo = discovery_root / "orders-api"
            self.create_git_repo(service_repo)

            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "category-estate",
                    "estate_name": "Category Estate",
                    "repositories": [
                        {
                            "repo_root": str(service_repo),
                            "repo_name": "Orders API",
                            "repo_id": "orders-api",
                            "system_layer": "backend",
                            "repo_category": "unknown",
                            "repo_category_authored": False,
                        }
                    ],
                    "primary_working_repo_ids": ["orders-api"],
                }
            )
            review_payload = _build_distributed_review_payload(
                answers,
                {
                    "candidate_repos": [
                        {
                            "repo_id": "orders-api",
                            "repo_name": "Orders API",
                            "path": str(service_repo.resolve()),
                            "relative_path": "orders-api",
                            "high_signal_paths": [],
                            "repo_category": "service",
                        }
                    ]
                },
            )

            repo = review_payload["repositories"][0]
            self.assertEqual(repo["repo_category"], "service")
            self.assertFalse(repo["repo_category_authored"])

    def test_authored_unknown_category_stays_authoritative(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            service_repo = discovery_root / "orders-api"
            self.create_git_repo(service_repo)

            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "category-estate",
                    "estate_name": "Category Estate",
                    "repositories": [
                        {
                            "repo_root": str(service_repo),
                            "repo_name": "Orders API",
                            "repo_id": "orders-api",
                            "system_layer": "backend",
                            "repo_category": "unknown",
                            "repo_category_authored": True,
                        }
                    ],
                    "primary_working_repo_ids": ["orders-api"],
                }
            )
            review_payload = _build_distributed_review_payload(
                answers,
                {
                    "candidate_repos": [
                        {
                            "repo_id": "orders-api",
                            "repo_name": "Orders API",
                            "path": str(service_repo.resolve()),
                            "relative_path": "orders-api",
                            "high_signal_paths": [],
                            "repo_category": "service",
                        }
                    ]
                },
            )

            repo = review_payload["repositories"][0]
            self.assertEqual(repo["repo_category"], "unknown")
            self.assertTrue(repo["repo_category_authored"])

    def test_bootstrap_monolith_category_does_not_change_focus_areas(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            (discovery_root / "docs").mkdir(parents=True)

            payload = bootstrap_context_pack(
                context_pack_dir,
                {
                    "context_pack_id": "mono-pack",
                    "estate_name": "Mono Pack",
                    "repositories": [
                        {
                            "repo_root": str(discovery_root),
                            "repo_name": "Mono Repo",
                            "repo_id": "mono-repo",
                            "system_layer": "backend",
                        }
                    ],
                    "focusable_areas": [
                        {
                            "focus_id": "services-billing",
                            "focus_name": "Billing",
                            "relative_path": "services/billing",
                            "path": str(discovery_root / "services" / "billing"),
                            "focus_type": "service",
                            "repository_type": "primary",
                        },
                        {
                            "focus_id": "docs",
                            "focus_name": "Docs",
                            "relative_path": "docs",
                            "path": str(discovery_root / "docs"),
                            "focus_type": "docs",
                            "repository_type": "support",
                        },
                    ],
                    "primary_focus_area_ids": ["services-billing"],
                },
                discovery_root,
                requested_mode="monolith",
            )

            self.assertEqual(payload["primary_focus_area_ids"], ["services-billing"])
            manifest = json.loads(Path(payload["manifest_path"]).read_text(encoding="utf-8"))
            root_repo = manifest["repositories"][0]
            focus_area_map = {
                area["focus_id"]: area for area in manifest["focusable_areas"]
            }
            self.assertEqual(manifest["primary_focus_area_ids"], ["services-billing"])
            self.assertEqual(root_repo["repo_category"], "service")
            self.assertFalse(root_repo["repo_category_authored"])
            self.assertEqual(
                focus_area_map["services-billing"]["repository_type"],
                "primary",
            )
            self.assertEqual(focus_area_map["docs"]["repository_type"], "support")
            self.assertNotIn("repo_category", focus_area_map["services-billing"])
            self.assertNotIn("repo_category", focus_area_map["docs"])

    def test_monolith_non_authored_unknown_category_uses_probe_category(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_dotnet_project(
                discovery_root,
                '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
            )

            payload = bootstrap_context_pack(
                context_pack_dir,
                {
                    "context_pack_id": "mono-pack",
                    "estate_name": "Mono Pack",
                    "repositories": [
                        {
                            "repo_root": str(discovery_root),
                            "repo_name": "Mono Repo",
                            "repo_id": "mono-repo",
                            "system_layer": "backend",
                            "repo_category": "unknown",
                            "repo_category_authored": False,
                        }
                    ],
                    "focusable_areas": [
                        {
                            "focus_id": "services-billing",
                            "focus_name": "Billing",
                            "relative_path": "services/billing",
                            "path": str(discovery_root / "services" / "billing"),
                            "focus_type": "service",
                            "repository_type": "primary",
                        },
                    ],
                    "primary_focus_area_ids": ["services-billing"],
                },
                discovery_root,
                requested_mode="monolith",
            )

            manifest = json.loads(Path(payload["manifest_path"]).read_text(encoding="utf-8"))
            root_repo = manifest["repositories"][0]
            self.assertEqual(root_repo["repo_category"], "service")
            self.assertFalse(root_repo["repo_category_authored"])

    def test_bootstrap_monolith_platform_extra_repository_category_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            deploy_root = Path(temp_root) / "deploy"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            deploy_root.mkdir(parents=True)
            (discovery_root / "services" / "billing").mkdir(parents=True)

            payload = bootstrap_context_pack(
                context_pack_dir,
                {
                    "context_pack_id": "mono-platform-pack",
                    "estate_name": "Mono Platform Pack",
                    "estate_type": "monolith-platform",
                    "repositories": [
                        {
                            "repo_root": str(discovery_root),
                            "repo_name": "Mono Repo",
                            "repo_id": "mono-repo",
                            "system_layer": "shared",
                        },
                        {
                            "repo_root": str(deploy_root),
                            "repo_name": "Deploy",
                            "repo_id": "deploy",
                            "system_layer": "infrastructure",
                        },
                    ],
                    "focusable_areas": [
                        {
                            "focus_id": "services-billing",
                            "focus_name": "Billing",
                            "relative_path": "services/billing",
                            "path": str(discovery_root / "services" / "billing"),
                            "focus_type": "service",
                        },
                    ],
                    "primary_focus_area_ids": ["services-billing"],
                },
                discovery_root,
                requested_mode="monolith",
            )

            manifest = json.loads(Path(payload["manifest_path"]).read_text(encoding="utf-8"))
            repo_map = {repo["repo_id"]: repo for repo in manifest["repositories"]}
            self.assertEqual(repo_map["deploy"]["repo_category"], "infrastructure")
            self.assertFalse(repo_map["deploy"]["repo_category_authored"])
            self.assertEqual(manifest["primary_focus_area_ids"], ["services-billing"])


if __name__ == "__main__":
    unittest.main()
