"""MVP green-light E2E integration test.

Validates the current standard-only workflow from task intake through
Product Manager, Software Engineer, QA closeout, archive filing, and
reinforcement recording.

Each role's handoff artifacts are written programmatically. The only
thing not exercised is the actual Copilot CLI.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

from tests.support.e2e_artifacts import (
    write_product_manager_artifacts,
    write_qa_closeout,
    write_software_engineer_outputs,
)
from tests.support.handoff_factory import write_text, write_valid_retrospective
from tests.support.repo_file_sets import QUEUE_RUNTIME_WORKSPACE_FILES
from tests.support.script_runner import run_script
from tests.support.workspace_builder import prepare_workspace, seed_handoffs_from_templates


TASK_TITLE = "MVP E2E Task"
REPO_ROOT = Path(__file__).resolve().parents[3]


def _run_validator(
    workspace: Path,
    *args: str,
) -> subprocess.CompletedProcess[str]:
    """Invoke the TypeScript workflow-policy CLI against the temp workspace."""
    return run_script(
        workspace,
        "src/backend/platform/workflow-policy/cli.ts",
        "--root",
        str(workspace),
        *args,
    )


def _read_task_id(workspace: Path) -> str:
    """Extract the queue-assigned Task ID from professional-task.md."""
    content = (
        workspace / "AgentWorkSpace" / "handoffs" / "professional-task.md"
    ).read_text(encoding="utf-8")
    match = re.search(r"- Task ID:\s*(.+)", content)
    assert match, "Task ID not found in professional-task.md"
    return match.group(1).strip()


def _strip_html_comments(workspace: Path, relative_path: str) -> None:
    """Remove HTML comments so placeholders are never treated as content."""
    path = workspace / relative_path
    try:
        original = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    cleaned = re.sub(r"<!--.*?-->", "", original)
    if cleaned != original:
        path.write_text(cleaned, encoding="utf-8")


def _seed_active_task(workspace: Path, *, task_id: str, title: str) -> None:
    """Seed a claimed active task without invoking the queue CLI."""
    write_text(
        workspace,
        f"AgentWorkSpace/pendingitems/{task_id.lower()}.md",
        f"""# Pending Task

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Raw Request

Validate the active standard-only workflow end-to-end.
""",
    )
    write_text(
        workspace,
        "AgentWorkSpace/pendingitems/.active-item",
        f"{task_id.lower()}.md\n",
    )
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/professional-task.md",
        f"""# Professional Task

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Raw Request

Validate the active standard-only workflow end-to-end.

## Parent Task Carry-Forward Context

## Problem Statement

The repository needs deterministic subprocess coverage for the active workflow.

## Business Goal

Keep the workflow validation surface aligned to the live platform.

## Scope

Synthetic workflow artifact generation plus real queue closeout.

## Non-Goals

1. No live Copilot execution.

## Constraints

## Acceptance Criteria

1. Product Manager, Software Engineer, and QA artifacts pass validation.
2. Queue closeout files archive and reinforcement outputs.

## Risks

