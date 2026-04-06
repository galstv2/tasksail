from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest

from tests.support.handoff_factory import write_text, write_valid_retrospective
from tests.support.repo_file_sets import QUEUE_RUNTIME_WORKSPACE_FILES
from tests.support.script_runner import run_script
from tests.support.workspace_builder import prepare_workspace, seed_handoffs_from_templates


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
@unittest.skipUnless(
    os.environ.get("RUN_SLOW_TESTS"),
    "slow subprocess-based integration test — set RUN_SLOW_TESTS=1 to include",
)
class QueueRuntimeIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]

    def create_workspace(self) -> Path:
        temp_dir = prepare_workspace(
            self,
            relative_dirs=[
                "scripts",
                "AgentWorkSpace/handoffs",
                "AgentWorkSpace/dropbox",
                "AgentWorkSpace/pendingitems",
                "AgentWorkSpace/ImplementationSteps",
            ],
            relative_files=QUEUE_RUNTIME_WORKSPACE_FILES,
            tree_paths=["src/backend/scripts/python/lib", "AgentWorkSpace/templates"],
        )

        seed_handoffs_from_templates(temp_dir)

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
            "AgentWorkSpace/handoffs/implementation-spec.md",
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
            "AgentWorkSpace/handoffs/tests.md",
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
            "AgentWorkSpace/handoffs/issues.md",
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
            "AgentWorkSpace/handoffs/final-summary.md",
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

    def test_queue_lifecycle_advances_through_real_scripts(self) -> None:
        workspace = self.create_workspace()

        for file_name, title in [
            ("01-first.md", "First Queue Task"),
            ("02-second.md", "Second Queue Task"),
        ]:
            completed = self.run_script(
                workspace,
                "src/backend/platform/queue/cli.ts",
                "create-task",
                "--title",
                title,
                "--summary",
                f"Execute {title.lower()}.",
                "--output",
                str(workspace / "AgentWorkSpace" / "dropbox" / file_name),
                "--repo-root", str(workspace),
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        (workspace / "AgentWorkSpace" / "dropbox" / "notes.txt").write_text(
            "ignore me\n",
            encoding="utf-8",
        )

        moved = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "move-dropbox-items",
            "--repo-root", str(workspace),
        )
        self.assertEqual(moved.returncode, 0, msg=moved.stderr)
        activated = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "activate-next-pending-item",
            "--repo-root", str(workspace),
        )
        self.assertEqual(activated.returncode, 0, msg=activated.stderr)
        self.assertTrue((workspace / "AgentWorkSpace" / "dropbox" / "notes.txt").exists())
        self.assertEqual(list((workspace / "AgentWorkSpace" / "dropbox").glob("*.md")), [])

        pending_markdown = sorted(
            path.name for path in (workspace / "AgentWorkSpace" / "pendingitems").glob("*.md")
        )
        self.assertEqual(len(pending_markdown), 2)
        self.assertTrue(
            any(name.endswith("-01-first.md") for name in pending_markdown)
        )
        self.assertTrue(
            any(name.endswith("-02-second.md") for name in pending_markdown)
        )

        active_item = (
            workspace / "AgentWorkSpace" / "pendingitems" / ".active-item"
        ).read_text(encoding="utf-8").strip()
        self.assertTrue(active_item.endswith("-01-first.md"))

        professional_task = (
            workspace / "AgentWorkSpace" / "handoffs" / "professional-task.md"
        ).read_text(encoding="utf-8")
        self.assertIn("Task Title: First Queue Task", professional_task)
        self.assertIn("Task Kind: standard", professional_task)

        status = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "status",
            "--repo-root", str(workspace),
        )
        self.assertEqual(status.returncode, 0, msg=status.stderr)
        self.assertIn("Workspace Ready: no", status.stdout)
        self.assertIn("Active Item:", status.stdout)
        self.assertIn("-01-first.md", status.stdout)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--force",
            "--repo-root", str(workspace),
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        # C6: After closeout, handoffs are unconditionally reset and the next
        # pending item auto-activates when the workspace is ready.
        self.assertEqual(
            len(list((workspace / "AgentWorkSpace" / "pendingitems").glob("*.md"))),
            1,
        )

        next_active_item = (
            workspace / "AgentWorkSpace" / "pendingitems" / ".active-item"
        ).read_text(encoding="utf-8").strip()
        self.assertTrue(next_active_item.endswith("-02-second.md"))

        updated_professional_task = (
            workspace / "AgentWorkSpace" / "handoffs" / "professional-task.md"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "Task Title: Second Queue Task",
            updated_professional_task,
        )

    def test_queue_runtime_handles_load_without_name_collisions(self) -> None:
        workspace = self.create_workspace()

        for index in range(25):
            completed = self.run_script(
                workspace,
                "src/backend/platform/queue/cli.ts",
                "create-task",
                "--title",
                f"Burst Queue Task {index:02d}",
                "--summary",
                (
                    "Stress queue ingestion under a burst of markdown "
                    "intake files."
                ),
                "--output",
                str(workspace / "AgentWorkSpace" / "dropbox" / f"{index:02d}-burst.md"),
                "--repo-root", str(workspace),
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        moved = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "move-dropbox-items",
            "--repo-root", str(workspace),
        )
        self.assertEqual(moved.returncode, 0, msg=moved.stderr)

        pending_markdown = sorted(
            path.name for path in (workspace / "AgentWorkSpace" / "pendingitems").glob("*.md")
        )
        self.assertEqual(len(pending_markdown), 25)
        self.assertEqual(len(set(pending_markdown)), 25)
        self.assertEqual(list((workspace / "AgentWorkSpace" / "dropbox").glob("*.md")), [])

    def test_seeded_queue_workspace_includes_new_agent_id_fields(
        self,
    ) -> None:
        workspace = self.create_workspace()

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "create-task",
            "--title",
            "Agent ID Seed Task",
            "--summary",
            "Validate seeded artifact agent ID fields.",
            "--output",
            str(workspace / "AgentWorkSpace" / "dropbox" / "agent-id-seed.md"),
            "--repo-root", str(workspace),
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        moved = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "move-dropbox-items",
            "--repo-root", str(workspace),
        )
        self.assertEqual(moved.returncode, 0, msg=moved.stderr)
        activated = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "activate-next-pending-item",
            "--repo-root", str(workspace),
        )
        self.assertEqual(activated.returncode, 0, msg=activated.stderr)

        implementation = (
            workspace / "AgentWorkSpace" / "handoffs" / "implementation-spec.md"
        ).read_text(encoding="utf-8")
        issues = (workspace / "AgentWorkSpace" / "handoffs" / "issues.md").read_text(
            encoding="utf-8",
        )
        retrospective = (
            workspace / "AgentWorkSpace" / "handoffs" / "retrospective-input.md"
        ).read_text(encoding="utf-8")
        final_summary = (
            workspace / "AgentWorkSpace" / "handoffs" / "final-summary.md"
        ).read_text(encoding="utf-8")

        self.assertIn("## Task Metadata", implementation)
        self.assertIn("## Task Summary", implementation)
        self.assertIn("## Remediation Owner Agent ID", issues)
        self.assertIn("## Revalidation Agent ID", issues)
        self.assertIn("## Return-To Agent ID", issues)
        self.assertIn("## Retrospective Summary", retrospective)
        self.assertIn("## Ron's Contribution (QA and Closeout)", retrospective)
        self.assertIn("## Closeout Owner Agent ID", final_summary)

    def test_real_queue_closeout_requires_retrospective_before_completion(
        self,
    ) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(
            workspace,
            retrospective_complete=False,
        )
        self.seed_active_queue_item(workspace)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("queue.retrospective-required", completed.stdout)
        self.assertTrue((workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").exists())

    def test_real_queue_closeout_succeeds_with_valid_retrospective(
        self,
    ) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(workspace)
        self.seed_active_queue_item(workspace)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertFalse(
            (workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").exists(),
        )

    def test_real_queue_closeout_writes_retrospective_archive(self) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(workspace)
        self.seed_active_queue_item(workspace)
        context_pack_dir = workspace / "runtime-pack"
        context_pack_dir.mkdir(parents=True, exist_ok=True)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(context_pack_dir)},
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        retrospective_markdown_path = self.retrospective_markdown_path(
            context_pack_dir
        )
        retrospective_record_path = retrospective_markdown_path.with_name(
            "retrospective.md.record.json"
        )
        self.assertTrue(retrospective_markdown_path.exists())
        self.assertTrue(retrospective_record_path.exists())

    def test_queue_closeout_updates_context_pack_and_global_memory(
        self,
    ) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(workspace)
        self.seed_active_queue_item(workspace)
        context_pack_dir = workspace / "runtime-pack"
        context_pack_dir.mkdir(parents=True, exist_ok=True)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(context_pack_dir)},
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertTrue(
            self.retrospective_markdown_path(context_pack_dir).exists()
        )
        self.assertTrue(
            self.global_history_markdown_path(workspace).exists()
        )
        self.assertTrue(self.shared_memory_markdown_path(workspace).exists())

    def test_multiple_completed_tasks_recompute_shared_retrospective_memory(
        self,
    ) -> None:
        workspace = self.create_workspace()
        context_pack_dir = workspace / "runtime-pack"
        context_pack_dir.mkdir(parents=True, exist_ok=True)

        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-9000",
            title="Queue Lifecycle Task",
        )
        self.seed_active_queue_item(
            workspace,
            file_name="20260307-cap-9000.md",
        )
        first_completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(context_pack_dir)},
        )
        self.assertEqual(
            first_completed.returncode,
            0,
            msg=first_completed.stderr,
        )
        self.assertEqual(
            first_completed.returncode,
            0,
            msg=first_completed.stderr,
        )

        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-9001",
            title="Second Queue Task",
        )
        self.seed_active_queue_item(
            workspace,
            file_name="20260307-cap-9001.md",
        )
        second_completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(context_pack_dir)},
        )
        self.assertEqual(
            second_completed.returncode,
            0,
            msg=second_completed.stderr,
        )

        shared_memory = self.shared_memory_markdown_path(workspace).read_text(
            encoding="utf-8"
        )
        self.assertIn("CAP-9000: Queue Lifecycle Task", shared_memory)
        self.assertIn("CAP-9001: Second Queue Task", shared_memory)
        self.assertTrue(
            self.global_history_markdown_path(
                workspace,
                task_id="CAP-9000",
            ).exists()
        )
        self.assertTrue(
            self.global_history_markdown_path(
                workspace,
                task_id="CAP-9001",
            ).exists()
        )

    def test_real_queue_closeout_stops_when_retrospective_archive_write_fails(
        self,
    ) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(workspace)
        self.seed_active_queue_item(workspace)
        context_pack_dir = workspace / "runtime-pack"
        blocking_path = self.retrospective_markdown_path(context_pack_dir)
        blocking_path.mkdir(parents=True, exist_ok=True)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
            env={"ACTIVE_CONTEXT_PACK_DIR": str(context_pack_dir)},
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn(
            "Failed to file the completed task into QMD.",
            completed.stderr,
        )
        self.assertTrue((workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").exists())
        self.assertFalse(
            self.retrospective_markdown_path(context_pack_dir)
            .with_name("retrospective.md.record.json")
            .exists()
        )

    def test_real_queue_lifecycle_succeeds_with_valid_routing(self) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(workspace)
        self.seed_active_queue_item(workspace)
        (workspace / "AgentWorkSpace" / "pendingitems" / "20260307-next.md").write_text(
            "# Next Queue Item\n",
            encoding="utf-8",
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        # C6: After closeout, handoffs are unconditionally reset and the next
        # pending item auto-activates when the workspace is ready.
        next_active = (
            workspace / "AgentWorkSpace" / "pendingitems" / ".active-item"
        ).read_text(encoding="utf-8")
        self.assertIn("20260307-next.md", next_active)


if __name__ == "__main__":
    unittest.main()
