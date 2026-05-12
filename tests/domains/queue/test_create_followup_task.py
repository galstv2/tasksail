from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


class CreateFollowupTaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.cli_path = (
            cls.repo_root / "src" / "backend" / "platform" / "queue" / "cli.ts"
        )

    def run_cli(
        self,
        *args: str,
        repo_root: str | None = None,
        force: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        effective_root = repo_root or str(self.repo_root)
        cmd = [
            "npx", "tsx", str(self.cli_path),
            "followup",
            *args,
            "--repo-root", effective_root,
        ]
        if force:
            cmd.append("--force")
        completed = subprocess.run(
            cmd,
            cwd=self.repo_root,
            text=True,
            capture_output=True,
        )
        return completed

    def read_single_published_file(self, temp_path: Path) -> str:
        files = list((temp_path / "AgentWorkSpace" / "pendingitems").glob("*.md"))
        self.assertEqual(len(files), 1)
        return files[0].read_text(encoding="utf-8")

    def test_followup_writes_child_task_to_dropbox(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            dropbox_dir = temp_path / "AgentWorkSpace" / "dropbox"
            output_path = dropbox_dir / "followup.md"

            completed = self.run_cli(
                "--title",
                "Follow-up Adjustment",
                "--summary",
                "Refine closeout follow-up behavior.",
                "--desired-outcome",
                "Planner creates a bounded child task.",
                "--parent-task-id",
                "CAP-1001",
                "--parent-qmd-scope",
                "qmd/context-packs/sample-org",
                "--parent-qmd-record-id",
                "task:platform:CAP-1001",
                "--root-task-id",
                "CAP-1000",
                "--followup-reason",
                "Operator requested a follow-up after review.",
                "--carry-forward-summary",
                "Preserve queue ordering",
                "--output",
                str(output_path),
                repo_root=temp_root,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            content = self.read_single_published_file(temp_path)
            self.assertIn("- Task Kind: child-task", content)
            self.assertIn("- Parent Task ID: CAP-1001", content)
            self.assertIn("- Root Task ID: CAP-1000", content)
            self.assertIn("- Parent QMD Record ID: task:platform:CAP-1001", content)
            self.assertIn("Carry-Forward Summary", content)
            self.assertIn("Preserve queue ordering", content)

    def test_followup_refuses_output_outside_dropbox(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            pending_dir = temp_path / "pendingitems"

            completed = self.run_cli(
                "--title",
                "Invalid Follow-up",
                "--summary",
                "Attempt to bypass dropbox.",
                "--parent-task-id",
                "CAP-1001",
                "--parent-qmd-scope",
                "qmd/context-packs/sample-org",
                "--followup-reason",
                "Should fail.",
                "--carry-forward-summary",
                "n/a",
                "--output",
                str(pending_dir / "bypass.md"),
                repo_root=temp_root,
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("must be written through dropbox", completed.stderr)

    def test_followup_accepts_preloaded_carry_forward_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            dropbox_dir = temp_path / "AgentWorkSpace" / "dropbox"
            output_path = dropbox_dir / "preloaded.md"

            completed = self.run_cli(
                "--title",
                "Preloaded Follow-up",
                "--summary",
                "Use preloaded follow-up composer state.",
                "--parent-task-id",
                "CAP-2000",
                "--parent-qmd-scope",
                "qmd/context-packs/sample-org",
                "--followup-reason",
                "Planner already resolved the carry-forward summary.",
                "--carry-forward-summary",
                "# Carry-Forward Summary — CAP-2000\n\n- Root Task ID: CAP-1000",
                "--root-task-id",
                "CAP-1000",
                "--parent-qmd-record-id",
                "task:platform:CAP-2000",
                "--output",
                str(output_path),
                repo_root=temp_root,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            content = self.read_single_published_file(temp_path)
            self.assertIn("- Root Task ID: CAP-1000", content)


if __name__ == "__main__":
    unittest.main()
