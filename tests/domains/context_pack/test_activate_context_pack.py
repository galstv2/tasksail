from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class ActivateContextPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.cli_path = (
            cls.repo_root
            / "src"
            / "backend"
            / "platform"
            / "context-pack"
            / "cli.ts"
        )
        cls.helper_path = (
            cls.repo_root
            / "src"
            / "backend"
            / "scripts"
            / "python"
            / "activate-context-pack-helper.py"
        )

    def setUp(self) -> None:
        self.env_path = self.repo_root / ".env"
        self.original_env = (
            self.env_path.read_text(encoding="utf-8")
            if self.env_path.exists()
            else None
        )

    def tearDown(self) -> None:
        if self.original_env is None:
            if self.env_path.exists():
                self.env_path.unlink()
        else:
            self.env_path.write_text(self.original_env, encoding="utf-8")

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["npx", "tsx", str(self.cli_path), "activate", *args],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
        )

    def run_helper(
        self,
        *args: str,
        input_text: str | None = None,
        log_dir: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        if log_dir is not None:
            env["LOG_DIR"] = str(log_dir)
        return subprocess.run(
            ["python3", str(self.helper_path), *args],
            cwd=self.repo_root,
            text=True,
            input=input_text,
            capture_output=True,
            env=env,
        )

    def write_file(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_bootstrap_answers(self, path: Path, *, context_pack_id: str, repo_root: Path) -> None:
        payload = {
            "context_pack_id": context_pack_id,
            "estate_name": "Greenfield Estate",
            "repositories": [
                {
                    "repo_name": "Greenfield Service",
                    "repo_id": "greenfield-service",
                    "owner": "sample-org",
                    "system_layer": "backend",
                    "languages": ["python"],
                    "artifact_roots": ["src"],
                    "document_paths": ["docs"],
                    "bounded_context": "payments",
                    "service_name": "greenfield-api",
                    "repo_root": str(repo_root.resolve()),
                }
            ],
        }
        self.write_file(path, json.dumps(payload) + "\n")

    def write_multi_repo_bootstrap_answers(
        self,
        path: Path,
        *,
        context_pack_id: str,
        backend_root: Path,
        frontend_root: Path,
    ) -> None:
        payload = {
            "context_pack_id": context_pack_id,
            "estate_name": "Distributed Greenfield Estate",
            "repositories": [
                {
                    "repo_name": "Orders API",
                    "repo_id": "orders-api",
                    "owner": "sample-org",
                    "system_layer": "backend",
                    "languages": ["python"],
                    "artifact_roots": ["src"],
                    "document_paths": ["docs"],
                    "bounded_context": "orders",
                    "service_name": "orders-api",
                    "repo_root": str(backend_root.resolve()),
                },
                {
                    "repo_name": "Orders Web",
                    "repo_id": "orders-web",
                    "owner": "sample-org",
                    "system_layer": "frontend",
                    "languages": ["typescript"],
                    "artifact_roots": ["web"],
                    "document_paths": ["docs"],
                    "bounded_context": "orders",
                    "service_name": "orders-web",
                    "repo_root": str(frontend_root.resolve()),
                },
            ],
        }
        self.write_file(path, json.dumps(payload) + "\n")

    def test_activation_succeeds_with_qmd_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "sample-pack"
            self.write_file(
                context_pack_dir / "qmd" / "repo-sources.json",
                json.dumps(
                    {
                        "context_pack_id": "sample-org",
                        "qmd_scope_root": "qmd/context-packs/sample-org",
                        "repositories": [
                            {
                                "repo_id": "platform",
                                "repo_name": "tasksail",
                                "local_paths": ["../tasksail"],
                            }
                        ],
                    }
                )
                + "\n",
            )

            completed = self.run_script(
                "--context-pack-dir",
                str(context_pack_dir),
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            self.assertTrue(result["activated"])

    def test_activation_creates_env_from_example_when_missing(self) -> None:
        if self.env_path.exists():
            self.env_path.unlink()

        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "sample-pack"
            self.write_file(
                context_pack_dir / "qmd" / "repo-sources.json",
                json.dumps(
                    {
                        "context_pack_id": "sample-org",
                        "qmd_scope_root": "qmd/context-packs/sample-org",
                        "repositories": [],
                    }
                )
                + "\n",
            )

            completed = self.run_script(
                "--context-pack-dir",
                str(context_pack_dir),
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            self.assertTrue(self.env_path.exists())

    def test_activation_fails_without_qmd_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "sample-pack"
            context_pack_dir.mkdir(parents=True)

            completed = self.run_script(
                "--context-pack-dir",
                str(context_pack_dir),
            )

            self.assertNotEqual(completed.returncode, 0)

    def test_extract_json_field_logs_malformed_json_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            log_dir = temp_path / "logs"
            payload_path = temp_path / "payload.json"
            payload_path.write_text("{bad-json", encoding="utf-8")

            completed = self.run_helper(
                "extract-json-field",
                str(payload_path),
                "status",
                log_dir=log_dir,
            )

            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout, "")
            log_files = list((log_dir / "error").glob("backend-py-*.jsonl"))
            self.assertEqual(len(log_files), 1)
            rows = [
                json.loads(line)
                for line in log_files[0].read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                rows[-1]["msg"],
                "context_pack_activation.extract_json_field.failed",
            )
            self.assertEqual(
                rows[-1]["module"],
                "scripts/python/activate-context-pack-helper",
            )
            self.assertEqual(rows[-1]["extra"]["field_name"], "status")

    def test_extract_json_stdin_field_logs_malformed_json_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            log_dir = Path(temp_root) / "logs"

            completed = self.run_helper(
                "extract-json-stdin-field",
                "status",
                input_text="{bad-json",
                log_dir=log_dir,
            )

            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout, "")
            log_files = list((log_dir / "error").glob("backend-py-*.jsonl"))
            self.assertEqual(len(log_files), 1)
            rows = [
                json.loads(line)
                for line in log_files[0].read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                rows[-1]["msg"],
                "context_pack_activation.extract_json_stdin_field.failed",
            )
            self.assertEqual(
                rows[-1]["module"],
                "scripts/python/activate-context-pack-helper",
            )
            self.assertEqual(rows[-1]["extra"]["field_name"], "status")

    @unittest.skip(
        "TS CLI activate does not support --write-plan; "
        "dry-run plan generation is not yet ported to TypeScript."
    )
    def test_activation_generates_dry_run_plan_with_write_plan(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not report existing dry-run plan status; "
        "QMD plan reporting is not yet ported to TypeScript."
    )
    def test_activation_reports_existing_dry_run_plan(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not support bootstrap-and-seed workflow; "
        "bootstrap is not yet ported to TypeScript."
    )
    def test_activation_bootstraps_and_seeds_new_single_repo_context_pack(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not support bootstrap-and-seed workflow; "
        "bootstrap is not yet ported to TypeScript."
    )
    def test_activation_bootstrap_supports_multi_repo_estate_answers(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not support bootstrap-and-seed workflow; "
        "bootstrap is not yet ported to TypeScript."
    )
    def test_activation_bootstrap_supports_monolith_focus_contracts(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not support bootstrap-and-seed workflow; "
        "bootstrap is not yet ported to TypeScript."
    )
    def test_bootstrap_requires_structured_answers_when_not_interactive(self) -> None:
        pass

    @unittest.skip(
        "TS CLI activate does not support bootstrap-and-seed workflow; "
        "bootstrap contract mismatch checking is not yet ported to TypeScript."
    )
    def test_activation_blocks_bootstrap_contract_mismatch(self) -> None:
        pass



if __name__ == "__main__":
    unittest.main()
