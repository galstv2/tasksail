from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class UpgradePackSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.script_path = (
            cls.repo_root
            / "src"
            / "backend"
            / "scripts"
            / "python"
            / "upgrade-pack-schema.py"
        )

    def run_script(
        self,
        *args: str,
        log_dir: Path,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["LOG_DIR"] = str(log_dir)
        return subprocess.run(
            ["python3", str(self.script_path), *args],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
            env=env,
        )

    def write_manifest(self, pack_dir: Path, content: str) -> Path:
        manifest_path = pack_dir / "qmd" / "repo-sources.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(content, encoding="utf-8")
        return manifest_path

    def read_single_log_row(self, log_dir: Path, level: str) -> dict:
        log_files = list((log_dir / level).glob("backend-py-*.jsonl"))
        self.assertEqual(len(log_files), 1)
        rows = [
            json.loads(line)
            for line in log_files[0].read_text(encoding="utf-8").splitlines()
        ]
        return rows[-1]

    def test_malformed_manifest_logs_structured_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            pack_dir = temp_path / "sample-pack"
            log_dir = temp_path / "logs"
            manifest_path = self.write_manifest(pack_dir, "{bad-json")

            completed = self.run_script(
                "--context-pack-dir",
                str(pack_dir),
                log_dir=log_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["action"], "skip")
            self.assertEqual(result["reason"], "schema_error")

            row = self.read_single_log_row(log_dir, "warn")
            self.assertEqual(row["msg"], "pack_schema_upgrade.manifest.load.failed")
            self.assertEqual(row["module"], "scripts/python/upgrade-pack-schema")
            self.assertEqual(row["extra"]["manifest_path"], str(manifest_path.resolve()))

    def test_invalid_v2_manifest_logs_structured_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            pack_dir = temp_path / "sample-pack"
            log_dir = temp_path / "logs"
            manifest_path = self.write_manifest(
                pack_dir,
                json.dumps({"manifest_version": "qmd-repo-sources/v2"}) + "\n",
            )

            completed = self.run_script(
                "--context-pack-dir",
                str(pack_dir),
                log_dir=log_dir,
            )

            self.assertEqual(completed.returncode, 1)
            result = json.loads(completed.stdout)
            self.assertEqual(result["action"], "skip")
            self.assertTrue(result["reason"].startswith("error:"))

            row = self.read_single_log_row(log_dir, "error")
            self.assertEqual(row["msg"], "pack_schema_upgrade.pack.failed")
            self.assertEqual(row["module"], "scripts/python/upgrade-pack-schema")
            self.assertEqual(row["extra"]["context_pack_dir"], str(pack_dir.resolve()))
            self.assertEqual(row["extra"]["manifest_path"], str(manifest_path.resolve()))
            self.assertEqual(row["extra"]["phase"], "normalize_v2")


if __name__ == "__main__":
    unittest.main()
