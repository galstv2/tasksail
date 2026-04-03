from __future__ import annotations

import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services.seeding_service import SeedRuntimeState, SeedingService  # noqa: E402


class SeedRuntimeStateTests(unittest.TestCase):
    def test_snapshot_reflects_latest_run(self) -> None:
        state = SeedRuntimeState()

        self.assertIsNone(state.snapshot().latest_run)
        state.set_latest_run({"overall_status": "success"})

        self.assertEqual(
            state.snapshot().latest_run, {"overall_status": "success"}
        )

    def test_acquire_and_release_seed_run(self) -> None:
        state = SeedRuntimeState()

        self.assertTrue(state.acquire_seed_run())
        self.assertFalse(state.acquire_seed_run())
        state.release_seed_run()
        self.assertTrue(state.acquire_seed_run())
        state.release_seed_run()

    def test_concurrent_acquire_grants_exactly_one(self) -> None:
        """Two threads race to acquire — exactly one must win."""
        state = SeedRuntimeState()
        results: list[bool] = []
        barrier = threading.Barrier(2)

        def try_acquire() -> None:
            barrier.wait()
            results.append(state.acquire_seed_run())

        threads = [threading.Thread(target=try_acquire) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(sorted(results), [False, True])
        state.release_seed_run()

    def test_snapshot_is_isolated_from_later_mutations(self) -> None:
        """Mutating the dict passed to set_latest_run must not change
        a previously taken snapshot."""
        state = SeedRuntimeState()
        report: dict[str, object] = {"status": "running"}
        state.set_latest_run(report)

        snap = state.snapshot()

        # Mutate the original dict after taking a snapshot.
        report["status"] = "done"
        state.set_latest_run({"status": "done"})

        # The snapshot must reflect the state at the time it was taken.
        self.assertEqual(snap.latest_run, {"status": "running"})

    def test_seed_runtime_state_locks_are_independent(self) -> None:
        """Holding the run lock must not block set_latest_run/snapshot."""
        state = SeedRuntimeState()

        self.assertTrue(state.acquire_seed_run())
        try:
            # These use _state_lock, which must be independent of _run_lock.
            state.set_latest_run({"status": "running"})
            snap = state.snapshot()
            self.assertEqual(snap.latest_run, {"status": "running"})
        finally:
            state.release_seed_run()

    def test_release_without_acquire_raises(self) -> None:
        """Releasing a lock that was never acquired must raise."""
        state = SeedRuntimeState()
        with self.assertRaises(RuntimeError):
            state.release_seed_run()

    def test_force_release_if_held_releases_active_lock(self) -> None:
        state = SeedRuntimeState()
        state.acquire_seed_run()
        result = state.force_release_if_held()
        self.assertTrue(result)
        # Lock should be free after release
        self.assertTrue(state.acquire_seed_run())
        state.release_seed_run()

    def test_force_release_if_held_noop_when_not_held(self) -> None:
        state = SeedRuntimeState()
        result = state.force_release_if_held()
        self.assertFalse(result)
        # Lock should still be acquirable
        self.assertTrue(state.acquire_seed_run())
        state.release_seed_run()


    def test_snapshot_returns_frozen_reference_directly(self) -> None:
        """Two snapshots must return the same frozen object — no deepcopy."""
        state = SeedRuntimeState()
        state.set_latest_run({"overall_status": "success", "repos": [1, 2]})

        snap1 = state.snapshot()
        snap2 = state.snapshot()

        self.assertIs(snap1.latest_run, snap2.latest_run)


class SeedingPreviewFailureLoggingTests(unittest.TestCase):
    """Verify that unreadable files produce a debug log, not a silent swallow."""

    def test_preview_read_failure_logs_debug(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            cp_dir = workspace / "ctx"
            scope_dir = cp_dir / "qmd" / "scope"
            scope_dir.mkdir(parents=True)
            src_file = workspace / "repo" / "main.py"
            src_file.parent.mkdir(parents=True)
            src_file.write_text("x = 1")

            def _noop_write(path, content):
                path.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(content, str):
                    path.write_text(content)
                else:
                    path.write_text("{}")

            service = SeedingService(
                workspace_root=workspace,
                default_manifest="m.json",
                default_plan_file="p.json",
                normalize_repo_entry=lambda *a: {},
                detect_source_ref=lambda _: "HEAD",
                iter_scan_files=lambda targets: ([src_file], []),
                relative_source_path=lambda root, fp: fp.name,
                detect_artifact_type=lambda _: "source",
                record_storage_path=lambda scope, layer, rid, sp: scope / layer / f"{sp}.record.json",
                sidecar_record_path=lambda p: p.with_suffix(p.suffix + ".record.json"),
                state_file_path=lambda scope, rid: scope / f"{rid}.state.json",
                report_file_path=lambda scope, rid: scope / f"{rid}.report.json",
                write_json=_noop_write,
                write_text=_noop_write,
                invalidate_record=lambda *a, **kw: None,
                create_artifact_record=lambda **kw: {"record_type": "artifact"},
                create_summary_record=lambda **kw: {"record_type": "summary"},
                create_bootstrap_note_record=lambda **kw: {"record_type": "bootstrap"},
                build_repo_summary_markdown=lambda **kw: "# Summary",
                build_bootstrap_note_markdown=lambda **kw: "# Bootstrap",
                build_context_pack_conventions_markdown=lambda **kw: "# Conv",
                create_context_pack_conventions_record=lambda **kw: {},
            )

            plan = {
                "context_pack_id": "test-pack",
                "qmd_scope_root": "qmd/scope",
            }
            repo = {
                "repo_id": "test-repo",
                "repo_name": "test-repo",
                "status": "ready",
                "existing_roots": [str(src_file.parent)],
                "system_layer": "shared",
                "qmd_targets": {
                    "canonical_repo_summary": "qmd/scope/summary.md",
                    "operational_bootstrap_note": "qmd/scope/bootstrap.md",
                },
            }

            with patch(
                "src.backend.mcp.repo_context_mcp.services.seeding_service.read_preview",
                side_effect=PermissionError("access denied"),
            ):
                with self.assertLogs(
                    "src.backend.mcp.repo_context_mcp.services.seeding_service",
                    level="DEBUG",
                ) as cm:
                    result = service.seed_repository(cp_dir, plan, repo, "2025-01-01T00:00:00Z")

            self.assertEqual(result.status, "seeded")
            self.assertTrue(
                any("Preview read failed" in m for m in cm.output)
            )


if __name__ == "__main__":
    unittest.main()
