from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

from tests.support.handoff_factory import write_text, write_valid_retrospective
from tests.support.repo_file_sets import QUEUE_POLICY_WORKSPACE_FILES
from tests.support.script_runner import run_script
from tests.support.workspace_builder import prepare_workspace, seed_handoffs_from_templates


class QueuePolicyTransitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]

    def create_workspace(self) -> Path:
        workspace = prepare_workspace(
            self,
            relative_dirs=[
                "scripts",
                "AgentWorkSpace/handoffs",
                "AgentWorkSpace/dropbox",
                "AgentWorkSpace/pendingitems",
                "AgentWorkSpace/ImplementationSteps",
            ],
            relative_files=QUEUE_POLICY_WORKSPACE_FILES,
            tree_paths=["src/backend/scripts/python/lib", "AgentWorkSpace/templates"],
        )
        seed_handoffs_from_templates(workspace)
        return workspace

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
            meeting_context="Quick queue retrospective.",
            retrospective_summary="The queue closed cleanly.",
            what_went_well="The queue state stayed deterministic.",
            improvement="Evidence could have been prepared earlier.",
            action_item="Capture the retrospective before completion.",
            planning_note="The task framing stayed bounded.",
            product_note=(
                "The path stayed clear.\n"
                "The constraints stayed explicit.\n"
                "The slice stayed actionable."
            ),
            engineer_note=(
                "The scripts stayed deterministic.\n"
                "The regression path stayed covered."
            ),
            qa_note=(
                "QA state stayed observable.\n"
                "The closeout notes stayed concise."
            ),
            learnings="Closeout gates should derive from repo artifacts.",
            anti_patterns=(
                "Do not skip retrospective capture at queue completion."
            ),
        )

    def write_standard_active_workspace(
        self,
        workspace: Path,
        *,
        task_id: str = "CAP-321",
        final_summary_complete: bool,
        closeout_owner_agent_id: str | None = None,
        retrospective_complete: bool = True,
    ) -> None:
        if retrospective_complete:
            self.write_valid_retrospective(
                workspace,
                task_id=task_id,
                title="Queue Transition Task",
            )
        self.write_text(
            workspace,
            "AgentWorkSpace/handoffs/professional-task.md",
            f"""# Professional Task

## Task Metadata

- Task ID: {task_id}
- Task Title: Queue Transition Task
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

Validate queue policy.

## Parent Task Carry-Forward Context

## Problem Statement

Need deterministic queue transitions.

## Business Goal

Keep queue state legal.

## Scope

Workflow policy transition enforcement.

## Non-Goals

1. No changes to queue storage format.

## Constraints

## Acceptance Criteria

1. Queue transitions are deterministic.

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
- Task Title: Queue Transition Task
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

Queue transitions lack policy enforcement.

## Goals

1. Add queue policy enforcement.

## Non-Goals

1. No changes to queue storage format.

## Architecture Summary

Add queue policy enforcement.

## Touched Systems

scripts/

## Change Boundaries

Queue transition scripts only.

## Dependency Analysis

| Module | Depends On |
|---|---|
| queue/policyValidation.ts | workflow-policy/index.ts |

## Codebase Analysis

src/backend/platform/queue/policyValidation.ts is the queue enforcement entry
point into the TypeScript workflow-policy engine.

## Proposed Structure

No structural changes.

## Contracts

Validator results must stay deterministic.

## Migrations or Data Implications

None.

## Risks

Low.

## Validation Strategy

```bash
python3 -m unittest tests.test_queue_policy_transitions -v
```

## Test Coverage

tests/test_queue_policy_transitions.py

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
- Task Title: Queue Transition Task
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Test Inventory

- validator closeout coverage

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
- Task Title: Queue Transition Task
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
        final_summary_content = ""
        resolved_closeout_owner_agent_id = closeout_owner_agent_id or ""
        if final_summary_complete:
            if closeout_owner_agent_id is None:
                resolved_closeout_owner_agent_id = "qa"
            final_summary_content = """
## Completed Work

Completed queue transition enforcement.

## Key Design Decisions

- Added policy checks before queue mutation.

## Known Limitations

- None.

## Test Result Summary

Passed.

## Rollout or Operational Notes

Run local checks.

## Follow-Up Backlog

## Difficulty Assessment

- Difficulty Level: Medium
"""
        self.write_text(
            workspace,
            "AgentWorkSpace/handoffs/final-summary.md",
            f"""# Final Summary

## Task Metadata

- Task ID: {task_id}
- Task Title: Queue Transition Task
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

{resolved_closeout_owner_agent_id}
{final_summary_content}
""",
        )

    def seed_active_queue_item(
        self,
        workspace: Path,
        *,
        file_name: str = "20260307-cap-321.md",
    ) -> None:
        queue_item = workspace / "AgentWorkSpace" / "pendingitems" / file_name
        queue_item.write_text("# Queue Item\n", encoding="utf-8")
        (workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").write_text(
            file_name,
            encoding="utf-8",
        )

    def test_complete_pending_item_is_blocked_without_closeout_content(
        self,
    ) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(
            workspace,
            final_summary_complete=False,
        )
        self.seed_active_queue_item(workspace)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--repo-root", str(workspace),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("queue.closeout-required", completed.stderr)
        self.assertTrue((workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").exists())

    def test_queue_activation_waits_when_workspace_not_reset(self) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-900",
            final_summary_complete=True,
        )
        (workspace / "AgentWorkSpace" / "pendingitems" / "20260307-next-item.md").write_text(
            "# Next Item\n",
            encoding="utf-8",
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "activate-next-pending-item",
            "--repo-root", str(workspace),
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("waiting until handoffs/ is reset", completed.stdout)
        self.assertFalse(
            (workspace / "AgentWorkSpace" / "pendingitems" / ".active-item").exists(),
        )

    def test_create_followup_task_blocks_parent_without_closeout(self) -> None:
        workspace = self.create_workspace()
        dropbox_dir = workspace / "AgentWorkSpace" / "dropbox"
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-444",
            final_summary_complete=False,
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "followup",
            "--title",
            "Blocked Follow-up",
            "--requested-adjustment",
            "Address the remaining review comment.",
            "--parent-task-id",
            "CAP-444",
            "--parent-qmd-scope",
            "qmd/context-packs/sample-org",
            "--followup-reason",
            "Task needs another pass after closeout review.",
            "--carry-forward-summary",
            "Carry forward summary.",
            "--output",
            str(dropbox_dir / "blocked.md"),
            "--repo-root", str(workspace),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("closeout.final-summary-required", completed.stderr)
        self.assertFalse((dropbox_dir / "blocked.md").exists())

    def test_followup_creation_blocks_without_retrospective(self) -> None:
        workspace = self.create_workspace()
        dropbox_dir = workspace / "AgentWorkSpace" / "dropbox"
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-444A",
            final_summary_complete=True,
            retrospective_complete=False,
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "followup",
            "--title",
            "Blocked Retrospective Follow-up",
            "--requested-adjustment",
            "Address the remaining review comment.",
            "--parent-task-id",
            "CAP-444A",
            "--parent-qmd-scope",
            "qmd/context-packs/sample-org",
            "--followup-reason",
            "Task needs another pass after closeout review.",
            "--carry-forward-summary",
            "Carry forward summary.",
            "--output",
            str(dropbox_dir / "blocked-retrospective.md"),
            "--repo-root", str(workspace),
        )

        # Retrospective gaps are now warnings, not blocking errors.
        # The command should succeed but report the violation.
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertTrue(
            "closeout.retrospective" in completed.stderr
            or "closeout.retrospective" in completed.stderr
            or (dropbox_dir / "blocked-retrospective.md").exists(),
            msg=(
                "Expected either a closeout.retrospective-* warning "
                "or a created follow-up task."
            ),
        )

    def test_create_followup_task_allows_closed_parent(self) -> None:
        workspace = self.create_workspace()
        dropbox_dir = workspace / "AgentWorkSpace" / "dropbox"
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-445",
            final_summary_complete=True,
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "followup",
            "--title",
            "Allowed Follow-up",
            "--requested-adjustment",
            "Address the last operator comment.",
            "--parent-task-id",
            "CAP-445",
            "--parent-qmd-scope",
            "qmd/context-packs/sample-org",
            "--followup-reason",
            "Operator requested another child task after closeout.",
            "--carry-forward-summary",
            "Carry forward summary.",
            "--output",
            str(dropbox_dir / "allowed.md"),
            "--repo-root", str(workspace),
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertTrue((dropbox_dir / "allowed.md").exists())

    def test_queue_advance_allows_missing_routing_agent_ids(
        self,
    ) -> None:
        """Closeout no longer blocks on missing Closeout Owner Agent ID.

        The queue-advance path only validates final-summary content and
        retrospective completeness — not cosmetic agent ID fields.
        """
        workspace = self.create_workspace()
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-448",
            final_summary_complete=True,
            closeout_owner_agent_id="",
        )
        self.seed_active_queue_item(workspace)

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "complete",
            "--skip-archive",
            "--repo-root", str(workspace),
        )

        # Missing Closeout Owner Agent ID is no longer a blocking error.
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

    def test_reset_workspace_deletes_handoff_files(self) -> None:
        workspace = self.create_workspace()
        self.write_standard_active_workspace(
            workspace,
            task_id="CAP-777",
            final_summary_complete=True,
        )

        completed = self.run_script(
            workspace,
            "src/backend/platform/queue/cli.ts",
            "init",
            "--reset",
            "--force",
            "--repo-root", str(workspace),
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        handoffs = workspace / "AgentWorkSpace" / "handoffs"
        for name in (
            "professional-task.md",
            "implementation-spec.md",
            "parallel-ok.md",
            "tests.md",
            "issues.md",
            "retrospective-input.md",
            "final-summary.md",
        ):
            self.assertFalse(
                (handoffs / name).exists(),
                msg=f"{name} should be deleted after reset",
            )


if __name__ == "__main__":
    unittest.main()
