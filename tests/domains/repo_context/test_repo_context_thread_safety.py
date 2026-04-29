from __future__ import annotations

import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from src.backend.mcp.repo_context_mcp import app as repo_context_app
from src.backend.mcp.repo_context_mcp.services.qmd_index_service import (
    QmdIndexService,
)
from src.backend.mcp.repo_context_mcp.services.record_cache import (
    ScopedRecordCache,
)
from src.backend.mcp.repo_context_mcp.services.runtime_state import (
    SeedRuntimeStateRegistry,
)


class ScopedRecordCacheThreadSafetyTests(unittest.TestCase):
    def test_get_returns_shallow_copy_while_threads_mutate_cache(self) -> None:
        cache = ScopedRecordCache(ttl_seconds=60)
        scope_dir = Path("/workspace/context-pack")
        initial = [
            (
                scope_dir / "a.record.json",
                {"record_type": "task", "record_id": "a"},
            )
        ]
        cache.put_scope(scope_dir, {"task": initial})

        first = cache.get(scope_dir, "task")
        self.assertIsNotNone(first)
        first.append(
            (
                scope_dir / "mutated.record.json",
                {"record_type": "task", "record_id": "mutated"},
            )
        )

        second = cache.get(scope_dir, "task")
        self.assertIsNotNone(second)
        self.assertEqual([payload["record_id"] for _, payload in second], ["a"])

        errors: list[BaseException] = []
        errors_lock = threading.Lock()

        def worker(index: int) -> None:
            try:
                path = scope_dir / f"{index}.record.json"
                cache.merge_scope(
                    scope_dir,
                    [(path, {"record_type": "task", "record_id": str(index)})],
                )
                records = cache.get(scope_dir, "task")
                if records is not None:
                    records.append(
                        (
                            scope_dir / f"local-{index}.record.json",
                            {
                                "record_type": "task",
                                "record_id": f"local-{index}",
                            },
                        )
                    )
                if index % 5 == 0:
                    cache.invalidate(Path("/workspace/other-context-pack"))
            except BaseException as exc:  # pragma: no cover - failure surfaced below
                with errors_lock:
                    errors.append(exc)

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(worker, range(40)))

        self.assertEqual(errors, [])
        records = cache.get(scope_dir, "task")
        self.assertIsNotNone(records)
        self.assertTrue(records)
        self.assertFalse(
            any(payload["record_id"].startswith("local-") for _, payload in records)
        )


class _ArchiveServiceStub:
    def __init__(self) -> None:
        self.calls = 0
        self._lock = threading.Lock()

    def iter_task_archive_records(
        self, scope_dir: Path
    ) -> list[tuple[Path, dict[str, str]]]:
        with self._lock:
            self.calls += 1
        return [
            (
                scope_dir / "task.record.json",
                {"record_type": "task", "record_id": "task"},
            )
        ]

    def task_archive_descriptor(
        self,
        path: Path,
        record: dict[str, str],
    ) -> dict[str, str]:
        return {
            "repo_name": "repo",
            "root_task_id": "root",
            "task_id": record["record_id"],
            "path": path.as_posix(),
        }

    def invalidate_cache(self, _scope_dir: Path | None = None) -> None:
        return None


class QmdIndexServiceThreadSafetyTests(unittest.TestCase):
    def test_task_descriptors_returns_copy_and_cache_is_thread_safe(self) -> None:
        archive_service = _ArchiveServiceStub()
        service = QmdIndexService(
            workspace_root=Path("/workspace"),
            archive_service=archive_service,  # type: ignore[arg-type]
        )
        scope_dir = Path("/workspace/context-pack")

        descriptors = service.task_descriptors(scope_dir)
        descriptors.append(
            {
                "repo_name": "repo",
                "root_task_id": "root",
                "task_id": "mutated",
                "path": "mutated",
            }
        )

        self.assertEqual(
            [item["task_id"] for item in service.task_descriptors(scope_dir)],
            ["task"],
        )

        def worker(index: int) -> list[dict[str, str]]:
            if index % 7 == 0:
                service.invalidate_descriptor_cache(scope_dir)
            return service.task_descriptors(scope_dir)

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(worker, range(40)))

        for result in results:
            self.assertEqual([item["task_id"] for item in result], ["task"])
        self.assertGreaterEqual(archive_service.calls, 1)


class SeedRuntimeStateRegistryTests(unittest.TestCase):
    def test_same_scope_conflicts_while_different_scopes_run(self) -> None:
        registry = SeedRuntimeStateRegistry()

        self.assertTrue(registry.acquire_seed_run("/workspace/scope-a"))
        self.assertFalse(registry.acquire_seed_run("/workspace/scope-a"))
        self.assertTrue(registry.acquire_seed_run("/workspace/scope-b"))

        registry.release_seed_run("/workspace/scope-b")
        registry.release_seed_run("/workspace/scope-a")

        self.assertTrue(registry.acquire_seed_run("/workspace/scope-a"))
        registry.release_seed_run("/workspace/scope-a")


class LazyServiceInitializationThreadSafetyTests(unittest.TestCase):
    def test_seeding_service_lazy_init_only_constructs_once(self) -> None:
        prior_service = repo_context_app._SEEDING_SERVICE
        service = mock.Mock()
        create_calls = 0
        create_calls_lock = threading.Lock()
        create_started = threading.Event()
        allow_return = threading.Event()

        def create_service() -> mock.Mock:
            nonlocal create_calls
            with create_calls_lock:
                create_calls += 1
            create_started.set()
            allow_return.wait(timeout=2)
            return service

        try:
            repo_context_app._SEEDING_SERVICE = None
            with mock.patch.object(
                repo_context_app,
                "create_seeding_service",
                side_effect=create_service,
            ):
                with ThreadPoolExecutor(max_workers=8) as executor:
                    futures = [
                        executor.submit(repo_context_app.get_seeding_service)
                        for _ in range(20)
                    ]
                    self.assertTrue(create_started.wait(timeout=2))
                    allow_return.set()
                    results = [future.result(timeout=2) for future in futures]

            self.assertEqual(create_calls, 1)
            self.assertTrue(all(result is service for result in results))
        finally:
            allow_return.set()
            repo_context_app._SEEDING_SERVICE = prior_service


if __name__ == "__main__":
    unittest.main()
