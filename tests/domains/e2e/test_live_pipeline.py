"""Live pipeline E2E integration test.

Spins up real Docker MCP services, creates a throwaway CRUD app for agents
to work on, then invokes real Copilot CLI agents through the production
pipeline and validates end-to-end including archive closeout and
reinforcement recording.

A fresh context pack and CRUD project are created in a temp directory.
Agents are tasked with adding a ``search(field, value)`` method to the
CRUD store.

WARNING: This test resets the mutable AgentWorkSpace state
(`dropbox/`, `pendingitems/`, `handoffs/`, `ImplementationSteps/`) before
execution, and clears `qmd/` only at test startup so you can inspect QMD
after the run. Agents are denied git add,
git commit, and git push by the autonomy profile deny list.

Prerequisites:
  - Docker Desktop installed and running
  - ``copilot`` CLI installed and authenticated
  - No active task in the queue

Gate: ``RUN_LIVE_AGENT_TESTS=1``
"""
from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path

from tests.domains.e2e._pipeline_base import (
    HANDOFFS,
    PENDING,
    QMD,
    REPO_ROOT,
    BasePipelineTests,
    tsx_cmd,
)


@unittest.skipUnless(
    os.environ.get("RUN_LIVE_AGENT_TESTS"),
    "live agent pipeline — set RUN_LIVE_AGENT_TESTS=1 to include",
)
class LivePipelineTests(BasePipelineTests):
    """Production-mirroring pipeline with only Lily bypassed."""

    def test_01_create_dropbox_task(self) -> None:
        result = subprocess.run(
            tsx_cmd(
                REPO_ROOT / "src/backend/platform/queue/cli.ts",
                "create-task",
                "--title", "Add search to CRUD store",
                "--summary",
                f"The project at {self.crud_app_dir} contains an in-memory "
                f"CRUD store (crud.py) with create/get/list/update/delete "
                f"operations and passing tests (test_crud.py). Add a "
                f"search(field, value) method that returns all items where "
                f"item[field] == value. Add test cases for the new method. "
                f"Existing tests must continue to pass. "
                f"Run tests with: python3 -m pytest {self.crud_app_dir} -v",
            ),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_02_activate_through_queue(self) -> None:
        result = subprocess.run(
            tsx_cmd(REPO_ROOT / "src/backend/platform/queue/cli.ts", "move-dropbox-items"),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        result2 = subprocess.run(
            tsx_cmd(REPO_ROOT / "src/backend/platform/queue/cli.ts", "activate-next-pending-item"),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result2.returncode, 0, msg=result2.stderr)
        self.assertTrue(
            (PENDING / ".active-item").exists(),
            msg="Queue activation did not create .active-item",
        )

    def test_03_run_pipeline_from_product_manager(self) -> None:
        result = self._run_pipeline(start_at="alice")
        self.assertEqual(
            result.returncode,
            0,
            msg=f"--- stdout ---\n{result.stdout[-4000:]}\n--- stderr ---\n{result.stderr[-4000:]}",
        )

        for artifact in (
            HANDOFFS / "implementation-spec.md",
            HANDOFFS / "tests.md",
            HANDOFFS / "issues.md",
            HANDOFFS / "final-summary.md",
            HANDOFFS / "retrospective-input.md",
        ):
            self.assertTrue(artifact.exists(), msg=f"missing artifact: {artifact.name}")

        final_summary = (HANDOFFS / "final-summary.md").read_text(encoding="utf-8")
        self.assertIn("## Closeout Owner Agent ID", final_summary)
        self.assertIn("qa", final_summary)

    def test_04_pre_closeout_validation(self) -> None:
        result = self._run_validator(
            "--mode", "pre-closeout", "--enforce",
            "--context-pack-dir", self.context_pack_dir,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout)

    def test_05_queue_closeout_and_archive(self) -> None:
        result = subprocess.run(
            tsx_cmd(REPO_ROOT / "src/backend/platform/queue/cli.ts", "complete"),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=60,
            env={
                **os.environ,
                "ACTIVE_CONTEXT_PACK_DIR": self.context_pack_dir,
            },
        )
        self.assertEqual(
            result.returncode, 0,
            msg=f"stdout: {result.stdout[-1000:]}\nstderr: {result.stderr[-1000:]}",
        )
        self.assertFalse(
            (PENDING / ".active-item").exists(),
            msg=".active-item still present after closeout",
        )

    def test_06_verify_qmd_archive(self) -> None:
        self.assertTrue(
            QMD.is_dir(),
            msg="AgentWorkSpace/qmd/ directory does not exist",
        )
        global_history = QMD / "global" / "retrospectives" / "history"
        history_files = list(global_history.rglob("*.md")) if global_history.is_dir() else []
        pack_qmd = Path(self.context_pack_dir) / "qmd"
        context_pack_archives = list(pack_qmd.rglob("*.json")) if pack_qmd.is_dir() else []
        self.assertTrue(
            bool(history_files) or bool(context_pack_archives),
            msg=(
                "No QMD archive content after closeout. "
                f"Checked global history at {global_history} "
                f"and context-pack archives at {pack_qmd}."
            ),
        )

    def test_07_verify_reinforcement(self) -> None:
        ledger = (
            REPO_ROOT / "AgentWorkSpace" / "qmd" / "reinforcement"
            / "task-ledger.json"
        )
        self.assertTrue(
            ledger.exists(),
            msg="task-ledger.json not created under AgentWorkSpace/qmd/reinforcement/",
        )
        data = json.loads(ledger.read_text(encoding="utf-8"))
        self.assertGreaterEqual(
            len(data.get("entries", [])), 1,
            msg="No entries in task ledger",
        )

    def test_08_crud_search_was_added(self) -> None:
        crud_source = Path(self.crud_app_dir) / "crud.py"
        content = crud_source.read_text(encoding="utf-8")
        self.assertIn(
            "search", content,
            msg="Agents did not add a search method to crud.py",
        )

        result = subprocess.run(
            ["python3", "-m", "pytest", self.crud_app_dir, "-v"],
            cwd=self.crud_app_dir,
            text=True,
            capture_output=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode, 0,
            msg=f"CRUD tests failed after agent changes:\n{result.stdout}",
        )


if __name__ == "__main__":
    unittest.main()
