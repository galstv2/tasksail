from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


class CreateDropboxTaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.cli_path = (
            cls.repo_root / "src" / "backend" / "platform" / "queue" / "cli.ts"
        )

    def run_cli(self, *args: str, repo_root: str | None = None) -> subprocess.CompletedProcess[str]:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        workspace = Path(temp_dir.name)
        dropbox_dir = workspace / "AgentWorkSpace" / "dropbox"
        output_path = dropbox_dir / "task.md"
        effective_root = repo_root or temp_dir.name
        completed = subprocess.run(
            [
                "npx", "tsx", str(self.cli_path),
                "create-task",
                *args,
                "--output", str(output_path),
                "--repo-root", effective_root,
            ],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
        )
        completed.dropbox_dir = dropbox_dir  # type: ignore[attr-defined]
        return completed

    def read_single_published_file(self, dropbox_dir: Path) -> str:
        pending_dir = dropbox_dir.parent / "pendingitems"
        files = list(pending_dir.glob("*.md"))
        self.assertEqual(len(files), 1)
        return files[0].read_text(encoding="utf-8")

    def test_standard_task_includes_default_lineage_block(self) -> None:
        completed = self.run_cli(
            "--title",
            "Standard Intake",
            "--summary",
            "Summarize the request.",
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        content = self.read_single_published_file(
            completed.dropbox_dir,  # type: ignore[arg-type]
        )
        self.assertIn("- Task Kind: standard", content)
        self.assertIn("- Parent Task ID:", content)
        self.assertIn("## Parent Task Carry-Forward Summary", content)

    def test_child_task_defaults_root_task_id_to_parent(self) -> None:
        completed = self.run_cli(
            "--title",
            "Child Intake",
            "--kind",
            "child-task",
            "--summary",
            "Adjust the prior implementation.",
            "--parent-task-id",
            "CAP-1234",
            "--parent-qmd-record-id",
            "task:platform:CAP-1234",
            "--parent-qmd-scope",
            "qmd/context-packs/platform-core",
            "--followup-reason",
            "Address QA feedback after closeout.",
            "--carry-forward-summary",
            (
                "Parent task completed queue automation but needs one "
                "follow-up adjustment."
            ),
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        content = self.read_single_published_file(
            completed.dropbox_dir,  # type: ignore[arg-type]
        )
        self.assertIn("- Task Kind: child-task", content)
        self.assertIn("- Parent Task ID: CAP-1234", content)
        self.assertIn("- Root Task ID: CAP-1234", content)
        self.assertIn(
            "- Parent QMD Record ID: task:platform:CAP-1234",
            content,
        )
        self.assertIn(
            "- Parent QMD Scope: qmd/context-packs/platform-core",
            content,
        )
        self.assertIn(
            "- Follow-Up Reason: Address QA feedback after closeout.",
            content,
        )
        self.assertIn(
            (
                "Parent task completed queue automation but needs one "
                "follow-up adjustment."
            ),
            content,
        )

    def test_child_task_requires_parent_task_id(self) -> None:
        completed = self.run_cli(
            "--title",
            "Invalid Child Intake",
            "--kind",
            "child-task",
            "--followup-reason",
            "Need another pass.",
            "--carry-forward-summary",
            "Prior task needs a follow-up.",
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn(
            "--parent-task-id is required for child-task intake",
            completed.stderr,
        )

    def test_output_must_stay_under_dropbox(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root)
            completed = subprocess.run(
                [
                    "npx", "tsx", str(self.cli_path),
                    "create-task",
                    "--title",
                    "Outside Dropbox",
                    "--summary",
                    "Reject this path.",
                    "--output",
                    str(root / "outside" / "task.md"),
                    "--repo-root",
                    temp_root,
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
            )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn(
            "drafts must be written through dropbox/",
            completed.stderr,
        )


if __name__ == "__main__":
    unittest.main()
