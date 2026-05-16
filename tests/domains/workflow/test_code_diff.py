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


def _completed(args: list[str], returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


class CaptureCodeDiffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="code-diff-"))
        self.platform_root = self.tmpdir / "platform"
        self.platform_root.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _sidecar_path(self, task_id: str, *, platform_root: Path | None = None) -> Path:
        root = platform_root or self.platform_root
        task_dir = root / "AgentWorkSpace" / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        return task_dir / ".task.json"

    def _write_sidecar(
        self,
        task_id: str,
        bindings: list[object],
        *,
        platform_root: Path | None = None,
    ) -> Path:
        sidecar = self._sidecar_path(task_id, platform_root=platform_root)
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
        worktree_parent: Path | None = None,
    ) -> tuple[Path, Path, dict[str, str]]:
        original = self.tmpdir / (original_slug or f"original-{slug}")
        original.mkdir(parents=True)
        _init_git_repo(original)
        base_sha = _commit_base(original)

        parent = worktree_parent or (
            self.platform_root / "AgentWorkSpace" / "tasks" / task_id / "worktrees"
        )
        worktree = parent / slug
        worktree.parent.mkdir(parents=True, exist_ok=True)
        branch = f"task/{task_id}-{slug}-{len(list(parent.glob('*'))) if parent.exists() else 0}"
        _run_git(original, "worktree", "add", "-b", branch, str(worktree), "HEAD")
        binding = {
            "originalRoot": str(original),
            "worktreeRoot": str(worktree),
            "worktreeBranch": branch,
            "baseCommitSha": base_sha,
        }
        return original, worktree, binding

    def _capture(self, task_id: str, output_name: str = "code-changes.diff") -> tuple[int, list[str], str]:
        output_path = self.tmpdir / output_name
        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id=task_id,
            output_path=str(output_path),
        )
        return exit_code, repo_names, output_path.read_text(encoding="utf-8")

    def test_helper_cli_uses_task_sidecar_worktree_bindings(self) -> None:
        task_id = "task-cli"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (worktree / "tracked.txt").write_text("after\n", encoding="utf-8")

        output_path = self.tmpdir / "cli.diff"
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
        self.assertIn(f"#   - {worktree.name} | status=captured |", content)
        self.assertIn("# --- Worktree: repo-root", content)
        self.assertIn("+after", content)

    def test_two_changed_git_worktrees_aggregate_into_one_diff(self) -> None:
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

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["repo-one", "repo-two"])
        self.assertIn("#   - repo-one | status=captured |", content)
        self.assertIn("#   - repo-two | status=captured |", content)
        self.assertIn("# --- Worktree: repo-one", content)
        self.assertIn("# --- Worktree: repo-two", content)
        self.assertIn("+one edit", content)
        self.assertIn("+two edit", content)

    def test_diff_captures_worktree_edits_not_origin_edits(self) -> None:
        task_id = "task-worktree-scope"
        original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (worktree / "tracked.txt").write_text("worktree edit\n", encoding="utf-8")
        (original / "tracked.txt").write_text("origin edit\n", encoding="utf-8")

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        self.assertIn("+worktree edit", content)
        self.assertNotIn("origin edit", content)

    def test_clean_worktree_has_status_without_diff_section(self) -> None:
        task_id = "task-empty-worktree"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        self.assertIn(f"#   - {worktree.name} | status=clean |", content)
        self.assertIn("# No git changes detected in bound worktrees.", content)
        self.assertNotIn("# --- Worktree:", content)

    def test_existing_non_git_worktree_is_skipped_without_failing_capture(self) -> None:
        task_id = "task-non-git"
        non_git = self.tmpdir / "non-git"
        non_git.mkdir()
        self._write_sidecar(task_id, [{
            "originalRoot": "",
            "worktreeRoot": str(non_git),
            "worktreeBranch": "",
            "baseCommitSha": "",
        }])

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["non-git"])
        self.assertIn("#   - non-git | status=skipped-non-git | base=HEAD |", content)
        self.assertIn("# No git changes detected in bound worktrees.", content)

    def test_missing_worktree_writes_diagnostic_artifact_and_fails(self) -> None:
        task_id = "task-missing-worktree"
        missing = self.tmpdir / "missing"
        self._write_sidecar(task_id, [{
            "originalRoot": "",
            "worktreeRoot": str(missing),
            "worktreeBranch": "",
            "baseCommitSha": "",
        }])

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, ["missing"])
        self.assertIn("#   - missing | status=missing-worktree |", content)
        self.assertIn("# ERROR missing: missing-worktree", content)
        self.assertIn("Ron must not review this task", content)

    def test_missing_sidecar_fails_and_overwrites_stale_output(self) -> None:
        output_path = self.tmpdir / "missing-sidecar.diff"
        output_path.write_text("stale diff", encoding="utf-8")

        exit_code, repo_names = code_diff.capture_code_diff(
            repo_root=str(self.platform_root),
            task_id="missing-sidecar",
            output_path=str(output_path),
        )

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, [])
        content = output_path.read_text(encoding="utf-8")
        self.assertNotIn("stale diff", content)
        self.assertIn("# ERROR sidecar: missing-sidecar", content)

    def test_malformed_json_and_non_object_sidecars_fail_with_diagnostics(self) -> None:
        cases = [
            ("bad-json", "{", "malformed-json"),
            ("non-object", "[]", "non-object-sidecar"),
        ]
        for task_id, raw, code in cases:
            with self.subTest(task_id=task_id):
                sidecar = self._sidecar_path(task_id)
                sidecar.write_text(raw, encoding="utf-8")
                exit_code, repo_names, content = self._capture(task_id, f"{task_id}.diff")
                self.assertEqual(exit_code, 1)
                self.assertEqual(repo_names, [])
                self.assertIn(f"# ERROR sidecar: {code}", content)

    def test_invalid_repo_bindings_shapes_fail_with_diagnostics(self) -> None:
        cases = [
            ("missing-binding-root", {}, "missing-contextPackBinding"),
            ("missing-repo-bindings", {"contextPackBinding": {}}, "invalid-repoBindings"),
            ("non-array-repo-bindings", {"contextPackBinding": {"repoBindings": {}}}, "invalid-repoBindings"),
            ("empty-repo-bindings", {"contextPackBinding": {"repoBindings": []}}, "empty-repoBindings"),
            ("non-object-binding", {"contextPackBinding": {"repoBindings": ["bad"]}}, "malformed-binding"),
            ("missing-worktree-root", {"contextPackBinding": {"repoBindings": [{}]}}, "malformed-binding"),
            ("blank-worktree-root", {"contextPackBinding": {"repoBindings": [{"worktreeRoot": " "}]}}, "malformed-binding"),
            ("non-string-worktree-root", {"contextPackBinding": {"repoBindings": [{"worktreeRoot": 3}]}}, "malformed-binding"),
        ]
        for task_id, payload, code in cases:
            with self.subTest(task_id=task_id):
                self._sidecar_path(task_id).write_text(json.dumps(payload), encoding="utf-8")
                exit_code, repo_names, content = self._capture(task_id, f"{task_id}.diff")
                self.assertEqual(exit_code, 1)
                self.assertEqual(repo_names, [])
                self.assertIn(f"# ERROR sidecar: {code}", content)

    def test_duplicate_display_slugs_are_retained_with_suffixes(self) -> None:
        task_id = "task-duplicate-slugs"
        bindings: list[dict[str, str]] = []
        for index in range(3):
            _original, worktree, binding = self._create_worktree_binding(
                task_id,
                "shared",
                original_slug=f"original-duplicate-{index}",
                worktree_parent=self.tmpdir / f"parent-{index}",
            )
            (worktree / "tracked.txt").write_text(f"edit {index}\n", encoding="utf-8")
            bindings.append(binding)
        self._write_sidecar(task_id, bindings)

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, ["shared", "shared-2", "shared-3"])
        self.assertIn("# --- Worktree: shared (", content)
        self.assertIn("# --- Worktree: shared-2 (", content)
        self.assertIn("# --- Worktree: shared-3 (", content)

    def test_committed_changes_after_activation_are_captured_from_base_commit(self) -> None:
        task_id = "task-committed-after-activation"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        (worktree / "tracked.txt").write_text("committed after activation\n", encoding="utf-8")
        _run_git(worktree, "add", "tracked.txt")
        _run_git(worktree, "commit", "-m", "agent commit")

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 0)
        self.assertEqual(repo_names, [worktree.name])
        self.assertIn("| status=captured |", content)
        self.assertIn("committed after activation", content)

    def test_invalid_non_empty_base_commit_is_fatal_and_visible(self) -> None:
        task_id = "task-invalid-base"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        binding["baseCommitSha"] = "not-a-real-commit"
        self._write_sidecar(task_id, [binding])

        exit_code, repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, [worktree.name])
        self.assertIn(f"#   - {worktree.name} | status=invalid-base-commit |", content)
        self.assertIn(f"# ERROR {worktree.name}: invalid-base-commit", content)

    def test_git_add_and_diff_failures_are_fatal_and_visible(self) -> None:
        task_id = "task-git-failures"
        _original, worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])

        def run_capture_with_failure(command_name: str, status: str) -> str:
            def fake_git(args: list[str], *, timeout: int, text: bool = True) -> subprocess.CompletedProcess[str]:
                if command_name in args:
                    return _completed(args, 1, stderr=f"{command_name} failed")
                return _completed(args, 0, stdout="true\n")

            with mock.patch.object(code_diff, "_git_run", side_effect=fake_git):
                exit_code, _repo_names, content = self._capture(task_id, f"{status}.diff")
            self.assertEqual(exit_code, 1)
            return content

        self.assertIn("status=intent-to-add-failed", run_capture_with_failure("add", "add"))
        self.assertIn("status=diff-failed", run_capture_with_failure("diff", "diff"))

    def test_git_command_exceptions_are_fatal_and_visible(self) -> None:
        task_id = "task-git-exception"
        _original, _worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])

        with mock.patch.object(code_diff, "_git_run", side_effect=OSError("spawn failed")):
            exit_code, _repo_names, content = self._capture(task_id)

        self.assertEqual(exit_code, 1)
        self.assertIn("status=git-probe-failed", content)
        self.assertIn("spawn failed", content)

    def test_write_failures_return_actionable_error_output(self) -> None:
        task_id = "task-write-failure"
        _original, _worktree, binding = self._create_worktree_binding(task_id)
        self._write_sidecar(task_id, [binding])
        stderr = io.StringIO()

        with (
            mock.patch.object(code_diff, "_atomic_write_text", side_effect=OSError("disk full")),
            contextlib.redirect_stderr(stderr),
        ):
            exit_code, repo_names = code_diff.capture_code_diff(
                repo_root=str(self.platform_root),
                task_id=task_id,
                output_path=str(self.tmpdir / "broken.diff"),
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(repo_names, [Path(binding["worktreeRoot"]).name])
        logged = json.loads(stderr.getvalue())
        self.assertEqual(logged["msg"], "code_diff.artifact_write_failed")
        self.assertEqual(logged["extra"]["error"], "disk full")
        self.assertEqual(logged["err"]["message"], "disk full")


if __name__ == "__main__":
    unittest.main()
