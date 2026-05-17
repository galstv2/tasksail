from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import unittest
from importlib import import_module
from pathlib import Path


class TaskArchiveFilingTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.script_path = (
            cls.repo_root / "src" / "backend" / "scripts" / "python" / "file-task-archive.py"
        )

    def write_file(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            textwrap.dedent(content).lstrip("\n"),
            encoding="utf-8",
        )

    def run_archive_script(
        self,
        *,
        repo_root: Path,
        context_pack_dir: Path,
        qmd_scope: str = "qmd/context-packs/sample-org",
        task_id: str = "CAP-2001",
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["TASKSAIL_TASK_ID"] = task_id
        return subprocess.run(
            [
                sys.executable,
                str(self.script_path),
                "--repo-root",
                str(repo_root),
                "--context-pack-dir",
                str(context_pack_dir),
                "--qmd-scope",
                qmd_scope,
            ],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
            env=env,
        )

    def retrospective_markdown_path(self, context_pack_dir: Path) -> Path:
        return (
            context_pack_dir
            / "qmd/context-packs/sample-org/archive/retrospectives/repo/2026"
            / "cap-2001/retrospective.md"
        )

    def retrospective_record_path(self, context_pack_dir: Path) -> Path:
        return self.retrospective_markdown_path(context_pack_dir).with_name(
            "retrospective.md.record.json"
        )

    def global_history_markdown_path(self, repo_root: Path) -> Path:
        return (
            repo_root
            / "AgentWorkSpace/qmd/global/retrospectives/history/2026/cap-2001/retrospective.md"
        )

    def global_history_record_path(self, repo_root: Path) -> Path:
        return self.global_history_markdown_path(repo_root).with_name(
            "retrospective.md.record.json"
        )

    def shared_memory_markdown_path(self, repo_root: Path) -> Path:
        return repo_root / "AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md"

    def shared_memory_record_path(self, repo_root: Path) -> Path:
        return self.shared_memory_markdown_path(repo_root).with_name(
            "shared-retrospective-memory.md.record.json"
        )

    def task_archive_dir(
        self,
        context_pack_dir: Path,
        *,
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return (
            context_pack_dir
            / "qmd/context-packs/sample-org/archive/tasks"
            / year
            / task_slug
        )

    def task_archive_json_path(
        self,
        context_pack_dir: Path,
        *,
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.task_archive_dir(
            context_pack_dir,
            task_slug=task_slug,
            year=year,
        ) / "archive.json"

    def task_archive_markdown_path(
        self,
        context_pack_dir: Path,
        *,
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.task_archive_dir(
            context_pack_dir,
            task_slug=task_slug,
            year=year,
        ) / "archive.md"

    def task_archive_snapshot_path(
        self,
        context_pack_dir: Path,
        *,
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.task_archive_dir(
            context_pack_dir,
            task_slug=task_slug,
            year=year,
        ) / "planner-focus-snapshot.json"

    def task_archive_manifest_path(
        self,
        context_pack_dir: Path,
        *,
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.task_archive_dir(
            context_pack_dir,
            task_slug=task_slug,
            year=year,
        ) / "handoff-artifacts-manifest.json"

    def mirror_task_archive_dir(
        self,
        repo_root: Path,
        *,
        context_pack_name: str = "sample-org",
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return (
            repo_root
            / "AgentWorkSpace"
            / "qmd"
            / "context-packs"
            / context_pack_name
            / "archive"
            / "tasks"
            / year
            / task_slug
        )

    def mirror_task_archive_json_path(
        self,
        repo_root: Path,
        *,
        context_pack_name: str = "sample-org",
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.mirror_task_archive_dir(
            repo_root,
            context_pack_name=context_pack_name,
            task_slug=task_slug,
            year=year,
        ) / "archive.json"

    def mirror_task_archive_markdown_path(
        self,
        repo_root: Path,
        *,
        context_pack_name: str = "sample-org",
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.mirror_task_archive_dir(
            repo_root,
            context_pack_name=context_pack_name,
            task_slug=task_slug,
            year=year,
        ) / "archive.md"

    def mirror_task_archive_snapshot_path(
        self,
        repo_root: Path,
        *,
        context_pack_name: str = "sample-org",
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.mirror_task_archive_dir(
            repo_root,
            context_pack_name=context_pack_name,
            task_slug=task_slug,
            year=year,
        ) / "planner-focus-snapshot.json"

    def mirror_task_archive_manifest_path(
        self,
        repo_root: Path,
        *,
        context_pack_name: str = "sample-org",
        task_slug: str = "cap-2001",
        year: str = "2026",
    ) -> Path:
        return self.mirror_task_archive_dir(
            repo_root,
            context_pack_name=context_pack_name,
            task_slug=task_slug,
            year=year,
        ) / "handoff-artifacts-manifest.json"

    def load_index_service(self, context_pack_dir: Path):
        service_cls = import_module(
            "src.backend.mcp.repo_context_mcp.services.qmd_index_service"
        ).QmdIndexService
        return service_cls(workspace_root=context_pack_dir.parent)

    def seed_named_agent_instructions(self, repo_root: Path) -> None:
        for relative_path in [
            ".github/copilot/instructions/planning-agent.instructions.md",
            ".github/copilot/instructions/product-manager.instructions.md",
            ".github/copilot/instructions/software-engineer.instructions.md",
            ".github/copilot/instructions/qa.instructions.md",
            ".github/agents/planning-agent.md",
            ".github/agents/product-manager.md",
            ".github/agents/software-engineer.md",
            ".github/agents/qa.md",
            ".github/agents/registry.json",
        ]:
            source = self.repo_root / relative_path
            target = repo_root / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                source.read_text(encoding="utf-8"),
                encoding="utf-8",
            )

    def base_handoffs(self, repo_root: Path, *, child_task: bool) -> None:
        self.seed_named_agent_instructions(repo_root)
        task_kind = "child-task" if child_task else "standard"
        parent_task_id = "CAP-1000" if child_task else ""
        root_task_id = parent_task_id if child_task else "CAP-2001"
        parent_qmd_record_id = (
            "task:sample-org:CAP-1000" if child_task else ""
        )
        parent_qmd_scope = (
            "qmd/context-packs/sample-org" if child_task else ""
        )
        followup_reason = (
            "Address operator feedback." if child_task else ""
        )
        inherited_parent_context = (
            "Inherited queue-ordering constraint from the parent task."
            if child_task
            else ""
        )
        child_task_outcome_delta = (
            "Clarified closeout lineage and added task archive filing."
            if child_task
            else ""
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "professional-task.md",
            f"""
            # Professional Task

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

            ## Task Lineage

            - Task Kind: {task_kind}
            - Parent Task ID: {parent_task_id}
            - Root Task ID: {root_task_id}
            - Parent QMD Record ID: {parent_qmd_record_id}
            - Parent QMD Scope: {parent_qmd_scope}
            - Follow-Up Reason: {followup_reason}

            ## Raw Request

            Refine the prior implementation after closeout.

            ## Parent Task Carry-Forward Context

            Parent task shipped the first pass and preserved queue ordering.

            ## Problem Statement

            The child task needs a small follow-up.

            ## Business Goal

            Ship the requested follow-up without reopening the parent task.

            ## Scope

            Focus on the follow-up path.

            ## Non-Goals

            1. Do not rewrite the original feature.

            ## Constraints

            - Preserve queue ordering.

            ## Acceptance Criteria

            1. Follow-up is filed cleanly.

            ## Risks

            - Closeout lineage may be lost if not filed.

            ## Open Questions
            """,
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "implementation-spec.md",
            f"""
            # Implementation Spec

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

            ## Task Lineage

            - Task Kind: {task_kind}
            - Parent Task ID: {parent_task_id}
            - Root Task ID: {root_task_id}
            - Parent QMD Record ID: {parent_qmd_record_id}
            - Parent QMD Scope: {parent_qmd_scope}
            - Follow-Up Reason: {followup_reason}

            ## Parent Task Carry-Forward Context

            Parent task shipped the first pass and preserved queue ordering.

            ## Problem Statement

            Child task closeout needs lineage preservation.

            ## Goals

            1. Preserve lineage fields during closeout.

            ## Non-Goals

            1. No changes to parent task archive.

            ## Architecture Summary

            Follow up surgically.

            ## Touched Systems

            - src/backend/platform/queue/completePendingItem.ts
            - slice-07-child-task-closeout-and-lineage-preservation.md

            ## Change Boundaries

            - Keep closeout additive.

            ## Dependency Analysis

            | Module | Depends On |
            |---|---|
            | src/backend/platform/queue/cli.ts complete | queue closeout helpers |

            ## Codebase Analysis

            The queue complete command manages the closeout flow.

            ## Proposed Structure

            No structural changes.

            ## Contracts

            - Preserve lineage.

            ## Migrations or Data Implications

            - None.

            ## Risks

            - Missing lineage fields.

            ## Validation Strategy

            ```bash
            python3 -m unittest tests.test_task_archive_filing -v
            ```

            ## Test Coverage

            tests/test_task_archive_filing.py

            ## Impact Assessment

            Low.

            ## Files or Areas Likely to Change

            - AgentWorkSpace/tasks/CAP-2001/handoffs/final-summary.md
            """,
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "tests.md",
            """
            # Tests

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

            ## Test Inventory

            - archive filing coverage

            ## Commands

            - python -m unittest

            ## Coverage Notes

            Passed closeout verification.
            """,
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "issues.md",
            """
            # QA Issues

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

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
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "retrospective-input.md",
            """
            # Retrospective Input

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

            ## Task Lineage

            - Task Kind: standard
            - Parent Task ID:
            - Root Task ID:
            - Parent QMD Record ID:
            - Parent QMD Scope:
            - Follow-Up Reason:

            ## Meeting Context

            Quick archive retrospective.

            ## Retrospective Summary

            The task archived cleanly and preserved its learning trail.

            ## What Went Well

            - The archive contract stayed deterministic.

            ## What Could Have Gone Better

            - The retrospective could have been captured earlier.

            ## Action Items

            - Capture the retrospective before the archive command.

            ## Lily's Contribution (Planning Specialist)

            - The task framing stayed bounded.

            ## Alice's Contribution (Product Manager)

            - The path stayed clear.

            ## Dalton's Contribution (Software Engineer)

            - The archive wiring stayed deterministic.

            ## Ron's Contribution (QA)

            - QA state stayed visible and the closeout notes stayed concise.

            ## Reusable Team Learnings

            - Archive legality should derive from repo artifacts.

            ## Anti-Patterns To Avoid

            - Do not archive a task without a retrospective.
            """,
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "handoffs" / "final-summary.md",
            f"""
            # Final Summary

            ## Task Metadata

            - Task ID: CAP-2001
            - Task Title: Child Task Closeout
            - Initialized At (UTC): 2026-03-07T00:00:00Z
            - Active Branch: main
            - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

            ## Task Lineage

            - Task Kind: {task_kind}
            - Parent Task ID: {parent_task_id}
            - Root Task ID: {root_task_id}
            - Parent QMD Record ID: {parent_qmd_record_id}
            - Parent QMD Scope: {parent_qmd_scope}
            - Follow-Up Reason: {followup_reason}

            ## Inherited Parent Context

            {inherited_parent_context}

            ## Child-Task Outcome Delta

            {child_task_outcome_delta}

            ## Closeout Owner Agent ID

            qa

            ## Completed Work

            Completed slice-07-child-task-closeout-and-lineage-preservation.md
            and filed the follow-up lineage.

            ## Key Design Decisions

            - Preserve parent lineage in closeout.

            ## Known Limitations

            - Future renderer wiring is still pending.

            ## Test Result Summary

            Passed unit and local checks.

            ## Rollout or Operational Notes

            No rollout blocker.

            ## Follow-Up Backlog

            - CAP-2002

            ## Difficulty Assessment

            - Difficulty Level: Medium
            """,
        )

    def seed_implementation_steps(self, repo_root: Path) -> None:
        steps_dir = repo_root / "AgentWorkSpace" / "tasks" / "CAP-2001" / "ImplementationSteps"
        self.write_file(
            steps_dir / "slice-1.md",
            """
            # Slice 1

            Implement the archive artifact copy.
            """,
        )
        self.write_file(
            steps_dir / "slice-2.md",
            """
            # Slice 2

            Verify the mirror copy.
            """,
        )
        self.write_file(
            steps_dir / "slice-template.md",
            """
            # Slice Template

            Do not archive this template.
            """,
        )
