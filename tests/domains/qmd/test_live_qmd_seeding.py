from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_repo_context_app():
    from src.backend.mcp.repo_context_mcp import app
    return app


class LiveQmdSeedingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = load_repo_context_app()

    def create_context_pack(self, temp_dir: Path, repositories: list[dict[str, object]]) -> Path:
        context_pack_dir = temp_dir / "context-pack"
        (context_pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
        manifest = {
            "context_pack_id": "sample-org",
            "qmd_scope_root": "qmd/context-packs/sample-org",
            "repositories": repositories,
        }
        (context_pack_dir / "qmd" / "repo-sources.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
        return context_pack_dir

    def run_seed(
        self,
        workspace_root: Path,
        *,
        context_pack_dir: str,
        plan_mode: str = "manifest-only",
    ) -> dict[str, object]:
        # Reset the cached seeding service so create_seeding_service() picks
        # up the patched Path.cwd() and creates a service whose workspace_root
        # matches this test's temp directory.
        self.app._SEEDING_SERVICE = None
        self.app._ARCHIVE_SERVICE = None
        with mock.patch("pathlib.Path.cwd", return_value=workspace_root):
            return self.app.execute_seed_run(
                context_pack_dir=context_pack_dir,
                plan_mode=plan_mode,
            )

    def test_live_seed_writes_repo_summary_and_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "billing-api"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "docs").mkdir(parents=True)
            (repo_dir / "src" / "app.py").write_text("print('hello')\n", encoding="utf-8")
            (repo_dir / "docs" / "architecture.md").write_text(
                "# Billing API\n\nArchitecture summary.\n",
                encoding="utf-8",
            )

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "owner": "sample-org",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "bounded_context": "billing",
                        "artifact_roots": ["src"],
                        "document_paths": ["docs"],
                    }
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertEqual(report["seeded_repo_count"], 1)

            scope_dir = context_pack_dir / "qmd" / "context-packs" / "sample-org"
            summary_path = scope_dir / "canonical" / "repos" / "billing-api" / "repo-summary.md"
            artifact_path = scope_dir / "estate" / "backend" / "billing-api" / "records" / "src" / "app.py.json"
            document_record_path = scope_dir / "estate" / "documents" / "billing-api" / "records" / "docs" / "architecture.md.json"
            conventions_path = scope_dir / "canonical" / "context-pack" / "codepmse-conventions.md"
            conventions_record_path = scope_dir / "canonical" / "context-pack" / "codepmse-conventions.md.record.json"
            context_pack_index_path = scope_dir / "indexes" / "context-pack-index.json"
            repositories_index_path = scope_dir / "indexes" / "repositories.json"
            tasks_index_path = scope_dir / "indexes" / "tasks.json"
            lineage_index_path = scope_dir / "indexes" / "lineage.json"
            self.assertTrue(summary_path.exists())
            self.assertTrue(artifact_path.exists())
            self.assertTrue(document_record_path.exists())
            self.assertTrue(conventions_path.exists())
            self.assertTrue(conventions_record_path.exists())
            self.assertTrue(context_pack_index_path.exists())
            self.assertTrue(repositories_index_path.exists())
            self.assertTrue(tasks_index_path.exists())
            self.assertTrue(lineage_index_path.exists())

            self.assertEqual(report["conventions_summary"]["status"], "created")
            self.assertEqual(
                Path(report["conventions_summary"]["markdown_path"]).resolve(),
                conventions_path.resolve(),
            )

            conventions_record = json.loads(
                conventions_record_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                conventions_record["summary_scope"],
                "context-pack",
            )

            artifact_record = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact_record["repo_name"], "billing-api")
            self.assertEqual(artifact_record["context_pack_id"], "sample-org")
            self.assertEqual(artifact_record["freshness_status"], "fresh")

            repositories_index = json.loads(repositories_index_path.read_text(encoding="utf-8"))
            self.assertEqual(repositories_index["repositories"][0]["system_layer"], "backend")
            self.assertEqual(
                Path(report["index_outputs"]["context_pack_index"]).resolve(),
                context_pack_index_path.resolve(),
            )

    def test_live_seed_marker_exists_during_seed_and_is_removed_after_success(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "billing-api"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "src" / "app.py").write_text("print('hello')\n", encoding="utf-8")
            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "local_paths": [str(repo_dir)],
                        "artifact_roots": ["src"],
                    }
                ],
            )
            marker_path = context_pack_dir / ".reseed-in-progress.json"
            service = self.app.create_seeding_service(temp_dir)
            original_seed_repository = service.seed_repository

            def observing_seed_repository(**kwargs):
                self.assertTrue(marker_path.exists())
                payload = json.loads(marker_path.read_text(encoding="utf-8"))
                self.assertIn("started_at", payload)
                self.assertIn("pid", payload)
                self.assertIn("host", payload)
                return original_seed_repository(**kwargs)

            service.seed_repository = mock.Mock(side_effect=observing_seed_repository)
            self.app._SEEDING_SERVICE = service
            self.app._ARCHIVE_SERVICE = None

            report = self.app.execute_seed_run(
                context_pack_dir=str(context_pack_dir),
                plan_mode="manifest-only",
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertFalse(marker_path.exists())

    def test_live_seed_marker_is_removed_after_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            context_pack_dir = self.create_context_pack(temp_dir, [])
            marker_path = context_pack_dir / ".reseed-in-progress.json"
            service = self.app.create_seeding_service(temp_dir)
            self.app._SEEDING_SERVICE = service
            self.app._ARCHIVE_SERVICE = None

            with mock.patch.object(
                service,
                "get_live_plan",
                side_effect=RuntimeError("seed failed"),
            ):
                with self.assertRaises(RuntimeError):
                    self.app.execute_seed_run(
                        context_pack_dir=str(context_pack_dir),
                        plan_mode="manifest-only",
                    )

            self.assertFalse(marker_path.exists())

    def test_live_seed_does_not_rewrite_existing_conventions_summary(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "billing-api"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "src" / "app.py").write_text(
                "print('hello')\n",
                encoding="utf-8",
            )

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )

            first_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(first_report["conventions_summary"]["status"], "created")

            conventions_path = (
                context_pack_dir
                / "qmd"
                / "context-packs"
                / "sample-org"
                / "canonical"
                / "context-pack"
                / "codepmse-conventions.md"
            )
            conventions_record_path = conventions_path.with_name(
                "codepmse-conventions.md.record.json"
            )
            preserved_content = "# Preserved conventions\n\nManual note.\n"
            conventions_path.write_text(
                preserved_content,
                encoding="utf-8",
            )
            original_record = json.loads(
                conventions_record_path.read_text(encoding="utf-8")
            )

            second_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(second_report["conventions_summary"]["status"], "existing")
            self.assertEqual(
                conventions_path.read_text(encoding="utf-8"),
                preserved_content,
            )
            self.assertEqual(
                json.loads(conventions_record_path.read_text(encoding="utf-8")),
                original_record,
            )

    def test_live_seed_defers_conventions_when_all_repos_are_blocked(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "missing-repo",
                        "repo_name": "missing-repo",
                        "local_paths": [str(temp_dir / "does-not-exist")],
                        "system_layer": "backend",
                        "languages": ["python"],
                    }
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "completed-with-blocked-repos")
            self.assertEqual(report["conventions_summary"]["status"], "deferred")
            self.assertFalse(
                (
                    context_pack_dir
                    / "qmd"
                    / "context-packs"
                    / "sample-org"
                    / "canonical"
                    / "context-pack"
                    / "codepmse-conventions.md"
                ).exists()
            )

    def test_live_seed_skips_conventions_when_seed_input_is_too_thin(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "empty-repo"
            repo_dir.mkdir(parents=True)

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "empty-repo",
                        "repo_name": "empty-repo",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                    }
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertEqual(
                report["conventions_summary"]["status"],
                "insufficient-inputs",
            )
            self.assertFalse(
                (
                    context_pack_dir
                    / "qmd"
                    / "context-packs"
                    / "sample-org"
                    / "canonical"
                    / "context-pack"
                    / "codepmse-conventions.md"
                ).exists()
            )

    def test_live_seed_accepts_explicit_absolute_external_context_pack(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            workspace_root = temp_dir / "workspace"
            workspace_root.mkdir(parents=True, exist_ok=True)

            external_root = temp_dir / "external"
            repo_dir = external_root / "billing-api"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "src" / "app.py").write_text(
                "print('hello')\n",
                encoding="utf-8",
            )

            context_pack_dir = self.create_context_pack(
                external_root,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )

            report = self.run_seed(
                workspace_root,
                context_pack_dir=str(context_pack_dir.resolve()),
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertTrue(
                (
                    context_pack_dir
                    / "qmd"
                    / "context-packs"
                    / "sample-org"
                    / "indexes"
                    / "context-pack-index.json"
                ).exists()
            )

    def test_live_seed_renders_mixed_frontend_surfaces_and_backend_signals(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            frontend_repo = temp_dir / "customer-portal"
            backend_repo = temp_dir / "platform-api"

            (frontend_repo / "legacy-ui" / "templates").mkdir(parents=True)
            (frontend_repo / "web" / "src" / "components").mkdir(
                parents=True
            )
            (backend_repo / "src" / "middleware").mkdir(parents=True)
            (backend_repo / "src" / "registry").mkdir(parents=True)
            (backend_repo / "src" / "repositories").mkdir(parents=True)

            (frontend_repo / "legacy-ui" / "orders.module.js").write_text(
                "angular.module('orders', [])\n",
                encoding="utf-8",
            )
            (
                frontend_repo / "legacy-ui" / "templates" / "orders.tpl.html"
            ).write_text("<div>orders</div>\n", encoding="utf-8")
            (frontend_repo / "web" / "src" / "App.tsx").write_text(
                "export function App() { return <main />; }\n",
                encoding="utf-8",
            )
            (
                frontend_repo / "web" / "src" / "components" / "OrderPage.tsx"
            ).write_text(
                "export function OrderPage() { return <section />; }\n",
                encoding="utf-8",
            )
            (backend_repo / "src" / "middleware" / "auth.py").write_text(
                "def auth_middleware(request):\n    return request\n",
                encoding="utf-8",
            )
            (backend_repo / "src" / "registry" / "container.py").write_text(
                "class Container:\n    pass\n",
                encoding="utf-8",
            )
            (
                backend_repo
                / "src"
                / "repositories"
                / "order_repository.py"
            ).write_text(
                "class OrderRepository:\n    pass\n",
                encoding="utf-8",
            )

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "customer-portal",
                        "repo_name": "customer-portal",
                        "owner": "sample-org",
                        "local_paths": [str(frontend_repo)],
                        "system_layer": "frontend",
                        "languages": ["javascript", "typescript", "html"],
                        "artifact_roots": ["legacy-ui", "web"],
                        "tags": ["framework:react", "framework:angularjs"],
                    },
                    {
                        "repo_id": "platform-api",
                        "repo_name": "platform-api",
                        "owner": "sample-org",
                        "local_paths": [str(backend_repo)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    },
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertEqual(report["seeded_repo_count"], 2)

            conventions_path = (
                context_pack_dir
                / "qmd"
                / "context-packs"
                / "sample-org"
                / "canonical"
                / "context-pack"
                / "codepmse-conventions.md"
            )
            conventions_markdown = conventions_path.read_text(encoding="utf-8")

            self.assertIn("## UI Standards Signals", conventions_markdown)
            self.assertIn("### Surface: legacy-ui/", conventions_markdown)
            self.assertIn("### Surface: web/", conventions_markdown)
            self.assertIn("## Backend Platform Signals", conventions_markdown)
            self.assertIn("service registries or containers", conventions_markdown)
            self.assertIn(
                "repository or persistence abstractions",
                conventions_markdown,
            )

    def test_live_seed_avoids_backend_hardening_for_weak_backend_inputs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "platform-api"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "src" / "service.py").write_text(
                "def service():\n    return 'ok'\n",
                encoding="utf-8",
            )

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "platform-api",
                        "repo_name": "platform-api",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            conventions_path = (
                context_pack_dir
                / "qmd"
                / "context-packs"
                / "sample-org"
                / "canonical"
                / "context-pack"
                / "codepmse-conventions.md"
            )
            conventions_markdown = conventions_path.read_text(encoding="utf-8")
            self.assertNotIn(
                "## Backend Platform Signals",
                conventions_markdown,
            )

    def test_refresh_invalidates_missing_artifact_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "shared-lib"
            (repo_dir / "src").mkdir(parents=True)
            source_file = repo_dir / "src" / "module.py"
            source_file.write_text("print('one')\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "shared-lib",
                        "repo_name": "shared-lib",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "shared",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )

            first_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(first_report["overall_status"], "success")

            artifact_path = (
                context_pack_dir
                / "qmd"
                / "context-packs"
                / "sample-org"
                / "estate"
                / "shared"
                / "shared-lib"
                / "records"
                / "src"
                / "module.py.json"
            )
            self.assertTrue(artifact_path.exists())

            source_file.unlink()

            second_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(second_report["overall_status"], "success")
            self.assertGreaterEqual(second_report["invalidated_record_count"], 1)

            artifact_record = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact_record["freshness_status"], "invalidated")
            self.assertIn("invalidated_reason", artifact_record)

    def test_blocked_repo_is_reported_without_breaking_ready_repo(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            ready_repo_dir = temp_dir / "ready-repo"
            (ready_repo_dir / "src").mkdir(parents=True)
            (ready_repo_dir / "src" / "main.py").write_text("print('ok')\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "ready-repo",
                        "repo_name": "ready-repo",
                        "local_paths": [str(ready_repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    },
                    {
                        "repo_id": "missing-repo",
                        "repo_name": "missing-repo",
                        "local_paths": [str(temp_dir / "does-not-exist")],
                        "system_layer": "backend",
                        "languages": ["python"],
                    },
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "completed-with-blocked-repos")
            self.assertEqual(report["seeded_repo_count"], 1)
            self.assertEqual(report["blocked_repo_count"], 1)
            statuses = {repo["repo_id"]: repo["status"] for repo in report["repositories"]}
            self.assertEqual(statuses["ready-repo"], "seeded")
            self.assertEqual(statuses["missing-repo"], "blocked")

    def test_live_seed_supports_infrastructure_layer_and_writes_partition(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "platform-infra"
            (repo_dir / "infra").mkdir(parents=True)
            (repo_dir / "infra" / "deploy.sh").write_text("#!/usr/bin/env bash\necho deploy\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "platform-infra",
                        "repo_name": "platform-infra",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "infrastructure",
                        "languages": ["shell"],
                        "artifact_roots": ["infra"],
                    }
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            artifact_path = (
                context_pack_dir
                / "qmd"
                / "context-packs"
                / "sample-org"
                / "estate"
                / "infrastructure"
                / "platform-infra"
                / "records"
                / "infra"
                / "deploy.sh.json"
            )
            self.assertTrue(artifact_path.exists())
            artifact_record = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact_record["system_layer"], "infrastructure")

    def test_live_seed_backfills_missing_indexes_from_existing_task_archives(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "billing-api"
            (repo_dir / "src").mkdir(parents=True)
            source_file = repo_dir / "src" / "app.py"
            source_file.write_text("print('hello')\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )
            scope_dir = context_pack_dir / "qmd" / "context-packs" / "sample-org"
            archive_dir = scope_dir / "archive" / "tasks" / "billing-api" / "2026"
            archive_dir.mkdir(parents=True, exist_ok=True)
            archive_path = archive_dir / "cap-9000.json"
            original_archive = {
                "schema_version": "qmd-record/v1",
                "record_type": "task-archive",
                "record_id": "task:sample-org:CAP-9000",
                "task_id": "CAP-9000",
                "root_task_id": "CAP-9000",
                "task_title": "Existing Archived Task",
                "repo_name": "billing-api",
                "created_at": "2026-03-01T00:00:00Z",
            }
            archive_path.write_text(json.dumps(original_archive, indent=2) + "\n", encoding="utf-8")

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )

            self.assertEqual(report["overall_status"], "success")
            self.assertTrue((scope_dir / "indexes" / "tasks.json").exists())
            self.assertTrue((scope_dir / "indexes" / "lineage.json").exists())

            tasks_index = json.loads((scope_dir / "indexes" / "tasks.json").read_text(encoding="utf-8"))
            self.assertEqual(tasks_index["tasks"][0]["task_id"], "CAP-9000")

            archive_after = json.loads(archive_path.read_text(encoding="utf-8"))
            self.assertEqual(archive_after["created_at"], "2026-03-01T00:00:00Z")

    def test_live_seed_rebuilds_deleted_indexes_without_rewriting_canonical_summary_created_at(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "shared-lib"
            (repo_dir / "src").mkdir(parents=True)
            (repo_dir / "src" / "module.py").write_text("print('one')\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "shared-lib",
                        "repo_name": "shared-lib",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "shared",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )

            first_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(first_report["overall_status"], "success")

            scope_dir = context_pack_dir / "qmd" / "context-packs" / "sample-org"
            summary_record_path = scope_dir / "canonical" / "repos" / "shared-lib" / "repo-summary.md.record.json"
            original_summary_record = json.loads(summary_record_path.read_text(encoding="utf-8"))
            original_created_at = original_summary_record["created_at"]

            for index_path in [
                scope_dir / "indexes" / "context-pack-index.json",
                scope_dir / "indexes" / "repositories.json",
                scope_dir / "indexes" / "tasks.json",
                scope_dir / "indexes" / "lineage.json",
            ]:
                index_path.unlink()

            second_report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(second_report["overall_status"], "success")

            for index_path in [
                scope_dir / "indexes" / "context-pack-index.json",
                scope_dir / "indexes" / "repositories.json",
                scope_dir / "indexes" / "tasks.json",
                scope_dir / "indexes" / "lineage.json",
            ]:
                self.assertTrue(index_path.exists())

            summary_record_after = json.loads(summary_record_path.read_text(encoding="utf-8"))
            self.assertEqual(summary_record_after["created_at"], original_created_at)

    def test_live_seed_supports_database_layer_and_preserves_legacy_shared_layer(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            db_repo = temp_dir / "orders-db"
            shared_repo = temp_dir / "shared-lib"
            (db_repo / "schema").mkdir(parents=True)
            (shared_repo / "src").mkdir(parents=True)
            (db_repo / "schema" / "init.sql").write_text("create table orders(id int);\n", encoding="utf-8")
            (shared_repo / "src" / "shared.py").write_text("print('shared')\n", encoding="utf-8")

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "orders-db",
                        "repo_name": "orders-db",
                        "local_paths": [str(db_repo)],
                        "system_layer": "database",
                        "languages": ["sql"],
                        "artifact_roots": ["schema"],
                    },
                    {
                        "repo_id": "shared-lib",
                        "repo_name": "shared-lib",
                        "local_paths": [str(shared_repo)],
                        "system_layer": "shared",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    },
                ],
            )

            report = self.run_seed(
                temp_dir,
                context_pack_dir=str(context_pack_dir),
            )
            self.assertEqual(report["overall_status"], "success")

            scope_dir = context_pack_dir / "qmd" / "context-packs" / "sample-org"
            database_record = scope_dir / "estate" / "database" / "orders-db" / "records" / "schema" / "init.sql.json"
            shared_record = scope_dir / "estate" / "shared" / "shared-lib" / "records" / "src" / "shared.py.json"
            repositories_index_path = scope_dir / "indexes" / "repositories.json"

            self.assertTrue(database_record.exists())
            self.assertTrue(shared_record.exists())

            repositories_index = json.loads(repositories_index_path.read_text(encoding="utf-8"))
            layers = {entry["repo_id"]: entry["system_layer"] for entry in repositories_index["repositories"]}
            self.assertEqual(layers["orders-db"], "database")
            self.assertEqual(layers["shared-lib"], "shared")

    def test_live_seed_rejects_context_pack_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            workspace_root = temp_path / "workspace"
            workspace_root.mkdir(parents=True, exist_ok=True)
            external_root = temp_path / "external"
            external_root.mkdir(parents=True, exist_ok=True)
            external_pack = self.create_context_pack(
                external_root,
                [
                    {
                        "repo_id": "billing-api",
                        "repo_name": "billing-api",
                        "local_paths": [str(external_root / "billing-api")],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "artifact_roots": ["src"],
                    }
                ],
            )
            (workspace_root / "linked-pack").symlink_to(
                external_pack,
                target_is_directory=True,
            )

            with self.assertRaisesRegex(ValueError, "context_pack_dir"):
                self.run_seed(
                    workspace_root,
                    context_pack_dir="linked-pack",
                )


    # ------------------------------------------------------------------
    # Slice-03 tests: file count enforcement
    # ------------------------------------------------------------------

    def test_seed_repository_enforces_max_files_per_repo(self) -> None:
        """Seed a repo with more files than the limit, verify only
        max_files_per_repo records are created."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "big-repo"
            src_dir = repo_dir / "src"
            src_dir.mkdir(parents=True)
            # Create 5 source files
            for i in range(5):
                (src_dir / f"file{i}.py").write_text(
                    f"# file {i}\n", encoding="utf-8"
                )

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "big-repo",
                        "repo_name": "big-repo",
                        "owner": "sample-org",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "bounded_context": "billing",
                        "artifact_roots": ["src"],
                    }
                ],
            )

            # Patch max_files_per_repo to 2 so the seeding service limits files
            self.app._SEEDING_SERVICE = None
            self.app._ARCHIVE_SERVICE = None
            original = self.app.DEFAULT_MAX_FILES_PER_REPO
            try:
                self.app.DEFAULT_MAX_FILES_PER_REPO = 2
                with mock.patch("pathlib.Path.cwd", return_value=temp_dir):
                    report = self.app.execute_seed_run(
                        context_pack_dir=str(context_pack_dir),
                        plan_mode="manifest-only",
                    )
            finally:
                self.app.DEFAULT_MAX_FILES_PER_REPO = original
                self.app._SEEDING_SERVICE = None

            self.assertEqual(report["overall_status"], "success")
            repo_result = report["repositories"][0]
            # Only 2 source paths should be seeded, not all 5
            self.assertLessEqual(len(repo_result["source_paths"]), 2)

    def test_seed_report_includes_skipped_file_count(self) -> None:
        """Verify seed report includes files_skipped field when the
        seed_repository limit is exceeded.

        iter_scan_files already truncates at the scan level, so to exercise
        the defense-in-depth guard in seed_repository we patch iter_scan_files
        to return all 5 files untruncated while setting max_files_per_repo=2.
        """
        with tempfile.TemporaryDirectory() as temp_root:
            temp_dir = Path(temp_root)
            repo_dir = temp_dir / "big-repo"
            src_dir = repo_dir / "src"
            src_dir.mkdir(parents=True)
            all_files = []
            for i in range(5):
                f = src_dir / f"mod{i}.py"
                f.write_text(f"# mod {i}\n", encoding="utf-8")
                all_files.append(f)

            context_pack_dir = self.create_context_pack(
                temp_dir,
                [
                    {
                        "repo_id": "big-repo",
                        "repo_name": "big-repo",
                        "owner": "sample-org",
                        "local_paths": [str(repo_dir)],
                        "system_layer": "backend",
                        "languages": ["python"],
                        "bounded_context": "billing",
                        "artifact_roots": ["src"],
                    }
                ],
            )

            # Bypass scan-level truncation so seed_repository's own guard fires
            def untruncated_scan(targets):
                return all_files, []

            self.app._SEEDING_SERVICE = None
            self.app._ARCHIVE_SERVICE = None
            original = self.app.DEFAULT_MAX_FILES_PER_REPO
            try:
                self.app.DEFAULT_MAX_FILES_PER_REPO = 2
                with (
                    mock.patch("pathlib.Path.cwd", return_value=temp_dir),
                    mock.patch.object(
                        self.app,
                        "iter_scan_files",
                        side_effect=untruncated_scan,
                    ),
                ):
                    report = self.app.execute_seed_run(
                        context_pack_dir=str(context_pack_dir),
                        plan_mode="manifest-only",
                    )
            finally:
                self.app.DEFAULT_MAX_FILES_PER_REPO = original
                self.app._SEEDING_SERVICE = None

            self.assertIn("files_skipped", report)
            repo_result = report["repositories"][0]
            self.assertIn("files_skipped", repo_result)
            self.assertGreater(repo_result["files_skipped"], 0)
            self.assertEqual(repo_result["files_skipped"], 3)  # 5 - 2 = 3


if __name__ == "__main__":
    unittest.main()
