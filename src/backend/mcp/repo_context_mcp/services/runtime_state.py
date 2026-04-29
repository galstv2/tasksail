"""In-memory runtime state for live QMD seeding.

Holds the cross-thread seed-lock and the latest run report. Extracted from
``seeding_service.py`` to keep that module under the per-file size limit;
behavior is unchanged. The class continues to be re-exported from
``seeding_service`` for existing callers and tests.
"""
from __future__ import annotations

import copy
import threading
from typing import Any

from ..models import SeedRuntimeSnapshot


class SeedRuntimeStateRegistry:
    """Track seed-run locks by scope while preserving latest-run state."""

    def __init__(
        self,
        initial_locks: dict[str, threading.Lock] | None = None,
    ) -> None:
        self._registry_lock = threading.RLock()
        self._run_locks: dict[str, threading.Lock] = dict(initial_locks or {})
        self._state_lock = threading.Lock()
        self._latest_run: dict[str, Any] | None = None

    def acquire_seed_run(self, scope_key: str) -> bool:
        lock = self._lock_for_scope(scope_key)
        return lock.acquire(blocking=False)

    def release_seed_run(self, scope_key: str) -> None:
        self._lock_for_scope(scope_key).release()

    def force_release_if_held(self, scope_key: str) -> bool:
        """Release the scope lock if currently held. Returns True if released."""
        lock = self._lock_for_scope(scope_key)
        if not lock.locked():
            return False
        try:
            lock.release()
        except RuntimeError:
            return False
        return True

    def set_latest_run(self, report: dict[str, Any]) -> None:
        frozen = copy.deepcopy(report)
        with self._state_lock:
            self._latest_run = frozen

    def snapshot(self) -> SeedRuntimeSnapshot:
        with self._state_lock:
            ref = self._latest_run
        return SeedRuntimeSnapshot(latest_run=ref)

    def _lock_for_scope(self, scope_key: str) -> threading.Lock:
        with self._registry_lock:
            return self._run_locks.setdefault(scope_key, threading.Lock())


class SeedRuntimeState:
    DEFAULT_SCOPE_KEY = "default"

    def __init__(self, lock: threading.Lock | None = None) -> None:
        initial_locks = (
            {self.DEFAULT_SCOPE_KEY: lock}
            if lock is not None
            else None
        )
        self._registry = SeedRuntimeStateRegistry(initial_locks)

    def acquire_seed_run(self, scope_key: str | None = None) -> bool:
        return self._registry.acquire_seed_run(
            scope_key or self.DEFAULT_SCOPE_KEY
        )

    def release_seed_run(self, scope_key: str | None = None) -> None:
        self._registry.release_seed_run(scope_key or self.DEFAULT_SCOPE_KEY)

    def force_release_if_held(self, scope_key: str | None = None) -> bool:
        """Release the seed lock if currently held. Returns True if released."""
        return self._registry.force_release_if_held(
            scope_key or self.DEFAULT_SCOPE_KEY
        )

    def set_latest_run(self, report: dict[str, Any]) -> None:
        self._registry.set_latest_run(report)

    def snapshot(self) -> SeedRuntimeSnapshot:
        return self._registry.snapshot()
