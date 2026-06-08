from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


class DocsOperatingModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.docs_root = cls.repo_root / "docs"
        cls.readme = (cls.repo_root / "README.md").read_text(encoding="utf-8")
        cls.docs_index = (cls.docs_root / "README.md").read_text(encoding="utf-8")
        cls.desktop_readme = (
            cls.repo_root / "src" / "frontend" / "desktop" / "README.md"
        ).read_text(encoding="utf-8")
        cls.env_example = (cls.repo_root / ".env.example").read_text(
            encoding="utf-8"
        )
        cls.command_matrix = (
            cls.repo_root / "scratchspace" / "docs-alignment" / "command-matrix.md"
        ).read_text(encoding="utf-8")
        cls.environment_matrix = (
            cls.repo_root
            / "scratchspace"
            / "docs-alignment"
            / "environment-matrix.md"
        ).read_text(encoding="utf-8")
        cls.platform_coverage = (
            cls.repo_root
            / "scratchspace"
            / "docs-alignment"
            / "platform-module-coverage.md"
        ).read_text(encoding="utf-8")
        cls.python_service_map = (
            cls.repo_root
            / "scratchspace"
            / "docs-alignment"
            / "python-service-map.md"
        ).read_text(encoding="utf-8")
        cls.screenshot_manifest = (
            cls.repo_root
            / "scratchspace"
            / "docs-alignment"
            / "screenshot-manifest.md"
        ).read_text(encoding="utf-8")
        cls.package_json = json.loads(
            (cls.repo_root / "package.json").read_text(encoding="utf-8")
        )
        cls.desktop_package_json = json.loads(
            (
                cls.repo_root
                / "src"
                / "frontend"
                / "desktop"
                / "package.json"
            ).read_text(encoding="utf-8")
        )

    REQUIRED_GETTING_STARTED = (
        "00-what-is-tasksail.md",
        "01-install-prerequisites.md",
        "02-first-run.md",
        "03-create-your-first-task.md",
        "04-troubleshooting.md",
        "agent-setup-assistant.md",
    )

    STALE_PUBLIC_PATTERNS = (
        r"docs/(architecture|workflow|qmd|reference)",
        r"cross-os-setup\.md",
        r"wsl-smoke\.md",
        r"getting-started/onboarding\.md",
        r"migration/shared-mcp-container\.md",
        r"Electron 35",
        r"--bootstrap-answers-file",
        r"plan-followup-task",
        r"watch-dropbox",
        r"agent:status",
        r"agent:kill",
        r"gpt-5\.4",
        r"claude-sonnet-4\.6",
    )

    def test_docs_tree_has_two_reader_paths(self) -> None:
        top_dirs = {path.name for path in self.docs_root.iterdir() if path.is_dir()}
        top_files = {path.name for path in self.docs_root.iterdir() if path.is_file()}

        self.assertEqual(top_dirs, {"getting-started", "technical"})
        self.assertEqual(top_files, {"README.md"})

    def test_required_getting_started_files_exist_and_are_closed(self) -> None:
        getting_started = self.docs_root / "getting-started"
        forbidden_link = re.compile(
            r"\]\((\.\./)?technical/|\]\(/?docs/technical/|docs/technical/"
        )

        for filename in self.REQUIRED_GETTING_STARTED:
            path = getting_started / filename
            with self.subTest(file=filename):
                text = path.read_text(encoding="utf-8")
                self.assertGreater(len(text.strip()), 80)
                self.assertNotRegex(text, forbidden_link)

    def test_entry_surfaces_are_thin_routes(self) -> None:
        self.assertIn("[TaskSail docs](docs/README.md)", self.readme)
        self.assertIn(
            "[Getting Started](docs/getting-started/00-what-is-tasksail.md)",
            self.readme,
        )
        self.assertIn(
            "[Technical Reference](docs/technical/architecture/overview.md)",
            self.readme,
        )
        self.assertLess(self.readme.count("\n"), 80)

        self.assertIn("../../../docs/README.md", self.desktop_readme)
        self.assertIn(
            "../../../docs/getting-started/00-what-is-tasksail.md",
            self.desktop_readme,
        )
        self.assertLess(self.desktop_readme.count("\n"), 60)

    def test_public_docs_omit_stale_paths_aliases_and_model_pins(self) -> None:
        public_text = "\n".join(
            [
                self.readme,
                self.docs_index,
                self.desktop_readme,
                self.env_example,
                *[
                    path.read_text(encoding="utf-8")
                    for path in self.docs_root.rglob("*.md")
                ],
            ]
        )
        for pattern in self.STALE_PUBLIC_PATTERNS:
            with self.subTest(pattern=pattern):
                self.assertNotRegex(public_text, pattern)

    def test_technical_pages_have_final_source_footers(self) -> None:
        link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
        for path in sorted((self.docs_root / "technical").rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path.relative_to(self.repo_root))):
                self.assertEqual(text.count("\n## Sources of truth\n"), 1)
                _, footer = text.split("\n## Sources of truth\n")
                self.assertNotIn("\n## ", footer)
                links = [
                    target.split("#", 1)[0]
                    for target in link_re.findall(footer)
                    if not target.startswith(("http://", "https://", "mailto:"))
                ]
                self.assertTrue(links)
                for target in links:
                    self.assertTrue((path.parent / target).resolve().exists())

    def test_documented_commands_are_backed_by_current_scripts(self) -> None:
        root_scripts = self.package_json["scripts"]
        desktop_scripts = self.desktop_package_json["scripts"]

        for script in (
            "setup",
            "validate",
            "plan-dropbox-task",
            "queue-status",
            "repair",
            "check-sizes",
            "check-comments",
            "check-open-source-readiness",
            "check-test-floor",
        ):
            with self.subTest(root_script=script):
                self.assertIn(script, root_scripts)
                self.assertIn(f"pnpm run {script}", self.command_matrix)

        for script in ("dev", "test", "lint", "build", "validate:desktop"):
            with self.subTest(desktop_script=script):
                self.assertIn(script, desktop_scripts)
                self.assertIn(f"npm run {script}", self.command_matrix)

    def test_environment_platform_and_python_inventories_cover_sources(self) -> None:
        for term in (
            "REPO_CONTEXT_MCP_REQUIRE_GET_AUTH",
            "TASKSAIL_LOCAL_MCP_ENABLED",
            "external_mcp_local_enabled",
            "PIP_CONFIG_FILE",
            "TASKSAIL_CLI_PROVIDER",
        ):
            with self.subTest(env=term):
                self.assertIn(term, self.environment_matrix)

        for module in sorted(
            path.name
            for path in (self.repo_root / "src/backend/platform").iterdir()
            if path.is_dir()
        ):
            with self.subTest(module=module):
                self.assertRegex(self.platform_coverage, rf"(^|[| ]){re.escape(module)}([| ]|$)")

        for service in (
            "context_estate",
            "pack",
            "pack_schemas",
            "repo_context_mcp",
            "archive",
            "retrospective",
            "reinforcement",
            "workspace_context_sync",
        ):
            with self.subTest(service=service):
                self.assertIn(service, self.python_service_map)

    def test_screenshot_manifest_records_missing_evidence_without_assets(self) -> None:
        self.assertIn("No screenshots were captured", self.screenshot_manifest)
        self.assertFalse((self.docs_root / "getting-started" / "images").exists())


if __name__ == "__main__":
    unittest.main()