## Open Questions
""",
    )


@unittest.skipUnless(
    os.environ.get("RUN_SLOW_TESTS"),
    "slow subprocess-based integration test — set RUN_SLOW_TESTS=1 to include",
)
class MvpGreenLightTests(unittest.TestCase):
    """End-to-end pipeline: intake -> PM -> SWE -> QA -> archive -> reinforcement."""

    workspace: Path
    context_pack_dir: Path
    task_id: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.workspace = prepare_workspace(
            None,
            relative_dirs=[
                "scripts",
                "AgentWorkSpace/handoffs",
                "AgentWorkSpace/dropbox",
                "AgentWorkSpace/pendingitems",
                "AgentWorkSpace/ImplementationSteps",
            ],
            relative_files=QUEUE_RUNTIME_WORKSPACE_FILES,
            tree_paths=[
                "src/backend/scripts/python/lib",
                "src/backend/mcp/reinforcement",
                "AgentWorkSpace/templates",
            ],
        )
        seed_handoffs_from_templates(cls.workspace)
        cls.addClassCleanup(
            shutil.rmtree, cls.workspace, ignore_errors=True,
        )

        (
            cls.workspace
            / "src/backend/mcp/repo_context_mcp/services/__init__.py"
        ).write_text(
            "from .archive_service import TaskArchiveService\n"
            "from .qmd_index_service import QmdIndexService\n",
            encoding="utf-8",
        )

        cls.context_pack_dir = cls.workspace / "e2e-context-pack"
        cls.context_pack_dir.mkdir(parents=True, exist_ok=True)
        (cls.context_pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
        (cls.context_pack_dir / "qmd" / "repo-sources.json").write_text(
            json.dumps(
                {
                    "manifest_version": "qmd-repo-sources/v1",
                    "manifest_status": "approved",
                    "context_pack_id": "e2e-context-pack",
                    "display_name": "E2E Context Pack",
                    "estate_type": "single-repo",
                    "qmd_scope_root": "qmd/context-packs/e2e-context-pack",
                    "default_scope_mode": "focused",
                    "repositories": [
                        {
                            "repo_id": "workspace",
                            "repo_name": "Synthetic E2E Workspace",
                            "local_paths": [str(cls.workspace)],
                            "system_layer": "backend",
                        },
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (cls.workspace / ".env").write_text(
            f"ACTIVE_CONTEXT_PACK_DIR={cls.context_pack_dir}\n",
            encoding="utf-8",
        )
        cls.task_id = ""

    def test_01_seed_active_task(self) -> None:
        MvpGreenLightTests.task_id = "CAP-9000"
        _seed_active_task(self.workspace, task_id=self.task_id, title=TASK_TITLE)
        active_item_path = (
            self.workspace / "AgentWorkSpace" / "pendingitems" / ".active-item"
        )
        self.assertTrue(active_item_path.exists())

        professional_task = (
            self.workspace / "AgentWorkSpace" / "handoffs" / "professional-task.md"
        ).read_text(encoding="utf-8")
        self.assertIn(f"Task Title: {TASK_TITLE}", professional_task)
        self.assertIn("Task Kind: standard", professional_task)
        self.assertEqual(_read_task_id(self.workspace), self.task_id)

        _strip_html_comments(self.workspace, "AgentWorkSpace/handoffs/issues.md")

    def test_02_product_manager_writes_artifacts(self) -> None:
        write_product_manager_artifacts(
            self.workspace,
            task_id=self.task_id,
            title=TASK_TITLE,
        )

        slices = list(
            (self.workspace / "AgentWorkSpace" / "ImplementationSteps").glob("slice-*.md")
        )
        self.assertGreaterEqual(len(slices), 1)

    def test_03_software_engineer_writes_outputs(self) -> None:
        write_software_engineer_outputs(
            self.workspace,
            task_id=self.task_id,
            title=TASK_TITLE,
        )

        tests_path = self.workspace / "AgentWorkSpace" / "handoffs" / "tests.md"
        content = tests_path.read_text(encoding="utf-8")
        self.assertIn("Testing Infrastructure: available", content)
        self.assertIn("## Commands", content)

    def test_04_qa_writes_closeout(self) -> None:
        write_valid_retrospective(
            self.workspace,
            task_id=self.task_id,
            title=TASK_TITLE,
            meeting_context="Synthetic standard-only workflow retrospective.",
            retrospective_summary="The active Product Manager, Software Engineer, and QA workflow validated cleanly.",
            what_went_well="The synthetic workflow stayed aligned to the live runtime artifacts.",
            improvement="Add a focused QA remediation synthetic case if the workflow expands.",
            action_item="Keep helper writers aligned with active templates and validator contracts.",
            planning_note="Queue activation provided a clean intake artifact for the workflow.",
            product_note="Routing, specification, and slicing stayed within the Product Manager role.",
            engineer_note="Testing evidence matched the implementation slice and remained deterministic.",
            qa_note="Closeout artifacts reflected a clean pass and valid archive handoff.",
            learnings="Prefer real queue and archive commands even in synthetic E2E coverage.",
            anti_patterns="Do not reintroduce retired-role or fast-path artifacts into E2E helpers.",
        )
        write_qa_closeout(
            self.workspace,
            task_id=self.task_id,
            title=TASK_TITLE,
            difficulty="Medium",
        )

        final_summary = (
            self.workspace / "AgentWorkSpace" / "handoffs" / "final-summary.md"
        ).read_text(encoding="utf-8")
        self.assertIn("Closeout Owner Agent ID", final_summary)
        self.assertIn("qa", final_summary)
        self.assertIn("Difficulty Level: Medium", final_summary)

    def test_05_pre_closeout_validation(self) -> None:
        completed = _run_validator(
            self.workspace,
            "--mode", "pre-closeout",
            "--enforce",
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stdout)

    def test_06_queue_closeout_and_archive(self) -> None:
        completed = run_script(
            self.workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root",
            str(self.workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(self.context_pack_dir)},
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        active_item_path = (
            self.workspace / "AgentWorkSpace" / "pendingitems" / ".active-item"
        )
        self.assertFalse(active_item_path.exists())

        retro_base = (
            self.context_pack_dir
            / "qmd/context-packs"
            / self.context_pack_dir.name
            / "archive/retrospectives"
            / self.context_pack_dir.parent.name
            / "2026"
            / self.task_id.lower()
        )
        self.assertTrue(
            (retro_base / "retrospective.md").exists(),
            msg="retrospective markdown not filed",
        )
        self.assertTrue(
            (retro_base / "retrospective.md.record.json").exists(),
            msg="retrospective record JSON not filed",
        )

        global_history = (
            self.workspace
            / "AgentWorkSpace/qmd/global/retrospectives/history/2026"
            / f"{self.task_id.lower()}.md"
        )
        self.assertTrue(
            global_history.exists(),
            msg="global history markdown not filed",
        )

        shared_memory = (
            self.workspace
            / "AgentWorkSpace/qmd/global/retrospectives"
            / "shared-retrospective-memory.md"
        )
        self.assertTrue(
            shared_memory.exists(),
            msg="shared retrospective memory not created",
        )

    def test_07_reinforcement_recorded(self) -> None:
        ledger_path = (
            self.workspace / "AgentWorkSpace" / "qmd" / "reinforcement"
            / "task-ledger.json"
        )
        self.assertTrue(
            ledger_path.exists(),
            msg="task-ledger.json not created under AgentWorkSpace/qmd/reinforcement/",
        )

        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        self.assertEqual(ledger["schema_version"], "1.0")
        self.assertGreaterEqual(len(ledger["entries"]), 1)

        entry = next(
            (e for e in ledger["entries"] if e["task_id"] == self.task_id),
            None,
        )
        self.assertIsNotNone(
            entry,
            msg=f"no ledger entry for {self.task_id}",
        )
        self.assertEqual(entry["difficulty"], "medium")
        self.assertEqual(entry["effective_reward"], 2000)
        self.assertEqual(entry["quality_outcome"], "success")
        self.assertEqual(entry["settlement_status"], "unrewarded")


if __name__ == "__main__":
    unittest.main()
