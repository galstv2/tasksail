from __future__ import annotations

import unittest

from tests.domains.queue._queue_runtime_base import QueueRuntimeIntegrationTestBase


class QueueRuntimeCloseoutTests(QueueRuntimeIntegrationTestBase):
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
        self.assertTrue(
            (
                workspace / "AgentWorkSpace" / "pendingitems" / ".active-items" / "CAP-9000"
            ).exists()
        )

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
            (
                workspace / "AgentWorkSpace" / "pendingitems" / ".active-items" / "CAP-9000"
            ).exists(),
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
        self.assertTrue(
            (
                workspace / "AgentWorkSpace" / "pendingitems" / ".active-items" / "CAP-9000"
            ).exists()
        )
        self.assertFalse(
            self.retrospective_markdown_path(context_pack_dir)
            .with_name("retrospective.md.record.json")
            .exists()
        )


if __name__ == "__main__":
    unittest.main()
