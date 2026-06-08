from __future__ import annotations

import unittest

from tests.domains.queue._queue_runtime_base import QueueRuntimeIntegrationTestBase


class QueueRuntimeIntegrationTests(QueueRuntimeIntegrationTestBase):
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

        # Resolve the active task ID from .active-items/ to build the per-task path.
        active_items_dir = workspace / "AgentWorkSpace" / "pendingitems" / ".active-items"
        first_task_ids = [
            p.name for p in active_items_dir.iterdir()
            if not p.name.endswith(".completing")
        ]
        self.assertEqual(len(first_task_ids), 1)
        first_task_id = first_task_ids[0]
        active_item = (active_items_dir / first_task_id).read_text(encoding="utf-8").strip()
        self.assertTrue(active_item.endswith("-01-first.md"))

        professional_task = (
            workspace / "AgentWorkSpace" / "tasks" / first_task_id / "handoffs" / "professional-task.md"
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

        # Resolve the second active task ID from .active-items/.
        second_task_ids = [
            p.name for p in active_items_dir.iterdir()
            if not p.name.endswith(".completing")
        ]
        self.assertEqual(len(second_task_ids), 1)
        second_task_id = second_task_ids[0]
        next_active_item = (active_items_dir / second_task_id).read_text(encoding="utf-8").strip()
        self.assertTrue(next_active_item.endswith("-02-second.md"))

        updated_professional_task = (
            workspace / "AgentWorkSpace" / "tasks" / second_task_id / "handoffs" / "professional-task.md"
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

        # Resolve the seeded task ID from .active-items/ to build the per-task path.
        seeded_active_items_dir = workspace / "AgentWorkSpace" / "pendingitems" / ".active-items"
        seeded_task_ids = [
            p.name for p in seeded_active_items_dir.iterdir()
            if not p.name.endswith(".completing")
        ]
        self.assertEqual(len(seeded_task_ids), 1)
        seeded_task_id = seeded_task_ids[0]
        seeded_handoffs = workspace / "AgentWorkSpace" / "tasks" / seeded_task_id / "handoffs"

        implementation = (seeded_handoffs / "implementation-spec.md").read_text(encoding="utf-8")
        issues = (seeded_handoffs / "issues.md").read_text(encoding="utf-8")
        retrospective = (seeded_handoffs / "retrospective-input.md").read_text(encoding="utf-8")
        final_summary = (seeded_handoffs / "final-summary.md").read_text(encoding="utf-8")

        self.assertIn("## Task Metadata", implementation)
        self.assertIn("## Problem and Outcome", implementation)
        self.assertIn("## Remediation Owner Agent ID", issues)
        self.assertIn("## Revalidation Agent ID", issues)
        self.assertIn("## Return-To Agent ID", issues)
        self.assertIn("## Retrospective Summary", retrospective)
        self.assertIn("## Ron's Contribution (QA and Closeout)", retrospective)
        self.assertIn("## Closeout Owner Agent ID", final_summary)

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
        active_items_dir = workspace / "AgentWorkSpace" / "pendingitems" / ".active-items"
        next_task_ids = [
            p.name for p in active_items_dir.iterdir()
            if not p.name.endswith(".completing")
        ]
        self.assertEqual(len(next_task_ids), 1)
        next_active = (active_items_dir / next_task_ids[0]).read_text(encoding="utf-8")
        self.assertIn("20260307-next.md", next_active)


if __name__ == "__main__":
    unittest.main()
