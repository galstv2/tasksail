"""Live pipeline E2E integration test for a larger parallel-eligible change.

Spins up real Docker MCP services, creates the same throwaway CRUD app used by
the baseline live test, then invokes real Copilot CLI agents through the
production pipeline and validates end-to-end including archive closeout and
reinforcement recording.

A fresh context pack and CRUD project are created in a temp directory.
Agents are tasked with making a broader query-and-reporting change across
independent files so Alice should have a stronger reason to authorize
parallel Dalton slices.

WARNING: This test resets the mutable AgentWorkSpace state
(`dropbox/`, `pendingitems/`, `handoffs/`, `ImplementationSteps/`) before
execution, and clears `qmd/` only at test startup so you can inspect QMD
after the run. Agents are denied git add, git commit, and git push by the
autonomy profile deny list.

Prerequisites:
  - Docker Desktop installed and running
  - ``copilot`` CLI installed and authenticated
  - No active task in the queue

Gate: ``RUN_LIVE_AGENT_TESTS=1``
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import unittest
import warnings

from tests.domains.e2e._pipeline_base import (
    HANDOFFS,
    IMPL_STEPS,
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
class LivePipelineBigTests(BasePipelineTests):
    """Production-mirroring pipeline for a larger change expected to parallelize."""

    @staticmethod
    def _section_headings(markdown: str) -> list[str]:
        return [line.strip() for line in markdown.splitlines() if line.startswith("## ")]

    @staticmethod
    def _section_body(markdown: str, heading: str) -> str:
        current_heading = ""
        collected: list[str] = []
        for line in markdown.splitlines():
            if line.startswith("## "):
                current_heading = line[3:].strip()
                continue
            if current_heading == heading:
                collected.append(line)
        return "\n".join(collected).strip()

    def _read_active_pending_item(self) -> tuple[Path, str]:
        active_name = (PENDING / ".active-item").read_text(encoding="utf-8").strip()
        self.assertTrue(active_name, msg=".active-item did not reference a pending file")
        active_path = PENDING / active_name
        self.assertTrue(active_path.exists(), msg=f"active pending item missing: {active_name}")
        return active_path, active_path.read_text(encoding="utf-8")

    def test_01_create_dropbox_task(self) -> None:
        result = subprocess.run(
            tsx_cmd(
                REPO_ROOT / "src/backend/platform/queue/cli.ts",
                "create-task",
                "--title", "Expand CRUD querying and reporting with independent helpers",
                "--summary",
                f"The project at {self.crud_app_dir} contains an in-memory CRUD "
                f"store with `crud.py` and passing pytest coverage in "
                f"`test_crud.py`. Expand it with two independent deliverables: "
                f"query behavior and reporting behavior, each implemented in its "
                f"own module with its own focused tests.",
                "--desired-outcome",
                "Deliver reusable query helper logic in `query_helpers.py` and "
                "standalone reporting helpers in `reporting.py`, keep the query "
                "integration in `crud.py`, and extend the pytest suite with "
                "dedicated coverage for both deliverables.",
                "--constraints",
                f"- Preserve existing CRUD behavior.\n"
                f"- `list_all()` must keep insertion order and must not be mutated by `sort_by(...)`.\n"
                f"- Keep the change scoped to the temp CRUD project at {self.crud_app_dir}.\n"
                f"- Treat querying and reporting as separate deliverables with disjoint primary file ownership where possible.\n"
                f"- Validate with: python3 -m pytest {self.crud_app_dir} -v",
                "--acceptance-signals",
                "- The CRUD project changes span at least five files, including `crud.py`, `query_helpers.py`, `reporting.py`, and focused tests for both deliverables.\n"
                "- `Store.search(field, value)` returns matching items.\n"
                "- `Store.search_many(criteria)` matches all provided field/value pairs.\n"
                "- `Store.sort_by(field, reverse=False)` returns derived order without mutating later `list_all()` results.\n"
                "- `reporting.py` exposes standalone summary helpers such as counts by role or sorted role summaries without modifying store state.\n"
                "- `python3 -m pytest` passes for the CRUD project.",
                "--suggested-path", "parallel",
                "--planning-notes",
                "This intake should mirror the planning-intake template that Lily would hand to Alice. "
                "Keep the multi-file structural requirement explicit in the planning artifacts. "
                "Treat query expansion (`crud.py`, `query_helpers.py`, query tests) and reporting helpers "
                "(`reporting.py`, reporting tests) as separate deliverables with different primary files. "
                "Prefer parallel Dalton execution unless Alice can justify a concrete shared-file conflict that makes it unsafe.",
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
        _active_path, active_content = self._read_active_pending_item()
        template_content = (
            REPO_ROOT / "AgentWorkSpace" / "templates" / "planning-intake.md"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            self._section_headings(active_content),
            self._section_headings(template_content),
            msg=active_content,
        )
        self.assertIn(
            "# Expand CRUD querying and reporting with independent helpers",
            active_content,
        )
        self.assertIn("- Task Kind: standard", active_content)
        self.assertIn("- Created By: Planning Agent", active_content)
        self.assertIn(
            "Deliver reusable query helper logic in `query_helpers.py`",
            active_content,
        )
        self.assertIn(
            "changes span at least five files",
            self._section_body(active_content, "Acceptance Signals"),
        )
        self.assertIn(
            "reporting.py",
            self._section_body(active_content, "Acceptance Signals"),
        )
        self.assertIn(
            "mirror the planning-intake template",
            self._section_body(active_content, "Suggested Routing"),
        )
        self.assertIn("- Recommended Execution: parallel", active_content)

    def test_03_run_pipeline_from_product_manager(self) -> None:
        result = self._run_pipeline(start_at="alice")
        self.assertEqual(
            result.returncode,
            0,
            msg=f"--- stdout ---\n{result.stdout[-4000:]}\n--- stderr ---\n{result.stderr[-4000:]}",
        )

        for artifact in (
            HANDOFFS / "implementation-spec.md",
            HANDOFFS / "parallel-ok.md",
            HANDOFFS / "tests.md",
            HANDOFFS / "issues.md",
            HANDOFFS / "final-summary.md",
            HANDOFFS / "retrospective-input.md",
        ):
            self.assertTrue(artifact.exists(), msg=f"missing artifact: {artifact.name}")


        slice_files = sorted(IMPL_STEPS.glob("*.md"))
        self.assertGreaterEqual(
            len([path for path in slice_files if path.name != "slice-template.md"]),
            2,
            msg=f"expected at least two implementation slices, found: {slice_files}",
        )

    def test_05_pre_closeout_validation(self) -> None:
        result = self._run_validator(
            "--mode", "pre-closeout", "--enforce",
            "--context-pack-dir", self.context_pack_dir,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout)

    def test_06_queue_closeout_and_archive(self) -> None:
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

    def test_07_verify_qmd_archive(self) -> None:
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

    def test_08_verify_reinforcement(self) -> None:
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

    def test_09_crud_changes_span_multiple_files(self) -> None:
        status_result = subprocess.run(
            ["git", "status", "--short"],
            cwd=self.crud_app_dir,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(status_result.returncode, 0, msg=status_result.stderr)
        changed_files: list[str] = []
        for line in status_result.stdout.splitlines():
            if not line.strip():
                continue
            path = line[3:].strip()
            if path:
                changed_files.append(path)
        changed_files = sorted(set(changed_files))
        self.assertGreaterEqual(
            len(changed_files),
            5,
            msg=f"expected a multi-file CRUD change, got: {changed_files}",
        )
        self.assertIn("crud.py", changed_files)
        self.assertIn("query_helpers.py", changed_files)
        self.assertIn("reporting.py", changed_files)

    def test_10_crud_query_features_were_added(self) -> None:
        crud_source = Path(self.crud_app_dir) / "crud.py"
        content = crud_source.read_text(encoding="utf-8")
        self.assertIn(
            "search", content,
            msg="Agents did not add search behavior to crud.py",
        )
        self.assertIn(
            "sort_by", content,
            msg="Agents did not add sort_by behavior to crud.py",
        )
        query_helpers = (Path(self.crud_app_dir) / "query_helpers.py").read_text(
            encoding="utf-8",
        )
        self.assertIn(
            "def ",
            query_helpers,
            msg="Agents did not create reusable query helpers",
        )
        reporting_source = (Path(self.crud_app_dir) / "reporting.py").read_text(
            encoding="utf-8",
        )
        self.assertIn(
            "def ",
            reporting_source,
            msg="Agents did not create standalone reporting helpers",
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
