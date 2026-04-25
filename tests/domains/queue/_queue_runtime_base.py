from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

from tests.support.handoff_factory import write_text, write_valid_retrospective
from tests.support.repo_file_sets import QUEUE_RUNTIME_WORKSPACE_FILES
from tests.support.script_runner import run_script
from tests.support.workspace_builder import prepare_workspace

_SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "src" / "backend" / "scripts" / "python"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from lib.workspace_paths import render_handoff_artifact_label  # noqa: E402

TEST_TASK_ID = "task-test-001"


# --------------------------------------------------------------------------
# WHY THIS SKIP GATE:
#
# Every test in this class spawns real subprocesses (createDropboxTask.ts,
# queue/cli.ts create-task, complete, status, etc.). Each
# subprocess round-trip takes 3-10s, and the full class takes 60-90s total.
# These are true integration tests — they validate end-to-end queue behavior
# through real scripts — but they dominate total test runtime by 10x.
#
# Gating behind RUN_SLOW_TESTS keeps the fast feedback loop (<5s) for unit
# and HTTP transport tests while still allowing full integration coverage
# via: RUN_SLOW_TESTS=1 python -m pytest tests/ -q
# --------------------------------------------------------------------------
class QueueRuntimeIntegrationTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]

    def setUp(self) -> None:
        if not os.environ.get("RUN_SLOW_TESTS"):
            self.skipTest(
                "slow subprocess-based integration test — set RUN_SLOW_TESTS=1 to include"
            )

    def create_workspace(self) -> Path:
        temp_dir = prepare_workspace(
            self,
            relative_dirs=[
                "scripts",
                "AgentWorkSpace/dropbox",
                "AgentWorkSpace/pendingitems",
            ],
            relative_files=QUEUE_RUNTIME_WORKSPACE_FILES,
            tree_paths=["src/backend/scripts/python/lib", "AgentWorkSpace/templates"],
        )

        (
            temp_dir / "src/backend/mcp/repo_context_mcp/services/__init__.py"
        ).write_text(
            "from .archive_service import TaskArchiveService\n"
            "from .qmd_index_service import QmdIndexService\n",
            encoding="utf-8",
        )

        return temp_dir

    def run_script(
        self,
        workspace: Path,
        script_relative_path: str,
        *args: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return run_script(
            workspace,
            script_relative_path,
            *args,
            env=env,
        )

    def write_text(
        self,
        workspace: Path,
        relative_path: str,
        content: str,
    ) -> None:
        write_text(workspace, relative_path, content)

    def write_valid_retrospective(
        self,
        workspace: Path,
        *,
        task_id: str,
        title: str,
    ) -> None:
        write_valid_retrospective(
            workspace,
            task_id=task_id,
            title=title,
            meeting_context="Quick runtime retrospective.",
            retrospective_summary=(
                "The runtime closeout stayed deterministic."
            ),
            what_went_well="The queue lifecycle stayed observable.",
            improvement="The retrospective could have happened sooner.",
            action_item="Capture retrospective input before completion.",
            planning_note="The task stayed bounded.",
            product_note=(
                "The path stayed explicit.\n"
                "The runtime boundary stayed narrow.\n"
                "The slice stayed executable."
            ),
            engineer_note=(
                "The queue logic stayed deterministic.\n"
                "Runtime regression coverage stayed intact."
            ),
            qa_note=(
                "QA state stayed observable.\n"
                "The closeout notes stayed concise."
            ),
            learnings="Runtime closeout should fail closed.",
            anti_patterns="Do not skip the retrospective handoff.",
        )

    def write_standard_active_workspace(
        self,
        workspace: Path,
        *,
        task_id: str = "CAP-9000",
        title: str = "Queue Lifecycle Task",
        retrospective_complete: bool = True,
    ) -> None:
        if retrospective_complete:
            self.write_valid_retrospective(
                workspace,
                task_id=task_id,
                title=title,
            )
        self.write_text(
            workspace,
            render_handoff_artifact_label(task_id, "professional-task.md"),
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

Complete the queue lifecycle.

## Parent Task Carry-Forward Context

## Problem Statement

Need legal queue closeout.

## Business Goal

Keep queue advancement deterministic.

## Scope

Workflow validation.

## Non-Goals

1. No changes to queue storage format.

## Constraints

## Acceptance Criteria

1. Queue closeout passes validation.

## Risks

## Open Questions
""",
        )
        self.write_text(
            workspace,
            render_handoff_artifact_label(task_id, "implementation-spec.md"),
            f"""# Implementation Spec

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

## Parent Task Carry-Forward Context

## Problem Statement

Queue lifecycle needs runtime integration coverage.

## Goals

1. Validate queue runtime integration.

## Non-Goals

1. No changes to queue storage format.

## Architecture Summary

Ready.

## Touched Systems

scripts/

## Change Boundaries

Queue lifecycle only.

## Dependency Analysis

| Module | Depends On |
|---|---|
| queue/policyValidation.ts | workflow-policy/index.ts |

## Codebase Analysis

src/backend/platform/queue/policyValidation.ts is the main queue entry point
into the TypeScript workflow-policy engine.

## Proposed Structure

No structural changes.

## Contracts

Validation must stay deterministic.

## Migrations or Data Implications

None.

## Risks

Low.

## Validation Strategy

```bash
python3 -m unittest tests.test_queue_runtime_integration -v
```

## Test Coverage

tests/test_queue_runtime_integration.py

## Impact Assessment

Low.

## Files or Areas Likely to Change

- src/backend/platform/queue/policyValidation.ts
""",
        )
        self.write_text(
            workspace,
            render_handoff_artifact_label(task_id, "tests.md"),
            f"""# Tests

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Test Inventory

- queue lifecycle regression

## Commands

- python -m unittest

## Coverage Notes

Closeout evidence is recorded.
""",
        )
        self.write_text(
            workspace,
            render_handoff_artifact_label(task_id, "issues.md"),
            f"""# QA Issues

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Finding

## Severity

## Expectation Violated

## Required Fix

## Remediation Owner Agent ID

## Revalidation Agent ID

## Return-To Agent ID

## Retest Instructions
""",
        )
        self.write_text(
            workspace,
            render_handoff_artifact_label(task_id, "final-summary.md"),
            f"""# Final Summary

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

## Inherited Parent Context

## Child-Task Outcome Delta

## Closeout Owner Agent ID

qa

## Completed Work

Completed queue lifecycle validation.

## Key Design Decisions

- Keep queue gating deterministic.

## Known Limitations

- None.

## Test Result Summary

Passed.

## Rollout or Operational Notes

None.

## Follow-Up Backlog
""",
        )

    def seed_active_queue_item(
        self,
        workspace: Path,
        *,
        file_name: str = "20260307-cap-9000.md",
    ) -> None:
        (workspace / "AgentWorkSpace" / "pendingitems" / file_name).write_text(
            "# Queue Item\n",
            encoding="utf-8",
        )
        (workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").write_text(
            file_name,
            encoding="utf-8",
        )

    def retrospective_markdown_path(
        self,
        context_pack_dir: Path,
        *,
        task_id: str = "CAP-9000",
    ) -> Path:
        return (
            context_pack_dir
            / "qmd/context-packs/runtime-pack/archive/retrospectives"
            / context_pack_dir.parent.name
            / "2026"
            / task_id.lower()
            / "retrospective.md"
        )

    def global_history_markdown_path(
        self,
        workspace: Path,
        *,
        task_id: str = "CAP-9000",
    ) -> Path:
        return (
            workspace
            / "AgentWorkSpace/qmd/global/retrospectives/history/2026"
            / f"{task_id.lower()}.md"
        )

    def shared_memory_markdown_path(self, workspace: Path) -> Path:
        return (
            workspace
            / "AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md"
        )
