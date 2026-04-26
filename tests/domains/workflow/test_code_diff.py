from __future__ import annotations

import contextlib
import io
import json
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


def _run_git(repo_path: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=repo_path,
        check=True,
        capture_output=True,
    )


def _init_git_repo(repo_path: Path) -> None:
    _run_git(repo_path, "init")
    _run_git(repo_path, "config", "user.email", "test@example.com")
    _run_git(repo_path, "config", "user.name", "TaskSail Tests")


def _commit_base(repo_path: Path, filename: str = "tracked.txt") -> str:
    (repo_path / filename).write_text("before\n", encoding="utf-8")
    _run_git(repo_path, "add", filename)
    _run_git(repo_path, "commit", "-m", "init")
    return _run_git(repo_path, "rev-parse", "HEAD").stdout.decode().strip()


class CaptureCodeDiffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="code-diff-"))
        self.platform_root = self.tmpdir / "platform"
        self.platform_root.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_sidecar(
        self,
        task_id: str,
        bindings: list[dict[str, str]],
        *,
        platform_root: Path | None = None,
    ) -> Path:
        root = platform_root or self.platform_root
        task_dir = root / "AgentWorkSpace" / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        sidecar = task_dir / ".task.json"
        sidecar.write_text(
            json.dumps({"contextPackBinding": {"repoBindings": bindings}}),
            encoding="utf-8",
        )
        return sidecar

    def _create_worktree_binding(
        self,
        task_id: str,
        slug: str = "repo-root",
        *,
        original_slug: str | None = None,
    ) -> tuple[Path, Path, dict[str, str]]:
        original = self.tmpdir / (original_slug or f"original-{slug}")
        original.mkdir()
        _init_git_repo(original)
        base_sha = _commit_base(original)

        worktree = (
            self.platform_root / "AgentWorkSpace" / "tasks" / task_id / "worktrees" / slug
        )
        worktree.parent.mkdir(parents=True, exist_ok=True)
        branch = f"task/{task_id}-{slug}"
        _run_git(original, "worktree", "add", "-b", branch, str(worktree), "HEAD")
        binding = {
            "originalRoot": str(original),
            "worktreeRoot": str(worktree),
            "worktreeBranch": branch,
            "baseCommitSha": base_sha,
        }
        return original, worktree, binding

    def test_helper_cli_uses_task_sidecar_worktree_bindings(self) -> None:
        task_id = "task-cli"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (worktree / "tracked.txt").write_text("after\n", encoding="utf-8")

        output_path = self.tmpdir / "code-changes.diff"
        completed = subprocess.run(
            [
                "python3",
                str(HELPER_SCRIPT),
                "capture-code-diff",
                str(output_path),
                "--repo-root",
                str(self.platform_root),
                "--task-id",
                task_id,
            ],
            cwd=str(REPO_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertEqual(completed.stdout.strip(), worktree.name)
        content = output_path.read_text(encoding="utf-8")
        self.assertIn(f"#   - {worktree.name}", content)
        self.assertIn("# --- Worktree: repo-root", content)
        self.assertIn("tracked.txt", content)
        self.assertIn("+after", content)

    def test_diff_captures_worktree_edits_not_origin_edits(self) -> None:
        task_id = "task-worktree-scope"
        original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (worktree / "tracked.txt").write_text("worktree edit\n", encoding="utf-8")
        (original / "tracked.txt").write_text("origin edit\n", encoding="utf-8")
        output_path = self.tmpdir / "scoped.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("+worktree edit", content)
        self.assertNotIn("origin edit", content)

    def test_diff_writes_sentinel_when_worktree_has_no_changes(self) -> None:
        task_id = "task-empty-worktree"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        output_path = self.tmpdir / "empty.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        self.assertEqual(
            output_path.read_text(encoding="utf-8"),
            "# Active per-task worktrees in review scope:\n"
            f"#   - {worktree.name}\n"
            "#\n"
            "# No git diff available. Skip this file and scope "
            "your review to the files listed in the assigned slice.\n",
        )

    def test_diff_writes_sentinel_when_sidecar_missing(self) -> None:
        output_path = self.tmpdir / "missing-sidecar.diff"

        with self.assertLogs(code_diff.logger, level="WARNING") as logs:
            exit_code, repo_names = code_diff.capture_code_diff(
                repo_root=str(self.platform_root),
                task_id="missing-sidecar",
                output_path=str(output_path),
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [])
        self.assertIn("No git diff available", output_path.read_text(encoding="utf-8"))
        self.assertIn("task sidecar missing", "\n".join(logs.output))

    def test_diff_writes_sentinel_when_sidecar_has_no_bindings(self) -> None:
        task_id = "task-no-bindings"
        self._write_sidecar(task_id, [])
        output_path = self.tmpdir / "no-bindings.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [])
        self.assertEqual(
            output_path.read_text(encoding="utf-8"),
            "# Active per-task worktrees in review scope:\n"
            "#\n"
            "# No git diff available. Skip this file and scope "
            "your review to the files listed in the assigned slice.\n",
        )

    def test_diff_captures_multiple_worktrees(self) -> None:
        task_id = "task-multiple"
        _original_one, worktree_one, binding_one = self._create_worktree_binding(
            task_id,
            "repo-one",
            original_slug="original-one",
        )
        _original_two, worktree_two, binding_two = self._create_worktree_binding(
            task_id,
            "repo-two",
            original_slug="original-two",
        )
        self._write_sidecar(task_id, [binding_one, binding_two])
        (worktree_one / "tracked.txt").write_text("one edit\n", encoding="utf-8")
        (worktree_two / "tracked.txt").write_text("two edit\n", encoding="utf-8")
        output_path = self.tmpdir / "multiple.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["repo-one", "repo-two"])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("# --- Worktree: repo-one", content)
        self.assertIn("# --- Worktree: repo-two", content)
        self.assertIn("+one edit", content)
        self.assertIn("+two edit", content)

    def test_diff_does_not_read_tasksail_code_workspace(self) -> None:
        task_id = "task-ignore-workspace"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (self.platform_root / "tasksail.code-workspace").write_text(
            json.dumps({"folders": [{"path": "/does/not/exist"}]}),
            encoding="utf-8",
        )
        (worktree / "tracked.txt").write_text("workspace ignored\n", encoding="utf-8")
        output_path = self.tmpdir / "ignored-workspace.diff"

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("+workspace ignored", content)
        self.assertIn("# --- Worktree: repo-root", content)

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
                "_load_repo_bindings",
                return_value=[("good", good_repo), ("bad", bad_repo)],
            ),
            mock.patch.object(code_diff, "_git_diff", side_effect=diff_side_effect),
        ):
            exit_code, repo_names = code_diff.capture_code_diff(
                repo_root=str(self.platform_root),
                task_id="task-failure",
                output_path=str(output_path),
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["good", "bad"])
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("# --- Worktree: good", content)
        self.assertIn("diff --git a/a b/a", content)
        self.assertNotIn("# --- Worktree: bad", content)

    def test_write_failures_return_actionable_error_output(self) -> None:
        output_path = self.tmpdir / "broken.diff"
        stderr = io.StringIO()

        with (
            mock.patch.object(
                code_diff,
                "_load_repo_bindings",
                return_value=[("repo", self.tmpdir / "repo")],
            ),
            mock.patch.object(code_diff, "_git_diff", return_value=""),
            mock.patch.object(Path, "write_text", side_effect=OSError("disk full")),
            contextlib.redirect_stderr(stderr),
        ):
            exit_code, repo_names = code_diff.capture_code_diff(
                repo_root=str(self.platform_root),
                task_id="task-write-failure",
                output_path=str(output_path),
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, ["repo"])
        self.assertIn("Failed to write diff artifact", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
