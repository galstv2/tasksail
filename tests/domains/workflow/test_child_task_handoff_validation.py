"""Tests for child-task queue seeding and lineage propagation."""
from __future__ import annotations

import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

from tests.support.workspace_builder import copy_repo_tree


class ChildTaskHandoffValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.cli_path = (
            cls.repo_root / "src" / "backend" / "platform" / "queue" / "cli.ts"
        )

    def create_workspace(self) -> Path:
        temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
        (temp_dir / "AgentWorkSpace" / "handoffs").mkdir(parents=True)
        (temp_dir / "AgentWorkSpace" / "pendingitems").mkdir(parents=True)
        (temp_dir / "AgentWorkSpace" / "dropbox").mkdir(parents=True)
        copy_repo_tree(temp_dir, "AgentWorkSpace/templates")
        return temp_dir

    def seed_child_task_handoffs(self, workspace: Path) -> None:
        queue_item = workspace / "AgentWorkSpace" / "pendingitems" / "sample-child-task.md"
        queue_item.write_text(
            """# Child Follow-Up Task

## Task Lineage

- Task Kind: child-task
- Parent Task ID: CAP-1000
- Root Task ID: CAP-1000
- Parent QMD Record ID: task:platform:CAP-1000
- Parent QMD Scope: qmd/context-packs/platform-core
- Follow-Up Reason: Address post-closeout QA feedback.

## Request Summary

Adjust the previous task based on QA findings.

## Desired Outcome

Close the last QA gap.

## Constraints

Keep the queue contract unchanged.

## Acceptance Signals

QA confirms the follow-up is complete.

## Parent Task Carry-Forward Summary

Parent task completed the first pass of queue automation and now needs a targeted correction.
""",
            encoding="utf-8",
        )
        # Activate the pending item via the TS CLI, which seeds handoff
        # templates from the queue item content.
        completed = subprocess.run(
            [
                "npx", "tsx", str(self.cli_path),
                "activate-next-pending-item",
                "--repo-root", str(workspace),
            ],
            cwd=workspace,
            text=True,
            capture_output=True,
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

    def test_child_task_queue_seed_populates_lineage_sections(self) -> None:
        workspace = self.create_workspace()
        self.seed_child_task_handoffs(workspace)

        professional = (workspace / "AgentWorkSpace" / "handoffs" / "professional-task.md").read_text(encoding="utf-8")
        implementation = (workspace / "AgentWorkSpace" / "handoffs" / "implementation-spec.md").read_text(encoding="utf-8")
        final_summary = (workspace / "AgentWorkSpace" / "handoffs" / "final-summary.md").read_text(encoding="utf-8")

        self.assertIn("## Task Lineage", professional)
        self.assertIn("- Task Kind: child-task", professional)
        self.assertIn("- Parent QMD Record ID: task:platform:CAP-1000", professional)
        self.assertIn("## Parent Task Carry-Forward Context", professional)

        self.assertIn("## Task Lineage", implementation)
        self.assertIn("- Root Task ID: CAP-1000", implementation)
        self.assertIn("## Parent Task Carry-Forward Context", implementation)
        self.assertIn("## Task Lineage", final_summary)
        self.assertIn("## Inherited Parent Context", final_summary)
        self.assertIn("## Child-Task Outcome Delta", final_summary)


if __name__ == "__main__":
    unittest.main()
