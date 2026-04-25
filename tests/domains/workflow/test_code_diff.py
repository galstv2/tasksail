from __future__ import annotations

import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

HELPER_SCRIPT = SCRIPT_DIR / "run-role-agent-helper.py"

from lib.role_agent import code_diff  # noqa: E402


def _init_git_repo(repo_path: Path) -> None:
    subprocess.run(
        ["git", "init"],
        cwd=repo_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=repo_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "TaskSail Tests"],
        cwd=repo_path,
        check=True,
        capture_output=True,
    )


class CaptureCodeDiffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="code-diff-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_helper_cli_uses_repo_root_when_context_pack_is_omitted(self) -> None:
        repo_dir = self.tmpdir / "repo-root"
        repo_dir.mkdir()
        _init_git_repo(repo_dir)

        tracked_file = repo_dir / "tracked.txt"
        tracked_file.write_text("before\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "tracked.txt"],
            cwd=repo_dir,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "init"],
            cwd=repo_dir,
            check=True,
            capture_output=True,
        )
        tracked_file.write_text("after\n", encoding="utf-8")

        output_path = self.tmpdir / "code-changes.diff"
        completed = subprocess.run(
            [
                "python3",
                str(HELPER_SCRIPT),
                "capture-code-diff",
                str(output_path),
                "--repo-root",
                str(repo_dir),
            ],
            cwd=str(REPO_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertEqual(completed.stdout.strip(), repo_dir.name)
        content = output_path.read_text(encoding="utf-8")
        self.assertIn(f"#   - {repo_dir.name}", content)
        self.assertIn("# --- Repo: repo-root", content)
        self.assertIn("tracked.txt", content)

    def test_non_git_repo_writes_empty_sentinel(self) -> None:
        repo_dir = self.tmpdir / "plain-dir"
        repo_dir.mkdir()
        output_path = self.tmpdir / "empty.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            None,
            str(output_path),
            repo_root=str(repo_dir),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [repo_dir.name])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn(f"#   - {repo_dir.name}", content)
        self.assertIn("No git diff available", content)

    def test_repo_failures_do_not_abort_aggregate_diff_generation(self) -> None:
        output_path = self.tmpdir / "aggregate.diff"
        good_repo = self.tmpdir / "good"
        bad_repo = self.tmpdir / "bad"
        good_repo.mkdir()
        bad_repo.mkdir()

        def diff_side_effect(repo_path: Path) -> str:
            if repo_path == bad_repo:
                raise RuntimeError("boom")
            return "diff --git a/a b/a\n"

        with (
            mock.patch.object(
                code_diff,
                "_resolve_repo_entries",
                return_value=[("good", good_repo), ("bad", bad_repo)],
            ),
            mock.patch.object(code_diff, "_git_diff", side_effect=diff_side_effect),
        ):
            exit_code, repo_names = code_diff.capture_code_diff(
                None,
                str(output_path),
                repo_root=str(self.tmpdir),
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["good", "bad"])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("# --- Repo: good", content)
        self.assertIn("diff --git a/a b/a", content)
        self.assertNotIn("# --- Repo: bad", content)

    def test_write_failures_return_actionable_error_output(self) -> None:
        repo_dir = self.tmpdir / "repo"
        repo_dir.mkdir()
        stderr = io.StringIO()

        with (
            mock.patch.object(Path, "write_text", side_effect=OSError("disk full")),
            contextlib.redirect_stderr(stderr),
        ):
            exit_code, repo_names = code_diff.capture_code_diff(
                None,
                str(self.tmpdir / "broken.diff"),
                repo_root=str(repo_dir),
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, [repo_dir.name])
        self.assertIn("Failed to write diff artifact", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
