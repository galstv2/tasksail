from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import shutil
from unittest import mock

from src.backend.mcp.repo_context_mcp import app as repo_context_app


class RepoContextAppHelperTests(unittest.TestCase):
    def make_temp_dir(self) -> Path:
        temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(
            lambda: temp_dir.exists()
            and shutil.rmtree(temp_dir, ignore_errors=True)
        )
        return temp_dir

    def test_normalize_repo_entry_requires_repo_identifier_and_local_paths(
        self,
    ) -> None:
        workspace = self.make_temp_dir()

        with self.assertRaisesRegex(ValueError, "repo_id"):
            repo_context_app.normalize_repo_entry(
                workspace,
                {"local_paths": ["repo"]},
                "qmd/context-packs/sample-pack",
            )

        with self.assertRaisesRegex(ValueError, "at least one local path"):
            repo_context_app.normalize_repo_entry(
                workspace,
                {"repo_id": "platform", "repo_name": "Platform"},
                "qmd/context-packs/sample-pack",
            )

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

    def test_git_and_preview_helpers_cover_fallback_paths(self) -> None:
        workspace = self.make_temp_dir()
        preview_path = workspace / "README.md"
        preview_path.write_text("\n# Headline\n\nBody\n", encoding="utf-8")
        binary_path = workspace / "invalid.bin"
        binary_path.write_bytes(b"\xff\xfe\x00")

        with mock.patch.object(
            repo_context_app.subprocess,
            "run",
            side_effect=subprocess.CalledProcessError(1, ["git"]),
        ):
            self.assertIsNone(
                repo_context_app.run_git_command(workspace, "status")
            )
            self.assertEqual(
                repo_context_app.detect_source_ref(workspace),
                "workspace-unversioned",
            )

        self.assertEqual(
            repo_context_app.normalize_language(Path("main.py")),
            "python",
        )
        self.assertEqual(
            repo_context_app.normalize_language(Path("notes.txt")),
            "text",
        )
        self.assertEqual(
            repo_context_app.detect_artifact_type(Path("tests/test_main.py")),
            "test-code",
        )
        self.assertEqual(
            repo_context_app.detect_artifact_type(
                Path("docs/runbooks/ops.md")
            ),
            "runbook",
        )
        self.assertEqual(
            repo_context_app.detect_artifact_type(
                Path("docs/architecture.md")
            ),
            "architecture-doc",
        )
        self.assertEqual(
            repo_context_app.detect_path_kind(Path("docs/guide.md")),
            "docs",
        )
        self.assertEqual(
            repo_context_app.detect_path_kind(Path("scripts/setup.sh")),
            "scripts",
        )
        self.assertTrue(
            repo_context_app.looks_like_entrypoint(Path("main.py"))
        )
        self.assertFalse(
            repo_context_app.looks_like_entrypoint(Path("helper.py"))
        )
        self.assertEqual(
            repo_context_app.read_preview(preview_path),
            "Headline",
        )
        self.assertEqual(repo_context_app.read_preview(binary_path), "")

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
                            "docs/architecture.md",
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

    def test_discover_frontend_surfaces_separates_mixed_framework_roots(
        self,
    ) -> None:
        surfaces = repo_context_app.discover_frontend_surfaces(
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
            ]
        )

        self.assertEqual(
            [surface["surface_root"] for surface in surfaces],
            ["legacy-ui", "web"],
        )
        legacy_surface = surfaces[0]
        react_surface = surfaces[1]
        self.assertEqual(legacy_surface["framework_signals"], ["angularjs"])
        self.assertIn(
            "custom-directive-layer",
            legacy_surface["signal_types"],
        )
        self.assertEqual(react_surface["framework_signals"], ["react"])
        self.assertIn(
            "component-or-primitive-layer",
            react_surface["signal_types"],
        )

    def test_discover_frontend_surfaces_degrades_on_ambiguous_frameworks(
        self,
    ) -> None:
        surfaces = repo_context_app.discover_frontend_surfaces(
            [
                {
                    "repo_id": "mixed-ui",
                    "repo_name": "Mixed UI",
                    "system_layer": "frontend",
                    "tags": ["framework:react", "framework:angularjs"],
                    "source_paths": [
                        "ui/package.json",
                        "ui/README.md",
                    ],
                }
            ]
        )

        self.assertEqual(len(surfaces), 1)
        self.assertEqual(surfaces[0]["surface_root"], "ui")
        self.assertEqual(surfaces[0]["framework_signals"], [])
        self.assertEqual(surfaces[0]["confidence"], "low")
        self.assertIn(
            "mixed or incomplete",
            " ".join(surfaces[0]["warnings"]),
        )

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

    def test_service_factories_and_wrapper_delegation(self) -> None:
        workspace = self.make_temp_dir()
        service = mock.Mock()
        service.build_plan.return_value = {"plan": True}
        service.load_plan.return_value = {"loaded": True}
        service.get_live_plan.return_value = ({"live": True}, "used-plan")
        service.seed_repository.return_value = mock.sentinel.seed_result
        service.execute_seed_run.return_value = {"report": True}
        cli = mock.Mock()
        cli.parse_args.return_value = mock.sentinel.parsed_args
        transport = mock.Mock()
        transport.make_handler_class.return_value = BaseException
        archive_service = mock.Mock()
        archive_service.build_task_lineage_summary.return_value = {
            "lineage": True
        }
        archive_service.build_task_retrospective_summary.return_value = {
            "retrospective": True
        }
        archive_service.load_shared_retrospective_memory.return_value = {
            "shared": True
        }
        archive_service.resolve_parent_archive.return_value = (
            mock.sentinel.archive_resolution
        )
        carry_service = mock.Mock()
        carry_service.build_summary.return_value = {"carry": True}

        with (
            mock.patch.object(
                repo_context_app.Path,
                "cwd",
                return_value=workspace,
            ),
            mock.patch.object(
                repo_context_app,
                "QmdIndexService",
                return_value=mock.Mock(name="mock_qmd_index"),
            ) as qmd_index_ctor,
            mock.patch.object(
                repo_context_app,
                "SeedingService",
                return_value=service,
            ) as seeding_ctor,
            mock.patch.object(
                repo_context_app,
                "RepoContextCli",
                return_value=cli,
            ) as cli_ctor,
            mock.patch.object(
                repo_context_app,
                "RepoContextHttpHandler",
                return_value=transport,
            ) as http_ctor,
            mock.patch.object(
                repo_context_app,
                "TaskArchiveService",
                return_value=archive_service,
            ) as archive_ctor,
            mock.patch.object(
                repo_context_app,
                "CarryForwardService",
                return_value=carry_service,
            ) as carry_ctor,
            mock.patch.object(
                repo_context_app.REPORT_RENDERER,
                "render_task_lineage_summary",
                return_value="lineage markdown",
            ) as render_lineage,
            mock.patch.object(
                repo_context_app.REPORT_RENDERER,
                "render_carry_forward_summary",
                return_value="carry markdown",
            ) as render_carry,
            mock.patch.object(
                repo_context_app,
                "LineageService",
                return_value=mock.Mock(
                    build_task_lineage_summary=mock.Mock(
                        return_value={"lineage": True}
                    ),
                ),
            ),
        ):
            # Reset the cached singletons so get_seeding_service(),
            # get_archive_service(), and get_qmd_index_service() call the
            # mocked constructors instead of returning previously cached
            # real instances.
            repo_context_app._SEEDING_SERVICE = None
            repo_context_app._ARCHIVE_SERVICE = None
            repo_context_app._QMD_INDEX_SERVICE = None
            repo_context_app._LINEAGE_SERVICE = None

            created_service = repo_context_app.create_seeding_service()
            self.assertIs(created_service, service)
            seeding_ctor.assert_called_once()
            self.assertEqual(
                seeding_ctor.call_args.kwargs["workspace_root"],
                workspace,
            )
            self.assertIs(
                seeding_ctor.call_args.kwargs["qmd_index_service"],
                qmd_index_ctor.return_value,
            )

            created_cli = repo_context_app.create_cli()
            self.assertIs(created_cli, cli)
            cli_ctor.assert_called_once_with(
                default_host=repo_context_app.DEFAULT_HOST,
                default_port=repo_context_app.DEFAULT_PORT,
                default_manifest=repo_context_app.DEFAULT_MANIFEST,
                default_plan_file=repo_context_app.DEFAULT_PLAN_FILE,
                execute_seed_run=repo_context_app.execute_seed_run,
                load_context_pack_conventions_summary=(
                    repo_context_app.load_context_pack_conventions_summary
                ),
                load_behavior_correction_memo_summary=(
                    repo_context_app.load_behavior_correction_memo
                ),
                build_carry_forward_summary=(
                    repo_context_app.build_carry_forward_summary
                ),
                build_task_lineage_summary=(
                    repo_context_app.build_task_lineage_summary
                ),
                render_context_pack_conventions_summary=(
                    repo_context_app.render_context_pack_conventions_summary
                ),
                render_behavior_correction_memo=(
                    repo_context_app.render_behavior_correction_memo
                ),
                render_run_markdown=repo_context_app.render_run_markdown,
            )

            handler_class = repo_context_app.create_handler_class()
            self.assertIs(handler_class, BaseException)
            http_ctor.assert_called_once()
            self.assertEqual(
                http_ctor.call_args.kwargs["runtime_state"],
                repo_context_app.RUNTIME_STATE,
            )
            self.assertEqual(
                http_ctor.call_args.kwargs[
                    "load_context_pack_conventions_summary"
                ],
                repo_context_app.load_context_pack_conventions_summary,
            )
            self.assertEqual(
                http_ctor.call_args.kwargs[
                    "build_task_retrospective_summary"
                ],
                repo_context_app.build_task_retrospective_summary,
            )
            self.assertEqual(
                http_ctor.call_args.kwargs[
                    "load_shared_retrospective_memory_summary"
                ],
                repo_context_app.load_shared_retrospective_memory_summary,
            )
            transport.make_handler_class.assert_called_once_with()

            # Verify seeding service methods are accessible via the service directly.
            seeding = repo_context_app.get_seeding_service()
            self.assertEqual(
                seeding.build_plan(workspace, workspace / "manifest.json"),
                {"plan": True},
            )
            self.assertEqual(
                seeding.load_plan(workspace / "plan.json"),
                {"loaded": True},
            )
            self.assertEqual(
                seeding.get_live_plan(
                    context_pack_dir=workspace,
                    manifest_path=workspace / "manifest.json",
                    plan_path=workspace / "plan.json",
                    plan_mode="prefer-plan",
                ),
                ({"live": True}, "used-plan"),
            )
            self.assertIs(
                seeding.seed_repository(
                    context_pack_dir=workspace,
                    plan={"repos": []},
                    repo={"repo_id": "platform"},
                    indexed_at="2026-03-07T00:00:00Z",
                ),
                mock.sentinel.seed_result,
            )
            self.assertEqual(
                repo_context_app.execute_seed_run(str(workspace)),
                {"report": True},
            )
            self.assertIs(
                repo_context_app.parse_args(["seed"]),
                mock.sentinel.parsed_args,
            )

            lineage = repo_context_app.build_task_lineage_summary(
                context_pack_dir=str(workspace),
                qmd_scope="qmd/context-packs/test-pack",
                task_id="CAP-1",
            )
            archive = repo_context_app.get_archive_service()
            resolution = archive.resolve_parent_archive(
                context_pack_dir=str(workspace),
                parent_qmd_scope="qmd/context-packs/test-pack",
                parent_task_id="CAP-1",
            )
            carry = repo_context_app.build_carry_forward_summary(
                context_pack_dir=str(workspace),
                parent_qmd_scope="qmd/context-packs/test-pack",
                parent_task_id="CAP-1",
            )
            retrospective = repo_context_app.build_task_retrospective_summary(
                context_pack_dir=str(workspace),
                qmd_scope="qmd/context-packs/test-pack",
                task_id="CAP-1",
            )
            shared = (
                repo_context_app.load_shared_retrospective_memory_summary()
            )
            conventions = repo_context_app.load_context_pack_conventions_summary(
                context_pack_dir=str(workspace),
            )

            self.assertEqual(lineage, {"lineage": True})
            self.assertIs(resolution, mock.sentinel.archive_resolution)
            self.assertEqual(carry, {"carry": True})
            self.assertEqual(retrospective["retrospective"], True)
            self.assertEqual(shared["shared"], True)
            self.assertEqual(
                Path(conventions["context_pack_dir"]).resolve(),
                workspace.resolve(),
            )
            self.assertEqual(
                repo_context_app.REPORT_RENDERER.render_task_lineage_summary(
                    {"lineage": True}
                ),
                "lineage markdown",
            )
            self.assertEqual(
                repo_context_app.REPORT_RENDERER.render_carry_forward_summary(
                    {"carry": True}
                ),
                "carry markdown",
            )
            render_lineage.assert_called()
            render_carry.assert_called()
            archive_ctor.assert_called_once()
            carry_ctor.assert_called_once()

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

    def test_run_server_uses_httpserver_forever_loop(self) -> None:
        server = mock.Mock()

        with mock.patch.object(
            repo_context_app,
            "HTTPServer",
            return_value=server,
        ) as http_server:
            result = repo_context_app.run_server("127.0.0.1", 8999)

        self.assertEqual(result, 0)
        http_server.assert_called_once_with(
            ("127.0.0.1", 8999),
            repo_context_app.Handler,
        )
        server.serve_forever.assert_called_once_with()

    def test_path_helpers_markdown_builders_and_main_delegate(self) -> None:
        workspace = self.make_temp_dir()
        scope_dir = workspace / "scope"
        markdown_path = workspace / "note.md"
        markdown_path.write_text("# Note\n", encoding="utf-8")

        self.assertEqual(
            repo_context_app.record_storage_path(
                scope_dir,
                "backend",
                "platform",
                "src/main.py",
            ),
            scope_dir
            / "estate"
            / "backend"
            / "platform"
            / "records"
            / "src"
            / "main.py.json",
        )
        self.assertEqual(
            repo_context_app.sidecar_record_path(markdown_path),
            workspace / "note.md.record.json",
        )
        self.assertEqual(
            repo_context_app.state_file_path(scope_dir, "platform"),
            scope_dir
            / "operational"
            / "bootstrap"
            / "platform"
            / "seed-state.json",
        )
        self.assertEqual(
            repo_context_app.report_file_path(
                scope_dir,
                "2026-03-07T10:20:30Z",
            ),
            scope_dir
            / "operational"
            / "bootstrap"
            / "seed-runs"
            / "seed-run-20260307T102030Z.json",
        )
        self.assertEqual(
            repo_context_app.relative_source_path(workspace, markdown_path),
            "note.md",
        )

        markdown = repo_context_app.build_repo_summary_markdown(
            {
                "repo_id": "platform",
                "repo_name": "Platform",
                "system_layer": "backend",
                "bounded_context": None,
                "languages": ["python"],
            },
            workspace,
            "ref-123",
            ["src/main.py"],
            ["watch missing checkout"],
            "2026-03-07T00:00:00Z",
        )
        self.assertIn("## High-Signal Files", markdown)
        self.assertIn("## Warnings", markdown)

        bootstrap_markdown = repo_context_app.build_bootstrap_note_markdown(
            {
                "repo_id": "platform",
                "repo_name": "Platform",
                "qmd_scope": "qmd/context-packs/sample-pack",
            },
            workspace,
            "ref-123",
            3,
            1,
            ["refresh warning"],
            "2026-03-07T00:00:00Z",
        )
        self.assertIn("## Warnings", bootstrap_markdown)
        self.assertIn("Seeded Records: 3", bootstrap_markdown)

        conventions_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "sample-pack",
                [
                    {
                        "repo_id": "platform",
                        "repo_name": "Platform",
                        "source_paths": [
                            f"src/module_{index}.py" for index in range(20)
                        ],
                    }
                    for _ in range(12)
                ],
                "2026-03-07T00:00:00Z",
            )
        )
        self.assertIn(
            "Additional repositories omitted from this concise memo",
            conventions_markdown,
        )
        self.assertNotIn("src/module_19.py", conventions_markdown)

        degraded_markdown = (
            repo_context_app.build_context_pack_conventions_markdown(
                "empty-pack",
                [
                    {
                        "repo_id": "unknown-repo",
                        "repo_name": "Unknown Repo",
                        "warnings": ["No artifact_roots declared."],
                    }
                ],
                "2026-03-07T00:00:00Z",
            )
        )
        self.assertIn("none declared", degraded_markdown)
        self.assertIn("No artifact_roots declared.", degraded_markdown)

        context_pack_dir = workspace / "sample-pack"
        scope_dir = context_pack_dir / "qmd" / "context-packs" / "sample-pack"
        (context_pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
        (context_pack_dir / "qmd" / "repo-sources.json").write_text(
            json.dumps(
                {
                    "context_pack_id": "sample-pack",
                    "qmd_scope_root": "qmd/context-packs/sample-pack",
                    "repositories": [
                        {"repo_id": "platform", "repo_name": "platform"}
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        (scope_dir / "indexes").mkdir(parents=True, exist_ok=True)
        (scope_dir / "indexes" / "repositories.json").write_text(
            json.dumps(
                {
                    "repositories": [
                        {
                            "repo_id": "platform",
                            "seed_status": "seeded",
                        }
                    ]
                }
            )
            + "\n",
            encoding="utf-8",
        )

        with mock.patch.object(repo_context_app.Path, "cwd", return_value=workspace):
            missing_summary = repo_context_app.load_context_pack_conventions_summary(
                context_pack_dir="sample-pack",
            )

        self.assertEqual(
            missing_summary["conventions_summary_status"],
            "missing",
        )
        self.assertIn(
            "seed data exists",
            missing_summary["conventions_summary_reason"],
        )

        conventions_path = (
            scope_dir / "canonical" / "context-pack" / "codebase-conventions.md"
        )
        conventions_path.parent.mkdir(parents=True, exist_ok=True)
        conventions_path.write_text(
            "# Sample Pack Codebase Conventions\n",
            encoding="utf-8",
        )
        conventions_record_path = conventions_path.with_name(
            "codebase-conventions.md.record.json"
        )
        conventions_record_path.write_text("{", encoding="utf-8")

        with mock.patch.object(repo_context_app.Path, "cwd", return_value=workspace):
            available_summary = repo_context_app.load_context_pack_conventions_summary(
                context_pack_dir="sample-pack",
            )

        self.assertEqual(
            available_summary["conventions_summary_status"],
            "available",
        )
        self.assertIn(
            "Sample Pack Codebase Conventions",
            available_summary["conventions_summary_markdown"],
        )
        self.assertIn(
            "conventions_summary_record_error",
            available_summary,
        )
        self.assertEqual(
            repo_context_app.render_context_pack_conventions_summary(
                available_summary
            ),
            available_summary["conventions_summary_markdown"],
        )

        cli = mock.Mock()
        cli.run.return_value = 9
        with mock.patch.object(
            repo_context_app,
            "create_cli",
            return_value=cli,
        ):
            self.assertEqual(repo_context_app.main(["seed"]), 9)
        cli.run.assert_called_once_with(["seed"], repo_context_app.run_server)

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


    # ------------------------------------------------------------------
    # Slice-03 tests: archive service singleton
    # ------------------------------------------------------------------

    def test_get_archive_service_returns_singleton(self) -> None:
        saved = repo_context_app._ARCHIVE_SERVICE
        try:
            repo_context_app._ARCHIVE_SERVICE = None
            first = repo_context_app.get_archive_service()
            second = repo_context_app.get_archive_service()
            self.assertIs(first, second)
        finally:
            repo_context_app._ARCHIVE_SERVICE = saved

    def test_archive_service_singleton_uses_config_retro_root(self) -> None:
        saved = repo_context_app._ARCHIVE_SERVICE
        try:
            repo_context_app._ARCHIVE_SERVICE = None
            service = repo_context_app.get_archive_service()
            self.assertEqual(
                service._glopml_retro_root,
                repo_context_app.REPO_CONTEXT_CONFIG.global_retrospective_root,
            )
        finally:
            repo_context_app._ARCHIVE_SERVICE = saved


if __name__ == "__main__":
    unittest.main()
