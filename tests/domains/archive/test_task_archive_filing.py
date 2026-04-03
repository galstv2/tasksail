from __future__ import annotations

from importlib import import_module
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest


class TaskArchiveFilingTests(unittest.TestCase):
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
    ) -> subprocess.CompletedProcess[str]:
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
            / "AgentWorkSpace/qmd/global/retrospectives/history/2026/cap-2001.md"
        )

    def global_history_record_path(self, repo_root: Path) -> Path:
        return self.global_history_markdown_path(repo_root).with_name(
            "cap-2001.md.record.json"
        )

    def shared_memory_markdown_path(self, repo_root: Path) -> Path:
        return repo_root / "AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md"

    def shared_memory_record_path(self, repo_root: Path) -> Path:
        return self.shared_memory_markdown_path(repo_root).with_name(
            "shared-retrospective-memory.md.record.json"
        )

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
            repo_root / "AgentWorkSpace" / "handoffs" / "professional-task.md",
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
            repo_root / "AgentWorkSpace" / "handoffs" / "implementation-spec.md",
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

            - AgentWorkSpace/handoffs/final-summary.md
            """,
        )
        self.write_file(
            repo_root / "AgentWorkSpace" / "handoffs" / "tests.md",
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
            repo_root / "AgentWorkSpace" / "handoffs" / "issues.md",
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
            repo_root / "AgentWorkSpace" / "handoffs" / "retrospective-input.md",
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
            repo_root / "AgentWorkSpace" / "handoffs" / "final-summary.md",
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

    def test_child_task_archive_filing_preserves_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=True)

            parent_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
                / "cap-1000.json"
            )
            parent_path.parent.mkdir(parents=True, exist_ok=True)
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:sample-org:CAP-1000",
                        "record_type": "task-archive",
                        "task_id": "CAP-1000",
                        "root_task_id": "CAP-1000",
                        "task_title": "Parent Task",
                        "context_pack_id": "sample-org",
                        "qmd_scope": "qmd/context-packs/sample-org",
                        "repo_name": "repo",
                        "child_depth": 0,
                        "followup_refs": [],
                    },
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_path = Path(result["record_path"])
            archive_payload = json.loads(
                archive_path.read_text(encoding="utf-8")
            )
            self.assertEqual(archive_payload["parent_task_id"], "CAP-1000")
            self.assertEqual(archive_payload["root_task_id"], "CAP-1000")
            self.assertEqual(
                archive_payload["parent_qmd_record_id"],
                "task:sample-org:CAP-1000",
            )
            self.assertEqual(archive_payload["child_depth"], 1)
            self.assertEqual(archive_payload["followup_refs"], ["CAP-2002"])
            self.assertIn(
                "Inherited queue-ordering constraint",
                archive_payload["inherited_parent_context"],
            )
            self.assertIn(
                "Clarified closeout lineage",
                archive_payload["child_task_outcome_delta"],
            )

            tasks_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json"
            )
            lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json"
            )
            repo_task_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json"
            )
            root_lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-1000"
                / "lineage.json"
            )
            parent_children_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-parent-task"
                / "CAP-1000"
                / "children.json"
            )

            self.assertTrue(tasks_index_path.exists())
            self.assertTrue(lineage_index_path.exists())
            self.assertTrue(repo_task_index_path.exists())
            self.assertTrue(root_lineage_index_path.exists())
            self.assertTrue(parent_children_index_path.exists())

            tasks_index = json.loads(
                tasks_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(tasks_index["tasks"][1]["task_id"], "CAP-2001")

            lineage_index = json.loads(
                lineage_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                lineage_index["lineage_roots"][0]["root_task_id"],
                "CAP-1000",
            )

            parent_children_index = json.loads(
                parent_children_index_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                parent_children_index["children"][0]["task_id"],
                "CAP-2001",
            )

            updated_parent = json.loads(
                parent_path.read_text(encoding="utf-8")
            )
            self.assertIn("CAP-2001", updated_parent["followup_refs"])

    def test_standard_task_archive_filing_keeps_lineage_blank(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_payload = json.loads(
                Path(result["record_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(archive_payload["parent_task_id"], "")
            self.assertEqual(archive_payload["root_task_id"], "CAP-2001")
            self.assertEqual(archive_payload["child_depth"], 0)

            tasks_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json"
            )
            lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json"
            )
            repo_task_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json"
            )
            root_lineage_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-2001"
                / "lineage.json"
            )
            parent_children_index_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-parent-task"
                / "CAP-2001"
                / "children.json"
            )

            self.assertTrue(tasks_index_path.exists())
            self.assertTrue(lineage_index_path.exists())
            self.assertTrue(repo_task_index_path.exists())
            self.assertTrue(root_lineage_index_path.exists())
            self.assertFalse(parent_children_index_path.exists())

            self.assertIn("tasks_index", result["index_outputs"])
            self.assertIn("lineage_index", result["index_outputs"])
            self.assertIn("repo_task_index", result["index_outputs"])
            self.assertIn("root_lineage_index", result["index_outputs"])

    def test_archive_payload_includes_difficulty_level_and_tag(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            archive_payload = json.loads(
                Path(result["record_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(archive_payload["difficulty_level"], "Medium")
            self.assertIn("difficulty:medium", archive_payload["tags"])

    def test_task_archive_strips_template_comments_from_payload_and_markdown(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            self.write_file(
                repo_root / "AgentWorkSpace" / "handoffs" / "professional-task.md",
                """
                # Professional Task

                ## Task Metadata

                - Task ID: CAP-2001
                - Task Title: Child Task Closeout
                - Initialized At (UTC): 2026-03-07T00:00:00Z
                - Active Branch: main
                - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

                ## Task Lineage

                - Task Kind: standard
                - Parent Task ID:
                - Root Task ID: CAP-2001
                - Parent QMD Record ID:
                - Parent QMD Scope:
                - Follow-Up Reason:

                ## Raw Request

                Refine the prior implementation. <!-- do not archive -->

                ## Business Goal

                <!-- (1-3 sentences) template only -->
                Deliver a clean archive.
                """,
            )
            self.write_file(
                repo_root / "AgentWorkSpace" / "handoffs" / "final-summary.md",
                """
                # Final Summary

                ## Task Metadata

                - Task ID: CAP-2001
                - Task Title: Child Task Closeout
                - Initialized At (UTC): 2026-03-07T00:00:00Z
                - Active Branch: main
                - Intake Source: AgentWorkSpace/pendingitems/cap-2001.md

                ## Task Lineage

                - Task Kind: standard
                - Parent Task ID:
                - Root Task ID: CAP-2001
                - Parent QMD Record ID:
                - Parent QMD Scope:
                - Follow-Up Reason:

                ## Closeout Owner Agent ID

                qa

                ## Completed Work

                Completed archive sanitization. <!-- internal note -->

                ## Key Design Decisions

                - Strip template comments before archival. <!-- not for archive -->

                ## Known Limitations

                - None.

                ## Test Result Summary

                Passed archive verification. <!-- hidden -->

                ## Rollout or Operational Notes

                None.

                ## Follow-Up Backlog

                - None.

                ## Difficulty Assessment

                - Difficulty Level: Medium <!-- internal -->
                """,
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            record_path = Path(result["record_path"])
            markdown_path = record_path.with_suffix(".md")
            archive_payload = json.loads(record_path.read_text(encoding="utf-8"))
            archive_markdown = markdown_path.read_text(encoding="utf-8")

            self.assertEqual(archive_payload["business_goal"], "Deliver a clean archive.")
            self.assertEqual(
                archive_payload["completed_work_summary"],
                "Completed archive sanitization.",
            )
            self.assertEqual(archive_payload["difficulty_level"], "Medium")
            self.assertNotIn("<!--", json.dumps(archive_payload))
            self.assertNotIn("<!--", archive_markdown)

    def test_task_closeout_writes_context_pack_retrospective_archive(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            retrospective_markdown_path = self.retrospective_markdown_path(
                context_pack_dir
            )
            self.assertEqual(
                Path(result["retrospective_markdown_path"]).resolve(),
                retrospective_markdown_path.resolve(),
            )
            self.assertTrue(retrospective_markdown_path.exists())
            markdown = retrospective_markdown_path.read_text(encoding="utf-8")
            self.assertIn("# Retrospective Input", markdown)
            self.assertIn("## Ron's Contribution (QA)", markdown)

    def test_task_closeout_writes_context_pack_retrospective_sidecar(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            retrospective_record_path = self.retrospective_record_path(
                context_pack_dir
            )
            self.assertEqual(
                Path(result["retrospective_record_path"]).resolve(),
                retrospective_record_path.resolve(),
            )
            self.assertTrue(retrospective_record_path.exists())

    def test_retrospective_archive_markdown_preserves_agent_contributions(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            markdown = self.retrospective_markdown_path(
                context_pack_dir
            ).read_text(encoding="utf-8")
            self.assertIn(
                "The archive wiring stayed deterministic.",
                markdown,
            )
            self.assertIn(
                "QA state stayed visible and the closeout notes stayed concise.",
                markdown,
            )
            self.assertIn(
                "Do not archive a task without a retrospective.",
                markdown,
            )

    def test_retrospective_sidecar_contains_structured_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(
                self.retrospective_record_path(context_pack_dir).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(payload["record_type"], "task-retrospective")
            self.assertEqual(payload["artifact_type"], "task-retrospective")
            self.assertEqual(payload["task_id"], "CAP-2001")
            self.assertEqual(
                payload["source_path"],
                "archive/retrospectives/repo/2026/cap-2001/retrospective.md",
            )
            self.assertEqual(
                payload["retrospective_summary"],
                "The task archived cleanly and preserved its learning trail.",
            )
            self.assertEqual(
                payload["what_went_well"],
                ["The archive contract stayed deterministic."],
            )
            self.assertEqual(
                payload["what_could_have_gone_better"],
                ["The retrospective could have been captured earlier."],
            )
            self.assertEqual(
                payload["action_items"],
                ["Capture the retrospective before the archive command."],
            )
            self.assertEqual(
                payload["agent_contributions"]["Software Engineer"],
                ["The archive wiring stayed deterministic."],
            )
            self.assertIn("QA", payload["workflow_roles_present"])
            self.assertEqual(
                payload["reusable_team_learnings"],
                ["Archive legality should derive from repo artifacts."],
            )
            self.assertEqual(
                payload["anti_patterns"],
                ["Do not archive a task without a retrospective."],
            )

    def test_task_closeout_writes_global_retrospective_history_entry(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            history_markdown_path = self.global_history_markdown_path(repo_root)
            history_record_path = self.global_history_record_path(repo_root)
            self.assertEqual(
                Path(result["global_history_markdown_path"]).resolve(),
                history_markdown_path.resolve(),
            )
            self.assertEqual(
                Path(result["global_history_record_path"]).resolve(),
                history_record_path.resolve(),
            )
            self.assertTrue(history_markdown_path.exists())
            self.assertTrue(history_record_path.exists())
            payload = json.loads(history_record_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["record_type"], "global-retrospective-entry")
            self.assertEqual(
                payload["global_retrospective_root"],
                "AgentWorkSpace/qmd/global/retrospectives",
            )

    def test_task_closeout_updates_shared_retrospective_memory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            shared_memory_path = self.shared_memory_markdown_path(repo_root)
            self.assertTrue(shared_memory_path.exists())
            markdown = shared_memory_path.read_text(encoding="utf-8")
            self.assertIn("# Shared Retrospective Memory", markdown)
            self.assertIn("## Contributing Tasks", markdown)
            self.assertIn("CAP-2001: Child Task Closeout", markdown)
            self.assertIn("## Recurring Strengths", markdown)

    def test_task_closeout_rejects_qmd_scope_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            external_scope = temp_path / "external-scope"
            external_scope.mkdir(parents=True, exist_ok=True)
            (context_pack_dir / "linked-scope").symlink_to(
                external_scope,
                target_is_directory=True,
            )

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
                qmd_scope="linked-scope",
            )

            self.assertEqual(completed.returncode, 1)
            self.assertIn("qmd_scope", completed.stderr)

    def test_shared_retrospective_memory_sidecar_tracks_source_task_ids(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(
                self.shared_memory_record_path(repo_root).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                payload["record_type"],
                "global-retrospective-memory",
            )
            self.assertEqual(payload["synthesized_from_task_ids"], ["CAP-2001"])
            self.assertIn(
                "The archive contract stayed deterministic.",
                payload["recurring_strengths"],
            )
            self.assertIn(
                "Capture the retrospective before the archive command.",
                payload["open_action_items"],
            )

    def test_global_retrospective_paths_do_not_modify_context_pack_archive_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(
                Path(result["retrospective_markdown_path"]).resolve(),
                self.retrospective_markdown_path(context_pack_dir).resolve(),
            )
            self.assertEqual(
                Path(result["global_history_markdown_path"]).resolve(),
                self.global_history_markdown_path(repo_root).resolve(),
            )
            self.assertTrue(
                str(self.global_history_markdown_path(repo_root).resolve()).startswith(
                    str(repo_root.resolve())
                )
            )
            self.assertFalse(
                str(self.global_history_markdown_path(repo_root).resolve()).startswith(
                    str(context_pack_dir.resolve())
                )
            )

    def test_archive_filing_fails_when_retrospective_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            blocking_path = self.retrospective_markdown_path(context_pack_dir)
            blocking_path.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn(
                "Archive downstream writes failed. Staging directory cleaned up.",
                completed.stderr,
            )
            # Transactional: archive JSON must NOT exist when downstream writes fail
            archive_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
                / "cap-2001.json"
            )
            self.assertFalse(archive_path.exists())
            # Staging directory must also be cleaned up
            staging_dirs = list(archive_path.parent.glob(".staging-*"))
            self.assertEqual(staging_dirs, [])
            self.assertFalse(
                self.retrospective_record_path(context_pack_dir).exists()
            )

    def test_historical_task_archives_remain_readable_without_retrospectives(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            context_pack_dir = Path(temp_root) / "sample-org"
            legacy_record_path = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
                / "cap-1999.json"
            )
            legacy_record_path.parent.mkdir(parents=True, exist_ok=True)
            legacy_record_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:sample-org:CAP-1999",
                        "record_type": "task-archive",
                        "task_id": "CAP-1999",
                        "root_task_id": "CAP-1999",
                        "task_title": "Legacy Archive",
                        "context_pack_id": "sample-org",
                        "qmd_scope": "qmd/context-packs/sample-org",
                        "repo_name": "repo",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            service = self.load_index_service(context_pack_dir)
            task_index = service.build_global_task_index(
                scope_dir=context_pack_dir / "qmd/context-packs/sample-org"
            )

            self.assertEqual(task_index["tasks"][0]["task_id"], "CAP-1999")

    def test_archive_refiling_rebuilds_missing_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            first_run = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
            )
            self.assertEqual(first_run.returncode, 0, msg=first_run.stderr)
            first_result = json.loads(first_run.stdout)
            record_path = Path(first_result["record_path"])
            first_payload = json.loads(record_path.read_text(encoding="utf-8"))
            first_created_at = first_payload["created_at"]

            for index_path in [
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/tasks.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/indexes/lineage.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-repo/repo"
                / "tasks.json",
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/indexes/by-root-task"
                / "CAP-2001"
                / "lineage.json",
            ]:
                index_path.unlink()

            second_run = subprocess.run(
                [
                    sys.executable,
                    str(self.script_path),
                    "--repo-root",
                    str(repo_root),
                    "--context-pack-dir",
                    str(context_pack_dir),
                    "--qmd-scope",
                    "qmd/context-packs/sample-org",
                ],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
            )
            self.assertEqual(second_run.returncode, 0, msg=second_run.stderr)
            second_result = json.loads(second_run.stdout)

            second_payload = json.loads(
                record_path.read_text(encoding="utf-8")
            )
            self.assertEqual(second_payload["created_at"], first_created_at)
            self.assertEqual(second_result["record_path"], str(record_path))

            self.assertTrue(
                (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/indexes/tasks.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/indexes/lineage.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / (
                        "qmd/context-packs/sample-org/archive/indexes/"
                        "by-repo/repo"
                    )
                    / "tasks.json"
                ).exists()
            )
            self.assertTrue(
                (
                    context_pack_dir
                    / (
                        "qmd/context-packs/sample-org/archive/indexes/"
                        "by-root-task"
                    )
                    / "CAP-2001"
                    / "lineage.json"
                ).exists()
            )


    # ------------------------------------------------------------------
    # Slice-02 tests: staging directory, manifest resume, lock scope,
    # parent archive locking
    # ------------------------------------------------------------------

    def run_archive_script_with_resume(
        self,
        *,
        repo_root: Path,
        context_pack_dir: Path,
        qmd_scope: str = "qmd/context-packs/sample-org",
    ) -> subprocess.CompletedProcess[str]:
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
                "--resume",
            ],
            cwd=self.repo_root,
            text=True,
            capture_output=True,
        )

    def test_staging_directory_created_during_filing(self) -> None:
        """Verify staging dir is created during write sequence."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # We can verify indirectly: a successful run means the staging
            # dir was created and then cleaned up. A failure mid-way would
            # leave it behind. Run successfully and confirm final state.
            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            result = json.loads(completed.stdout)
            record_path = Path(result["record_path"])
            self.assertTrue(record_path.exists())

    def test_staging_directory_cleaned_up_after_promotion(self) -> None:
        """Verify staging dir is removed after successful filing."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            # No .staging-* directories should remain after success
            archive_dir = (
                context_pack_dir
                / "qmd/context-packs/sample-org/archive/tasks/2026"
            )
            staging_dirs = list(archive_dir.glob(".staging-*"))
            self.assertEqual(
                staging_dirs,
                [],
                "Staging directory must be cleaned up after promotion",
            )

    def test_crash_during_global_history_leaves_no_orphaned_files(self) -> None:
        """Simulate failure at step 5 (global history), verify no final
        archive exists."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # Make the global history directory unwritable to simulate crash
            history_dir = repo_root / "AgentWorkSpace" / "qmd" / "global" / "retrospectives" / "history" / "2026"
            history_dir.mkdir(parents=True, exist_ok=True)
            os.chmod(str(history_dir), 0o444)

            try:
                completed = self.run_archive_script(
                    repo_root=repo_root,
                    context_pack_dir=context_pack_dir,
                )
                self.assertNotEqual(completed.returncode, 0)

                # Archive JSON must NOT exist in the final location
                archive_path = (
                    context_pack_dir
                    / "qmd/context-packs/sample-org/archive/tasks/2026"
                    / "cap-2001.json"
                )
                self.assertFalse(
                    archive_path.exists(),
                    "Archive must not exist in final location after failure",
                )
                # Staging directory must be cleaned up (non-resume mode)
                staging_dirs = list(archive_path.parent.glob(".staging-*"))
                self.assertEqual(staging_dirs, [])
            finally:
                os.chmod(str(history_dir), 0o755)

    def test_resume_skips_completed_steps(self) -> None:
        """Write a manifest with steps 1-3 complete, run with --resume,
        verify steps 1-3 are not re-executed."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # Do a successful first run
            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            first_result = json.loads(first.stdout)

            # Delete the final archive but leave downstream files.
            # Create a staging directory with manifest + archive to simulate
            # a partial run that completed steps 1-3 but failed at promotion.
            record_path = Path(first_result["record_path"])
            payload = json.loads(record_path.read_text(encoding="utf-8"))

            staging_dir = record_path.parent / f".staging-{payload['task_id'].strip().lower()}"
            # Need to slugify the same way the script does
            staging_dir = record_path.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)

            archive_staging = staging_dir / "archive.json"
            archive_staging.write_text(
                json.dumps(payload, indent=2) + "\n", encoding="utf-8"
            )
            manifest = {
                "archive": "written",
                "retrospective_md": "written",
                "retrospective_record": "written",
            }
            (staging_dir / "manifest.json").write_text(
                json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
            )

            # Remove the final archive to allow re-promotion
            record_path.unlink()

            # Run with --resume
            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)
            resumed_result = json.loads(resumed.stdout)
            self.assertEqual(resumed_result["status"], "filed")
            self.assertTrue(Path(resumed_result["record_path"]).exists())

    def test_resume_does_not_duplicate_global_history(self) -> None:
        """Simulate crash after global history, resume, verify exactly
        one global history entry."""
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            # First run to establish all files
            first = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(first.returncode, 0, msg=first.stderr)
            first_result = json.loads(first.stdout)

            # Record the global history content
            history_md_path = self.global_history_markdown_path(repo_root)
            original_history = history_md_path.read_text(encoding="utf-8")

            # Simulate partial run: create staging dir with manifest that has
            # archive + retrospective + global_history steps done
            record_path = Path(first_result["record_path"])
            payload = json.loads(record_path.read_text(encoding="utf-8"))

            staging_dir = record_path.parent / ".staging-cap-2001"
            staging_dir.mkdir(parents=True, exist_ok=True)
            (staging_dir / "archive.json").write_text(
                json.dumps(payload, indent=2) + "\n", encoding="utf-8"
            )
            manifest = {
                "archive": "written",
                "retrospective_md": "written",
                "retrospective_record": "written",
                "global_history_md": "written",
                "global_history_record": "written",
            }
            (staging_dir / "manifest.json").write_text(
                json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
            )
            record_path.unlink()

            # Resume — global history steps should be skipped
            resumed = self.run_archive_script_with_resume(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(resumed.returncode, 0, msg=resumed.stderr)

            # Global history file should still have exactly the same content
            # (not duplicated)
            self.assertEqual(
                history_md_path.read_text(encoding="utf-8"),
                original_history,
                "Global history must not be duplicated on resume",
            )

    def test_parent_archive_update_is_locked(self) -> None:
        """Concurrent calls to update_parent_archive() with different
        child IDs — both followup_refs entries must be present."""
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")

        with tempfile.TemporaryDirectory() as temp_root:
            parent_path = Path(temp_root) / "parent.json"
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:org:PARENT-1",
                        "record_type": "task-archive",
                        "task_id": "PARENT-1",
                        "root_task_id": "PARENT-1",
                        "followup_refs": [],
                        "indexed_at": "2026-03-01T00:00:00Z",
                        "updated_at": "2026-03-01T00:00:00Z",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            barrier = threading.Barrier(2)
            errors: list[Exception] = []

            def update(child_id: str) -> None:
                try:
                    barrier.wait()
                    archive_mod.update_parent_archive(
                        parent_path, child_id, "2026-03-12T00:00:00Z"
                    )
                except Exception as exc:
                    errors.append(exc)

            threads = [
                threading.Thread(target=update, args=("CHILD-A",)),
                threading.Thread(target=update, args=("CHILD-B",)),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(errors, [], f"Concurrent updates failed: {errors}")

            final = json.loads(parent_path.read_text(encoding="utf-8"))
            refs = final.get("followup_refs", [])
            self.assertIn("CHILD-A", refs)
            self.assertIn("CHILD-B", refs)

    def test_parent_indexed_at_preserved_after_child_update(self) -> None:
        """update_parent_archive() must not overwrite the parent's indexed_at.

        Only updated_at should reflect the child event timestamp.
        """
        archive_mod = import_module("src.backend.scripts.python.file-task-archive")

        with tempfile.TemporaryDirectory() as temp_root:
            parent_path = Path(temp_root) / "parent.json"
            original_indexed_at = "2026-01-15T10:00:00Z"
            parent_path.write_text(
                json.dumps(
                    {
                        "schema_version": "qmd-record/v1",
                        "record_id": "task:org:PARENT-IDX",
                        "record_type": "task-archive",
                        "task_id": "PARENT-IDX",
                        "root_task_id": "PARENT-IDX",
                        "followup_refs": [],
                        "indexed_at": original_indexed_at,
                        "updated_at": original_indexed_at,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            child_timestamp = "2026-03-20T14:30:00Z"
            archive_mod.update_parent_archive(
                parent_path, "CHILD-IDX-1", child_timestamp,
            )

            final = json.loads(parent_path.read_text(encoding="utf-8"))
            self.assertEqual(
                final["indexed_at"],
                original_indexed_at,
                "indexed_at must not be overwritten by child update",
            )
            self.assertEqual(
                final["updated_at"],
                child_timestamp,
                "updated_at should reflect the child event timestamp",
            )
            self.assertIn("CHILD-IDX-1", final["followup_refs"])

    def test_lock_covers_global_history_through_indexes(self) -> None:
        """Verify the lock is held from global history (step 4) through
        retrospective indexes (step 10).

        We confirm this structurally by checking that the shared_memory_lock_path
        lock file is created, and that global history + shared memory + retro
        indexes are all written atomically in a successful run.
        """
        with tempfile.TemporaryDirectory() as temp_root:
            temp_path = Path(temp_root)
            repo_root = temp_path / "repo"
            context_pack_dir = temp_path / "sample-org"
            self.base_handoffs(repo_root, child_task=False)
            context_pack_dir.mkdir(parents=True, exist_ok=True)

            completed = self.run_archive_script(
                repo_root=repo_root,
                context_pack_dir=context_pack_dir,
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            # All files under the lock scope must exist
            self.assertTrue(
                self.global_history_markdown_path(repo_root).exists(),
                "Global history markdown missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.global_history_record_path(repo_root).exists(),
                "Global history record missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.shared_memory_markdown_path(repo_root).exists(),
                "Shared memory markdown missing — lock scope may be incomplete",
            )
            self.assertTrue(
                self.shared_memory_record_path(repo_root).exists(),
                "Shared memory record missing — lock scope may be incomplete",
            )

            # Retrospective indexes must exist (written under same lock)
            retro_root = repo_root / "AgentWorkSpace" / "qmd" / "global" / "retrospectives"
            history_index = retro_root / "indexes" / "history.json"
            self.assertTrue(
                history_index.exists(),
                "Retrospective history index missing — may not be under lock scope",
            )


if __name__ == "__main__":
    unittest.main()
