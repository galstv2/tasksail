from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate_discovery import discover_estate
from src.backend.mcp.context_estate_draft_index import write_draft_artifact
from src.backend.mcp.context_estate_manifest import (
    approve_manifest_from_files,
    build_approved_manifest,
    write_approved_manifest,
)
from src.backend.mcp.context_pack_bootstrap import (
    _build_distributed_review_payload,
    bootstrap_context_pack,
    normalize_bootstrap_answers,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
APPROVE_SCRIPT_PATH = (
    REPO_ROOT / "src" / "backend" / "scripts" / "python" / "approve-context-estate-manifest.py"
)
PLAN_SCRIPT_PATH = REPO_ROOT / "src" / "backend" / "scripts" / "python" / "plan-qmd-seeding.py"


class ContextEstateManifestTests(unittest.TestCase):
    def create_git_repo(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        (path / ".git").mkdir()

    def run_approve_script(
        self,
        *args: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(APPROVE_SCRIPT_PATH), *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def run_plan_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(PLAN_SCRIPT_PATH), *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_distributed_manifest_approval_from_reviewed_draft(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            web_repo = discovery_root / "services" / "orders-web"
            self.create_git_repo(api_repo)
            self.create_git_repo(web_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            write_draft_artifact(
                context_pack_dir,
                draft_payload,
                generated_at="2026-03-08T00:00:00Z",
            )
            review_payload = {
                "context_pack_id": "orders-estate",
                "display_name": "Orders Estate",
                "estate_type": "distributed-platform",
                "default_scope_mode": "focused",
                "primary_working_repo_ids": ["services-orders-api"],
                "repositories": [
                    {
                        "repo_id": "services-orders-api",
                        "system_layer": "backend",
                        "repo_role": "backend-service",
                        "service_name": "orders-api",
                        "default_focusable": True,
                        "adjacent_repo_ids": ["services-orders-web"],
                    },
                    {
                        "repo_id": "services-orders-web",
                        "system_layer": "frontend",
                        "repo_role": "frontend",
                        "service_name": "orders-web",
                        "depends_on_repo_ids": ["services-orders-api"],
                        "adjacent_repo_ids": [
                            "services-orders-api",
                            "services-orders-api",
                        ],
                    },
                ],
            }

            manifest_path = write_approved_manifest(
                context_pack_dir,
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
            )

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["manifest_status"], "approved")
            self.assertEqual(manifest["estate_type"], "distributed-platform")
            self.assertEqual(
                manifest["primary_working_repo_ids"],
                ["services-orders-api"],
            )
            self.assertEqual(len(manifest["repositories"]), 2)
            repo_map = {
                repo["repo_id"]: repo for repo in manifest["repositories"]
            }
            self.assertEqual(
                repo_map["services-orders-api"]["local_paths"],
                [{"host": str(api_repo.resolve()), "container": None}],
            )
            self.assertEqual(
                repo_map["services-orders-api"]["repository_type"],
                "primary",
            )
            self.assertEqual(
                repo_map["services-orders-web"]["depends_on_repo_ids"],
                ["services-orders-api"],
            )
            self.assertEqual(
                repo_map["services-orders-web"]["adjacent_repo_ids"],
                ["services-orders-api"],
            )
            self.assertEqual(
                repo_map["services-orders-web"]["repository_type"],
                "support",
            )

    def test_monolith_manifest_approval_from_reviewed_draft(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            (discovery_root / "services" / "identity").mkdir(parents=True)
            (discovery_root / "docs").mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="monolith")
            write_draft_artifact(
                context_pack_dir,
                draft_payload,
                generated_at="2026-03-08T00:00:00Z",
            )
            review_payload = {
                "context_pack_id": "mono-pack",
                "display_name": "Mono Pack",
                "estate_type": "monolith",
                "repository": {
                    "repo_id": "mono-repo",
                    "repo_name": "Mono Repo",
                    "system_layer": "shared",
                    "document_paths": ["docs"],
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

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(manifest["estate_type"], "monolith")
            self.assertEqual(
                manifest["repositories"][0]["repo_id"],
                "mono-repo",
            )
            self.assertEqual(
                manifest["repositories"][0]["local_paths"],
                [str(discovery_root.resolve())],
            )
            self.assertEqual(
                manifest["repositories"][0]["repository_type"],
                "primary",
            )
            self.assertEqual(
                manifest["primary_focus_area_ids"],
                ["services-billing"],
            )
            self.assertEqual(
                [area["focus_id"] for area in manifest["focusable_areas"]],
                ["services-billing", "services-identity"],
            )
            focus_area_map = {
                area["focus_id"]: area for area in manifest["focusable_areas"]
            }
            self.assertEqual(
                focus_area_map["services-billing"]["repository_type"],
                "primary",
            )
            self.assertEqual(
                focus_area_map["services-identity"]["repository_type"],
                "primary",
            )

    def test_monolith_platform_manifest_includes_infrastructure_repositories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            deploy_root = Path(temp_root) / "deploy"
            context_pack_dir = Path(temp_root) / "contexts" / "mp-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            deploy_root.mkdir(parents=True)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="monolith")
            write_draft_artifact(context_pack_dir, draft_payload, generated_at="2026-03-08T00:00:00Z")
            review_payload = {
                "context_pack_id": "mp-pack",
                "display_name": "MP Pack",
                "estate_type": "monolith-platform",
                "repository": {"repo_id": "mono-repo", "repo_name": "Mono Repo", "system_layer": "shared"},
                "repositories": [{
                    "repo_id": "deploy", "repo_name": "Deploy", "path": str(deploy_root.resolve()),
                    "system_layer": "infrastructure", "languages": ["yaml"],
                }],
                "focusable_areas": [{"relative_path": "services/billing", "default_focusable": True}],
            }

            manifest = build_approved_manifest(
                draft_payload, review_payload,
                approved_at="2026-03-08T01:00:00Z", context_pack_dir=context_pack_dir,
            )

            self.assertEqual(manifest["estate_type"], "monolith-platform")
            self.assertEqual(len(manifest["repositories"]), 2)
            repos_by_id = {repo["repo_id"]: repo for repo in manifest["repositories"]}
            self.assertEqual(repos_by_id["mono-repo"]["repository_type"], "primary")
            self.assertEqual(repos_by_id["deploy"]["system_layer"], "infrastructure")
            self.assertEqual(repos_by_id["deploy"]["local_paths"], [str(deploy_root.resolve())])
            self.assertEqual(repos_by_id["deploy"]["repository_type"], "support")
            self.assertEqual(repos_by_id["deploy"]["languages"], ["yaml"])

    def test_monolith_manifest_preserves_focus_area_repository_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "mono-repo"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"
            self.create_git_repo(discovery_root)
            (discovery_root / "services" / "billing").mkdir(parents=True)
            (discovery_root / "docs").mkdir(parents=True)
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
                "focusable_areas": [
                    {
                        "relative_path": "services/billing",
                        "repository_type": "primary",
                    },
                    {
                        "relative_path": "docs",
                    },
                ],
            }

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            focus_area_map = {
                area["focus_id"]: area for area in manifest["focusable_areas"]
            }
            self.assertEqual(
                focus_area_map["services-billing"]["repository_type"],
                "primary",
            )
            self.assertEqual(
                focus_area_map["docs"]["repository_type"],
                "support",
            )

    def test_missing_required_fields_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            self.create_git_repo(api_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            review_payload = {
                "context_pack_id": "orders-estate",
                "display_name": "Orders Estate",
                "estate_type": "distributed-platform",
            }

            with self.assertRaisesRegex(
                ValueError,
                "Approved distributed manifest requires a non-empty",
            ):
                build_approved_manifest(
                    draft_payload,
                    review_payload,
                    approved_at="2026-03-08T01:00:00Z",
                    context_pack_dir=context_pack_dir,
                )

    def test_distributed_manifest_defaults_first_repo_to_primary(self) -> None:
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
                "repositories": [
                    {
                        "repo_id": "services-orders-api",
                        "system_layer": "backend",
                    },
                    {
                        "repo_id": "services-orders-web",
                        "system_layer": "frontend",
                    },
                ],
            }

            manifest = build_approved_manifest(
                draft_payload,
                review_payload,
                approved_at="2026-03-08T01:00:00Z",
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(
                manifest["primary_working_repo_ids"],
                ["services-orders-api"],
            )
            repo_map = {
                repo["repo_id"]: repo for repo in manifest["repositories"]
            }
            self.assertEqual(
                repo_map["services-orders-api"]["repository_type"],
                "primary",
            )
            self.assertEqual(
                repo_map["services-orders-web"]["repository_type"],
                "support",
            )

    def test_distributed_manifest_rejects_inconsistent_repository_type(
        self,
    ) -> None:
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
                        "repository_type": "support",
                    },
                    {
                        "repo_id": "services-orders-web",
                        "system_layer": "frontend",
                    },
                ],
            }

            with self.assertRaisesRegex(
                ValueError,
                "primary_working_repo_ids and repository_type entries are inconsistent",
            ):
                build_approved_manifest(
                    draft_payload,
                    review_payload,
                    approved_at="2026-03-08T01:00:00Z",
                    context_pack_dir=context_pack_dir,
                )

    def test_bootstrap_answers_preserve_repository_type_when_provided(
        self,
    ) -> None:
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
                            "repositoryType": "Primary",
                        }
                    ],
                    "primary_working_repo_ids": ["orders-api"],
                }
            )

            self.assertEqual(
                normalized["repositories"][0]["repository_type"],
                "primary",
            )

    def test_bootstrap_review_payload_omits_repository_type_when_unset(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            repo_root = discovery_root / "orders-api"
            self.create_git_repo(repo_root)
            answers = normalize_bootstrap_answers(
                {
                    "context_pack_id": "orders-estate",
                    "estate_name": "Orders Estate",
                    "repositories": [
                        {
                            "repo_root": str(repo_root),
                            "repo_name": "Orders API",
                            "repo_id": "orders-api",
                            "system_layer": "backend",
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
                            "path": str(repo_root.resolve()),
                            "relative_path": "orders-api",
                            "high_signal_paths": [],
                        }
                    ]
                },
            )

            self.assertIn(
                "repository_type",
                review_payload["repositories"][0],
            )

    def test_focusable_area_contract_validation_rejects_unknown_targets(
        self,
    ) -> None:
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
                "repository": {
                    "repo_id": "mono-repo",
                    "repo_name": "Mono Repo",
                    "system_layer": "shared",
                },
                "focusable_areas": [
                    {"relative_path": "services/billing"},
                    {"focus_id": "missing-focus"},
                ],
            }

            with self.assertRaisesRegex(
                ValueError,
                "Approved focus area entry must reference a discovered "
                "candidate",
            ):
                build_approved_manifest(
                    draft_payload,
                    review_payload,
                    approved_at="2026-03-08T01:00:00Z",
                    context_pack_dir=context_pack_dir,
                )

    def test_bootstrap_flow_writes_manifest_and_supports_plan_reload(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            self.create_git_repo(api_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            write_draft_artifact(
                context_pack_dir,
                draft_payload,
                generated_at="2026-03-08T00:00:00Z",
            )
            review_file = (
                context_pack_dir
                / "qmd"
                / "bootstrap"
                / "reviewed-input.json"
            )
            review_file.parent.mkdir(parents=True, exist_ok=True)
            review_file.write_text(
                json.dumps(
                    {
                        "context_pack_id": "orders-estate",
                        "display_name": "Orders Estate",
                        "estate_type": "distributed-platform",
                        "repositories": [
                            {
                                "repo_id": "services-orders-api",
                                "system_layer": "backend",
                                "repo_role": "backend-service",
                                "default_focusable": True,
                            }
                        ],
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            completed = self.run_approve_script(
                "--context-pack-dir",
                str(context_pack_dir),
                "--review-file",
                str(review_file),
                "--format",
                "json",
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            approval_payload = json.loads(completed.stdout)
            self.assertEqual(
                approval_payload["context_pack_id"],
                "orders-estate",
            )

            plan_completed = self.run_plan_script(
                "--context-pack-dir",
                str(context_pack_dir),
                "--format",
                "json",
            )
            self.assertEqual(
                plan_completed.returncode,
                0,
                msg=plan_completed.stderr,
            )
            plan_payload = json.loads(plan_completed.stdout)
            self.assertEqual(plan_payload["context_pack_id"], "orders-estate")
            self.assertEqual(plan_payload["repository_count"], 1)

    def test_bootstrap_monolith_allows_missing_root_and_authored_focus_areas(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "brand-new-monolith"
            context_pack_dir = Path(temp_root) / "contexts" / "mono-pack"

            payload = bootstrap_context_pack(
                context_pack_dir,
                {
                    "context_pack_id": "mono-pack",
                    "estate_name": "Mono Pack",
                    "repositories": [
                        {
                            "repo_root": str(discovery_root),
                            "repo_name": "Brand New Monolith",
                            "repo_id": "brand-new-monolith",
                            "system_layer": "shared",
                            "repository_type": "primary",
                        }
                    ],
                    "focusable_areas": [
                        {
                            "focus_id": "core-app",
                            "focus_name": "Core App",
                            "relative_path": ".",
                            "path": str(discovery_root),
                            "focus_type": "service",
                            "default_focusable": True,
                            "activation_priority": 100,
                        },
                        {
                            "focus_id": "shared-lib",
                            "focus_name": "Shared Lib",
                            "relative_path": "shared/lib",
                            "path": str(discovery_root / "shared" / "lib"),
                            "focus_type": "library",
                            "activation_priority": 90,
                        },
                    ],
                    "primary_focus_area_ids": ["core-app"],
                },
                discovery_root,
                requested_mode="monolith",
            )

            self.assertTrue(discovery_root.is_dir())
            self.assertEqual(payload["estate_type"], "monolith")
            self.assertEqual(payload["discovery_root"], str(discovery_root.resolve()))
            self.assertEqual(payload["focus_target_count"], 2)
            self.assertEqual(payload["primary_focus_area_ids"], ["core-app"])

            manifest = json.loads(
                Path(payload["manifest_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["primary_focus_area_ids"], ["core-app"])
            self.assertEqual(
                [area["focus_id"] for area in manifest["focusable_areas"]],
                ["core-app", "shared-lib"],
            )
            focus_area_map = {
                area["focus_id"]: area for area in manifest["focusable_areas"]
            }
            self.assertEqual(focus_area_map["core-app"]["relative_path"], ".")
            self.assertEqual(
                focus_area_map["core-app"]["repository_type"],
                "primary",
            )
            self.assertEqual(
                focus_area_map["shared-lib"]["repository_type"],
                "support",
            )

    def test_approve_manifest_from_files_writes_deterministic_manifest(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            discovery_root = Path(temp_root) / "estate-root"
            context_pack_dir = Path(temp_root) / "contexts" / "orders-estate"
            api_repo = discovery_root / "services" / "orders-api"
            self.create_git_repo(api_repo)
            context_pack_dir.mkdir(parents=True)

            draft_payload = discover_estate(discovery_root, mode="distributed")
            write_draft_artifact(
                context_pack_dir,
                draft_payload,
                generated_at="2026-03-08T00:00:00Z",
            )
            review_file = context_pack_dir / "review.json"
            review_file.write_text(
                json.dumps(
                    {
                        "context_pack_id": "orders-estate",
                        "display_name": "Orders Estate",
                        "repositories": [
                            {
                                "repo_id": "services-orders-api",
                                "system_layer": "backend",
                            }
                        ],
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            manifest_path, manifest = approve_manifest_from_files(
                context_pack_dir=context_pack_dir,
                review_file=review_file,
                approved_at="2026-03-08T01:00:00Z",
            )

            self.assertEqual(
                manifest_path,
                context_pack_dir.resolve() / "qmd" / "repo-sources.json",
            )
            self.assertEqual(manifest["approved_at"], "2026-03-08T01:00:00Z")
            self.assertEqual(
                manifest["repositories"][0]["repo_id"],
                "services-orders-api",
            )


if __name__ == "__main__":
    unittest.main()
