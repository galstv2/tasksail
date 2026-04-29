"""Scoped, TTL-aware record cache for TaskArchiveService.

Thread-safe for concurrent HTTP requests. Cache mutations are protected by an
RLock and returned record lists are shallow copies.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class _ScopeEntry:
    by_type: dict[str, list[tuple[Path, dict[str, Any]]]]
    stored_at: float


class ScopedRecordCache:
    """In-process cache keyed by scope_dir with a wall-clock TTL.

    A single rglob scan populates entries for all record types in
    the scope.  Subsequent queries for different types from the same
    scope are instant cache hits.
    """

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, _ScopeEntry] = {}
        self._lock = threading.RLock()

    def get(
        self, scope_dir: Path, record_type: str
    ) -> list[tuple[Path, dict[str, Any]]] | None:
        key = str(scope_dir)
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.monotonic() - entry.stored_at > self._ttl:
                del self._store[key]
                return None
            return list(entry.by_type.get(record_type, []))

    def put_scope(
        self,
        scope_dir: Path,
        grouped: dict[str, list[tuple[Path, dict[str, Any]]]],
    ) -> None:
        with self._lock:
            self._store[str(scope_dir)] = _ScopeEntry(
                by_type={
                    record_type: list(records)
                    for record_type, records in grouped.items()
                },
                stored_at=time.monotonic(),
            )

    def merge_scope(
        self,
        scope_dir: Path,
        updates: list[tuple[Path, dict[str, Any]]],
    ) -> None:
        """Merge written records into an existing cache entry.

        If the scope is cached, overlays *updates* on top (replacing records
        with the same path, adding new ones).  If the scope is not cached,
        creates a new entry from *updates* alone.  Resets the TTL.
        """
        with self._lock:
            key = str(scope_dir)
            entry = self._store.get(key)

            all_records: dict[str, tuple[Path, dict[str, Any]]] = {}
            if entry is not None:
                for records in entry.by_type.values():
                    for path, payload in records:
                        all_records[str(path)] = (path, payload)
            for path, payload in updates:
                all_records[str(path)] = (path, payload)

            grouped: dict[str, list[tuple[Path, dict[str, Any]]]] = {}
            for path, payload in all_records.values():
                rt = payload.get("record_type")
                if rt:
                    grouped.setdefault(rt, []).append((path, payload))

            self._store[key] = _ScopeEntry(
                by_type=grouped, stored_at=time.monotonic(),
            )

    def invalidate(self, scope_dir: Path | None = None) -> None:
        with self._lock:
            if scope_dir is None:
                self._store.clear()
                return
            self._store.pop(str(scope_dir), None)
