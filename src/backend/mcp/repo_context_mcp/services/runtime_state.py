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


class SeedRuntimeState:
    def __init__(self, lock: threading.Lock | None = None) -> None:
        self._run_lock = lock or threading.Lock()
        self._state_lock = threading.Lock()
        self._latest_run: dict[str, Any] | None = None

    def acquire_seed_run(self) -> bool:
        return self._run_lock.acquire(blocking=False)

    def release_seed_run(self) -> None:
        self._run_lock.release()

    def force_release_if_held(self) -> bool:
        """Release the seed lock if currently held. Returns True if released."""
        if not self._run_lock.locked():
            return False
        try:
            self._run_lock.release()
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
