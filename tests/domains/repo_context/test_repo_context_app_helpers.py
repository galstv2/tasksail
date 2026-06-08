from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.backend.mcp.repo_context_mcp import app as repo_context_app
from src.backend.mcp.repo_context_mcp.services import discovery_service


class RepoContextAppHelperTests(unittest.TestCase):
    def make_temp_dir(self) -> Path:
        temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(
            lambda: temp_dir.exists()
            and shutil.rmtree(temp_dir, ignore_errors=True)
        )
        return temp_dir

    def test_normalize_repo_entry_builds_ready_targets_and_warnings(
        self,
    ) -> None:
        workspace = self.make_temp_dir()
        repo_root = workspace / "repos" / "platform"
        (repo_root / "src").mkdir(parents=True)
        (repo_root / "README.md").write_text("# Platform\n", encoding="utf-8")

        result = repo_context_app.normalize_repo_entry(
            workspace,
            {
                "repo_id": "platform",
                "repo_name": "Platform",
                "local_paths": ["repos/platform", "repos/missing"],
                "artifact_roots": ["src"],
                "document_paths": ["README.md"],
                "languages": [" Python ", ""],
                "tags": ["core", " core ", ""],
                "system_layer": "backend",
            },
            "qmd/context-packs/sample-pack",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["repo_id"], "platform")
        self.assertEqual(result["languages"], ["python"])
        self.assertEqual(result["tags"], ["core", "core"])
        self.assertEqual(result["existing_roots"], [str(repo_root.resolve())])
        self.assertEqual(
            result["missing_roots"],
            [str((workspace / "repos" / "missing").resolve())],
        )
        self.assertEqual(
            result["scan_targets"],
            [
                str((repo_root / "src").resolve()),
                str((repo_root / "README.md").resolve()),
            ],
        )
        self.assertIn(
            "One or more configured local paths are missing",
            " ".join(result["warnings"]),
        )
        self.assertIn(
            "No bounded_context declared",
            " ".join(result["warnings"]),
        )
        self.assertEqual(
            result["qmd_targets"]["canonical_repo_summary"],
            (
                "qmd/context-packs/sample-pack/canonical/repos/"
                "platform/repo-summary.md"
            ),
        )
        self.assertEqual(
            result["qmd_targets"]["language_partitions"],
            [
                "qmd/context-packs/sample-pack/estate/languages/"
                "python/platform/"
            ],
        )
        self.assertEqual(
            result["qmd_targets"]["documents_partition"],
            "qmd/context-packs/sample-pack/estate/documents/platform/",
        )

    def test_normalize_repo_entry_reports_blocked_repo_fallback_warnings(
        self,
    ) -> None:
        workspace = self.make_temp_dir()

        result = repo_context_app.normalize_repo_entry(
            workspace,
            {
                "repo_id": "platform",
                "repo_name": "Platform",
                "local_paths": ["repos/missing"],
                "system_layer": "unknown-layer",
            },
            "qmd/context-packs/sample-pack",
        )

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["system_layer"], "shared")
        warning_text = " ".join(result["warnings"])
        self.assertIn(
            "No configured local paths currently exist",
            warning_text,
        )
        self.assertIn("No languages declared", warning_text)
        self.assertIn(
            "No artifact_roots or document_paths declared",
            warning_text,
        )

    def test_test_classification_covers_common_language_conventions(
        self,
    ) -> None:
        positive_paths = [
            "src/frontend/desktop/electron/externalMcpHandlers.test.ts",
            "src/frontend/desktop/src/renderer/App.integration.test.tsx",
            "tests/domains/repo_context/test_repo_context_app_helpers.py",
            "internal/server/server_test.go",
            "app/src/test/java/com/acme/CheckoutTest.java",
            "spec/models/order_spec.rb",
            "Features/CheckoutTests.cs",
            "src/frontend/desktop/electron/tests",
            "src/foo_spec.py",
            "lib/foo_test.cpp",
            "test-ui.R",
        ]
        negative_paths = [
            "src/contest.ts",
            "src/latest.ts",
            "src/attest.py",
            "src/testingUtilities.ts",
            "src/protest_handler.py",
            "src/testament.rs",
            "src/Git.java",
            "src/Transit.java",
            "src/Permit.java",
        ]

        for path in positive_paths:
            with self.subTest(path=path):
                self.assertTrue(repo_context_app.is_test_path(path))

        for path in negative_paths:
            with self.subTest(path=path):
                self.assertFalse(repo_context_app.is_test_path(path))

        colocated_test = Path(
            "src/frontend/desktop/electron/externalMcpHandlers.test.ts"
        )
        self.assertEqual(
            repo_context_app.detect_artifact_type(colocated_test),
            repo_context_app.ARTIFACT_TYPE_TEST_CODE,
        )
        self.assertEqual(
            repo_context_app.detect_path_kind(colocated_test),
            repo_context_app.PATH_KIND_TESTS,
        )
        self.assertTrue(
            discovery_service._is_test_signal_path(  # noqa: SLF001
                "src/frontend/desktop/electron/externalMcpHandlers.test.ts"
            )
        )
        self.assertTrue(
            discovery_service._is_test_signal_path(  # noqa: SLF001
                "src/frontend/desktop/src/renderer/App.integration.test.tsx"
            )
        )

    def test_iter_scan_files_truncates_and_deduplicates_targets(self) -> None:
        workspace = self.make_temp_dir()
        repo_root = workspace / "repo"
        repo_root.mkdir()
        included = repo_root / "main.py"
        included.write_text("print('ok')\n", encoding="utf-8")
        duplicate = repo_root / "index.ts"
        duplicate.write_text("export {};\n", encoding="utf-8")
        ignored = repo_root / "notes.tmp"
        ignored.write_text("ignore\n", encoding="utf-8")

        with mock.patch.object(
            repo_context_app,
            "DEFAULT_MAX_FILES_PER_REPO",
            1,
        ):
            files, warnings = repo_context_app.iter_scan_files(
                [str(repo_root), str(included)],
            )

        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].suffix in {".py", ".ts"})
        self.assertIn("Scan truncated at 1 files", warnings[0])

    def test_record_helpers_build_and_update_expected_payloads(self) -> None:
        workspace = self.make_temp_dir()
        source_root = workspace / "repo"
        docs_dir = source_root / "docs" / "runbooks"
        docs_dir.mkdir(parents=True)
        source_file = docs_dir / "deploy.md"
        source_file.write_text(
            "# Deploy Runbook\n\nUse caution.\n",
            encoding="utf-8",
        )
        record_path = workspace / "record.json"
        record_path.write_text(
            json.dumps({"created_at": "2026-03-01T00:00:00Z"}),
            encoding="utf-8",
        )

        repo = {
            "repo_id": "platform",
            "repo_name": "Platform",
            "owner": "sample-org",
            "system_layer": "backend",
            "bounded_context": None,
            "tags": ["core"],
            "context_pack_id": "sample-pack",
            "qmd_scope": "qmd/context-packs/sample-pack",
            "languages": ["python"],
        }

        artifact = repo_context_app.create_artifact_record(
            repo,
            source_root,
            "ref-123",
            "docs/runbooks/deploy.md",
            "2026-03-07T00:00:00Z",
            record_path,
        )
        self.assertEqual(artifact["system_layer"], "documents")
        self.assertEqual(artifact["artifact_type"], "runbook")
        self.assertTrue(artifact["is_public_surface"])
        self.assertEqual(artifact["summary"], "Deploy Runbook")
        self.assertEqual(artifact["created_at"], "2026-03-01T00:00:00Z")

        test_artifact = repo_context_app.create_artifact_record(
            repo,
            source_root,
            "ref-123",
            "src/frontend/desktop/electron/externalMcpHandlers.test.ts",
            "2026-03-07T00:00:00Z",
            workspace / "test-record.json",
            preview="test preview",
        )
        self.assertEqual(
            test_artifact["artifact_type"],
            repo_context_app.ARTIFACT_TYPE_TEST_CODE,
        )
        self.assertEqual(
            test_artifact["path_kind"],
            repo_context_app.PATH_KIND_TESTS,
        )
        self.assertEqual(test_artifact["system_layer"], "backend")
        self.assertIn(
            f"artifact:{repo_context_app.ARTIFACT_TYPE_TEST_CODE}",
            test_artifact["tags"],
        )
        self.assertIn(
            f"path-kind:{repo_context_app.PATH_KIND_TESTS}",
            test_artifact["tags"],
        )

        summary_record = repo_context_app.create_summary_record(
            repo,
            "ref-123",
            "2026-03-07T00:00:00Z",
            record_path,
            ["docs/runbooks/deploy.md"],
        )
        bootstrap_record = repo_context_app.create_bootstrap_note_record(
            repo,
            "ref-123",
            "2026-03-07T00:00:00Z",
            record_path,
            ["docs/runbooks/deploy.md"],
        )
        self.assertEqual(summary_record["record_type"], "canonical-summary")
        self.assertEqual(bootstrap_record["record_type"], "operational-note")
        self.assertIn("bootstrap:live-seed", bootstrap_record["tags"])

        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "platform",
                        "repo_name": "Platform",
                        "system_layer": "backend",
                        "bounded_context": "core",
                        "languages": ["python"],
                        "service_name": "platform-api",
                        "tags": ["framework:fastapi"],
                        "source_paths": [
                            "src/main.py",
                            "tests/test_main.py",
                            "docs/design/architecture-overview.md",
                            "pyproject.toml",
                        ],
                        "warnings": ["Missing optional owner-team metadata."],
                    },
                    {
                        "repo_id": "web-app",
                        "repo_name": "Web App",
                        "system_layer": "frontend",
                        "bounded_context": "ui",
                        "languages": ["typescript"],
                        "service_name": "web-app",
                        "tags": ["framework:react"],
                        "source_paths": [
                            "src/App.tsx",
                            "src/__tests__/App.test.tsx",
                            "package.json",
                        ],
                    },
                ],
                "2026-03-07T00:00:00Z",
            )
        )
        self.assertIn("## Architectural Shape", conventions_markdown)
        self.assertIn("## Coding and Layout Signals", conventions_markdown)
        self.assertIn("## UI Standards Signals", conventions_markdown)
        self.assertIn("### Surface: repo-root", conventions_markdown)
        self.assertIn("Framework signals: React.", conventions_markdown)
        self.assertIn("framework:fastapi", conventions_markdown)
        self.assertIn("tests/test_main.py", conventions_markdown)
        self.assertIn("## Warnings and Caveats", conventions_markdown)

        conventions_record = (
            repo_context_app.create_context_pack_conventions_record(
                "sample-pack",
                "qmd/context-packs/sample-pack",
                "2026-03-07T00:00:00Z",
                record_path,
                [
                    {
                        "repo_id": "platform",
                        "repo_name": "Platform",
                        "source_ref": "ref-123",
                        "source_paths": ["src/main.py", "tests/test_main.py"],
                    },
                    {
                        "repo_id": "web-app",
                        "repo_name": "Web App",
                        "source_ref": "ref-456",
                        "source_paths": ["src/App.tsx"],
                    },
                ],
            )
        )
        self.assertEqual(
            conventions_record["record_type"],
            "canonical-summary",
        )
        self.assertEqual(
            conventions_record["summary_scope"],
            "context-pack",
        )
        self.assertIn(
            "summary:context-pack-style",
            conventions_record["tags"],
        )
        self.assertEqual(
            conventions_record["summary_targets"],
            ["platform", "web-app"],
        )
        self.assertEqual(
            conventions_record["source_ref"],
            "multiple-repos",
        )

        invalid_path = workspace / "invalid.json"
        invalid_path.write_text("{", encoding="utf-8")
        self.assertFalse(
            repo_context_app.invalidate_record(
                workspace / "missing.json",
                "2026-03-07T00:00:00Z",
                "missing",
            )
        )
        self.assertFalse(
            repo_context_app.invalidate_record(
                invalid_path,
                "2026-03-07T00:00:00Z",
                "invalid",
            )
        )
        self.assertTrue(
            repo_context_app.invalidate_record(
                record_path,
                "2026-03-07T00:00:00Z",
                "refresh",
            )
        )
        invalidated = json.loads(record_path.read_text(encoding="utf-8"))
        self.assertEqual(invalidated["freshness_status"], "invalidated")
        self.assertEqual(invalidated["invalidated_reason"], "refresh")

    def test_discover_frontend_surfaces_falls_back_to_repo_root_for_single_ui(
        self,
    ) -> None:
        surfaces = repo_context_app.discover_frontend_surfaces(
            [
                {
                    "repo_id": "web-app",
                    "repo_name": "Web App",
                    "system_layer": "frontend",
                    "tags": ["framework:react"],
                    "source_paths": [
                        "src/App.tsx",
                        "src/components/NavBar.tsx",
                        "src/__tests__/App.test.tsx",
                        "package.json",
                    ],
                }
            ]
        )

        self.assertEqual(len(surfaces), 1)
        self.assertEqual(surfaces[0]["repo_id"], "web-app")
        self.assertEqual(surfaces[0]["surface_root"], ".")
        self.assertEqual(surfaces[0]["framework_signals"], ["react"])
        self.assertIn(
            "component-or-primitive-layer",
            surfaces[0]["signal_types"],
        )
        self.assertEqual(surfaces[0]["confidence"], "high")

    def test_conventions_markdown_renders_mixed_ui_surfaces_and_cautions(
        self,
    ) -> None:
        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "customer-portal",
                        "repo_name": "Customer Portal",
                        "system_layer": "frontend",
                        "tags": ["framework:react", "framework:angularjs"],
                        "source_paths": [
                            "legacy-ui/orders.module.js",
                            "legacy-ui/orders.controller.js",
                            "legacy-ui/templates/orders.tpl.html",
                            "web/src/App.tsx",
                            "web/src/components/OrderPage.tsx",
                            "web/src/__tests__/OrderPage.test.tsx",
                        ],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )

        self.assertIn("## UI Standards Signals", conventions_markdown)
        self.assertIn("### Surface: legacy-ui/", conventions_markdown)
        self.assertIn("### Surface: web/", conventions_markdown)
        self.assertIn("Framework signals: AngularJS.", conventions_markdown)
        self.assertIn("Framework signals: React.", conventions_markdown)
        self.assertIn("### Cross-Surface Cautions", conventions_markdown)
        self.assertIn(
            "Do not assume pack-wide frontend conventions are interchangeable",
            conventions_markdown,
        )

    def test_conventions_markdown_prefers_local_ui_layers_when_visible(
        self,
    ) -> None:
        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "design-web",
                        "repo_name": "Design Web",
                        "system_layer": "frontend",
                        "tags": ["framework:react"],
                        "source_paths": [
                            "web/src/App.tsx",
                            "web/src/ui/primitives/Button.tsx",
                            "web/src/theme/tokens.css",
                            "web/src/components/NavBar.tsx",
                        ],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )

        self.assertIn(
            "Project-defined components or UI primitives appear to carry the primary working standard",
            conventions_markdown,
        )
        self.assertIn(
            "styling, theme, or token layers",
            conventions_markdown,
        )

    def test_conventions_markdown_omits_ui_section_without_frontend_evidence(
        self,
    ) -> None:
        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "platform",
                        "repo_name": "Platform",
                        "system_layer": "backend",
                        "languages": ["python"],
                        "source_paths": [
                            "src/main.py",
                            "tests/test_main.py",
                            "pyproject.toml",
                        ],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )

        self.assertNotIn("## UI Standards Signals", conventions_markdown)

    def test_conventions_markdown_renders_explicit_backend_platform_signals(
        self,
    ) -> None:
        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "platform-api",
                        "repo_name": "Platform API",
                        "system_layer": "backend",
                        "languages": ["python"],
                        "source_paths": [
                            "src/middleware/auth.py",
                            "src/controllers/orders_controller.py",
                            "src/registry/container.py",
                            "src/repositories/order_repository.py",
                            "src/workers/rebuild_index_worker.py",
                        ],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )

        self.assertIn("## Backend Platform Signals", conventions_markdown)
        self.assertIn("### Repository: Platform API", conventions_markdown)
        self.assertIn("middleware stacks", conventions_markdown)
        self.assertIn("service registries or containers", conventions_markdown)
        self.assertIn(
            "repository or persistence abstractions",
            conventions_markdown,
        )
        self.assertIn("worker or job partitions", conventions_markdown)

    def test_conventions_markdown_avoids_backend_overclaiming_on_weak_inputs(
        self,
    ) -> None:
        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "platform-api",
                        "repo_name": "Platform API",
                        "system_layer": "backend",
                        "languages": ["python"],
                        "source_paths": [
                            "src/service.py",
                            "src/models.py",
                            "tests/test_service.py",
                        ],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )

        self.assertNotIn("## Backend Platform Signals", conventions_markdown)

    def test_retrospective_report_renderer_includes_agent_contributions(
        self,
    ) -> None:
        summary = {
            "qmd_scope": "qmd/context-packs/sample-org",
            "task_id": "CAP-1001",
            "retrospective_record": {
                "task_id": "CAP-1001",
                "task_title": "Retrospective Task",
                "root_task_id": "CAP-1001",
                "parent_task_id": "",
                "repo_name": "platform",
                "retrospective_summary": "The retrospective stayed concise.",
                "what_went_well": ["Clear handoffs."],
                "what_could_have_gone_better": ["Late QA."],
                "action_items": ["Capture follow-ups earlier."],
                "reusable_team_learnings": ["Archive learnings."],
                "anti_patterns": ["Skipping the retro."],
                "agent_contributions": {
                    "Documentation": ["Captured the final learning."],
                    "QA": ["Surfaced the delay."],
                },
            },
        }

        markdown = repo_context_app.REPORT_RENDERER.render_task_retrospective_summary(summary)

        self.assertIn("## Agent Contributions", markdown)
        self.assertIn("### Documentation", markdown)
        self.assertIn("Captured the final learning.", markdown)
        self.assertIn("### QA", markdown)

    def test_shared_retrospective_memory_renderer_returns_expected_payload(
        self,
    ) -> None:
        summary = {
            "global_retrospective_root": "qmd/global/retrospectives",
            "shared_memory_record": {
                "updated_at_utc": "2026-03-07T00:00:00Z",
                "synthesized_from_task_ids": ["CAP-1001"],
                "recurring_strengths": ["Clear handoffs."],
                "recurring_bottlenecks": ["Late QA."],
                "open_action_items": ["Capture follow-ups earlier."],
                "validated_improvements": ["Archive learnings."],
                "anti_patterns": ["Skipping the retro."],
            },
        }

        markdown = repo_context_app.REPORT_RENDERER.render_shared_retrospective_memory(summary)

        self.assertIn("# Shared Retrospective Memory", markdown)
        self.assertIn("## Contributing Tasks", markdown)
        self.assertIn("CAP-1001", markdown)

    def test_invalidate_record_warns_on_corrupted_json(self) -> None:
        """invalidate_record must log WARNING and return None for malformed JSON."""
        workspace = self.make_temp_dir()
        bad_file = workspace / "bad.json"
        bad_file.write_text("{corrupt", encoding="utf-8")

        import logging

        with self.assertLogs("src.backend.mcp.repo_context_mcp.record_factory", level=logging.WARNING) as cm:
            result = repo_context_app.invalidate_record(
                bad_file, "2026-03-07T00:00:00Z", "test"
            )

        self.assertIsNone(result)
        self.assertTrue(
            any("malformed JSON" in msg for msg in cm.output),
            f"Expected 'malformed JSON' warning, got: {cm.output}",
        )


if __name__ == "__main__":
    unittest.main()
