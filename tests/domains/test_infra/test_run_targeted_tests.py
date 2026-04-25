from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = REPO_ROOT / "src" / "backend" / "scripts" / "python" / "run-targeted-tests.py"
MANIFEST_PATH = REPO_ROOT / "tests" / "test_manifest.json"


def load_runner_module():
    spec = importlib.util.spec_from_file_location(
        "run_targeted_tests",
        RUNNER_PATH,
    )
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RunTargetedTestsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runner = load_runner_module()

    def create_temp_dir(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        return Path(temp_dir.name)

    def write_manifest(
        self,
        workspace: Path,
        payload: dict[str, object],
    ) -> Path:
        tests_dir = workspace / "tests"
        tests_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = tests_dir / "test_manifest.json"
        manifest_path.write_text(
            json.dumps(payload, indent=2) + "\n",
            encoding="utf-8",
        )
        return manifest_path

    def write_test_module(
        self,
        workspace: Path,
        *,
        module_basename: str,
        marker_name: str,
        should_fail: bool = False,
    ) -> str:
        tests_dir = workspace / "tests"
        tests_dir.mkdir(parents=True, exist_ok=True)
        module_path = tests_dir / f"{module_basename}.py"
        marker_path = workspace / marker_name
        assertion_line = (
            "        self.assertTrue(False)\n"
            if should_fail
            else "        self.assertTrue(True)\n"
        )
        module_path.write_text(
            (
                "from pathlib import Path\n"
                "import unittest\n\n\n"
                "class GeneratedTest(unittest.TestCase):\n"
                "    def test_generated(self) -> None:\n"
                f"        Path({str(marker_path)!r}).write_text(\n"
                "            \"ran\\n\",\n"
                "            encoding=\"utf-8\",\n"
                "        )\n"
                f"{assertion_line}"
            ),
            encoding="utf-8",
        )
        return f"tests.{module_basename}"

    def run_cli(
        self,
        workspace: Path,
        *args: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(RUNNER_PATH),
                "--workspace-root",
                str(workspace),
                *args,
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )

    def test_load_manifest_accepts_valid_lanes_and_domains(self) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        self.assertIn("smoke", manifest.lanes)
        self.assertIn("workflow", manifest.domains)
        self.assertIn("contracts", manifest.lanes)
        self.assertTrue(manifest.path_rules)

    def test_load_manifest_rejects_missing_domains(self) -> None:
        workspace = self.create_temp_dir()
        manifest_path = self.write_manifest(
            workspace,
            {
                "lanes": {"smoke": ["tests.test_example"]},
                "path_rules": {},
            },
        )

        with self.assertRaisesRegex(
            self.runner.ManifestError,
            "non-empty 'domains' object",
        ):
            self.runner.load_manifest(
                manifest_path,
                workspace_root=workspace,
            )

    def test_unknown_lane_is_rejected_clearly(self) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        with self.assertRaisesRegex(
            self.runner.ManifestError,
            "Unknown lane 'missing'",
        ):
            self.runner.resolve_modules(
                manifest,
                lanes=["missing"],
                workspace_root=REPO_ROOT,
            )

    def test_unknown_domain_is_rejected_clearly(self) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        with self.assertRaisesRegex(
            self.runner.ManifestError,
            "Unknown domain 'missing'",
        ):
            self.runner.resolve_modules(
                manifest,
                domains=["missing"],
                workspace_root=REPO_ROOT,
            )

    def test_changed_path_mapping_returns_expected_domains(self) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        domains = self.runner.infer_domains_from_changed_paths(
            [
                "src/backend/platform/workflow-policy/validator.ts",
                "docs/architecture/platform-spec.md",
            ],
            manifest,
            workspace_root=REPO_ROOT,
        )

        self.assertEqual(domains, ("workflow", "docs_contracts"))

    def test_explicit_module_execution_respects_order_and_deduplication(
        self,
    ) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        resolution = self.runner.resolve_modules(
            manifest,
            explicit_modules=[
                "tests.domains.parallel.test_parallel_status",
                "tests.domains.parallel.test_parallel_runtime_state",
                "tests.domains.parallel.test_parallel_status",
            ],
            workspace_root=REPO_ROOT,
        )

        self.assertEqual(
            resolution.modules,
            (
                "tests.domains.parallel.test_parallel_status",
                "tests.domains.parallel.test_parallel_runtime_state",
            ),
        )

    def test_smoke_lane_invocation_executes_only_declared_smoke_modules(
        self,
    ) -> None:
        workspace = self.create_temp_dir()
        selected_module = self.write_test_module(
            workspace,
            module_basename="test_selected",
            marker_name="selected.marker",
        )
        self.write_test_module(
            workspace,
            module_basename="test_excluded",
            marker_name="excluded.marker",
            should_fail=True,
        )
        manifest_path = self.write_manifest(
            workspace,
            {
                "lanes": {"smoke": [selected_module]},
                "domains": {"demo": [selected_module]},
                "path_rules": {"src/demo/": ["demo"]},
            },
        )

        result = self.run_cli(
            workspace,
            "--manifest",
            str(manifest_path),
            "--lane",
            "smoke",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((workspace / "selected.marker").exists())
        self.assertFalse((workspace / "excluded.marker").exists())
        self.assertIn("Selected 1 test module", result.stdout)

    def test_smoke_lane_excludes_agent_launch_modules(self) -> None:
        manifest = self.runner.load_manifest(
            MANIFEST_PATH,
            workspace_root=REPO_ROOT,
        )

        forbidden_prefixes = (
            "tests.domains.e2e.",
            "tests.domains.queue.test_queue_runtime_",
        )
        forbidden_modules = {
            "tests.domains.workflow.test_run_role_agent",
        }
        smoke_modules = manifest.lanes["smoke"]

        self.assertFalse(
            any(
                module.startswith(forbidden_prefixes)
                or module in forbidden_modules
                for module in smoke_modules
            ),
            "Smoke lane must not include tests that can launch real role agents.",
        )

    def test_domain_invocation_executes_only_declared_domain_modules(
        self,
    ) -> None:
        workspace = self.create_temp_dir()
        selected_module = self.write_test_module(
            workspace,
            module_basename="test_domain_selected",
            marker_name="domain-selected.marker",
        )
        self.write_test_module(
            workspace,
            module_basename="test_domain_excluded",
            marker_name="domain-excluded.marker",
            should_fail=True,
        )
        manifest_path = self.write_manifest(
            workspace,
            {
                "lanes": {"smoke": [selected_module]},
                "domains": {
                    "parallel": [selected_module],
                    "other": ["tests.test_domain_excluded"],
                },
                "path_rules": {},
            },
        )

        result = self.run_cli(
            workspace,
            "--manifest",
            str(manifest_path),
            "--domain",
            "parallel",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((workspace / "domain-selected.marker").exists())
        self.assertFalse((workspace / "domain-excluded.marker").exists())

    def test_changed_path_targeting_executes_expected_domain_modules(
        self,
    ) -> None:
        workspace = self.create_temp_dir()
        selected_module = self.write_test_module(
            workspace,
            module_basename="test_changed_selected",
            marker_name="changed-selected.marker",
        )
        self.write_test_module(
            workspace,
            module_basename="test_changed_excluded",
            marker_name="changed-excluded.marker",
            should_fail=True,
        )
        manifest_path = self.write_manifest(
            workspace,
            {
                "lanes": {"smoke": [selected_module]},
                "domains": {
                    "parallel": [selected_module],
                    "other": ["tests.test_changed_excluded"],
                },
                "path_rules": {
                    "src/backend/platform/workflow-policy/rules/parallelOkContent.ts": ["parallel"],
                    "docs/": ["other"],
                },
            },
        )

        result = self.run_cli(
            workspace,
            "--manifest",
            str(manifest_path),
            "--changed-path",
            "src/backend/platform/workflow-policy/rules/parallelOkContent.ts",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((workspace / "changed-selected.marker").exists())
        self.assertFalse((workspace / "changed-excluded.marker").exists())

    def test_resolve_only_json_output_lists_changed_path_domains(self) -> None:
        workspace = self.create_temp_dir()
        selected_module = self.write_test_module(
            workspace,
            module_basename="test_json_selected",
            marker_name="json-selected.marker",
        )
        manifest_path = self.write_manifest(
            workspace,
            {
                "lanes": {"smoke": [selected_module]},
                "domains": {"parallel": [selected_module]},
                "path_rules": {
                    "src/backend/platform/workflow-policy/rules/parallelOkContent.ts": ["parallel"]
                },
            },
        )

        result = self.run_cli(
            workspace,
            "--manifest",
            str(manifest_path),
            "--changed-path",
            "src/backend/platform/workflow-policy/rules/parallelOkContent.ts",
            "--resolve-only",
            "--format",
            "json",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["modules"], [selected_module])
        self.assertEqual(payload["changed_path_domains"], ["parallel"])
