"""QMD-backed reinforcement state persistence.

All reinforcement JSON files live under
``{repo_root}/AgentWorkSpace/qmd/global/reinforcement/store/``.  Concurrent access is
serialised with file locks via :mod:`scripts.python.lib.locking`.

Storage is repo-global (not namespaced per context pack) because the task
queue is single-active — only one context pack drives the workflow at a
time.  Lifetime rewards, settlement history, and the global realignment
document intentionally span context-pack switches so that operator
feedback accumulates across estate boundaries.

Legacy QMD data (``{repo_root}/AgentWorkSpace/qmd/reinforcement/``) is
migrated on first construction when canonical data does not yet exist.
"""
from __future__ import annotations

import contextlib
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Callable

from src.backend.scripts.python.lib.io import atomic_write_json, load_json_safe
from src.backend.scripts.python.lib.locking import acquire_file_lock, release_file_lock

from .models import (
    SCHEMA_VERSION_AGENT_REWARDS,
    SCHEMA_VERSION_FEEDBACK_EVENTS,
    SCHEMA_VERSION_GLOBAL_REALIGNMENT_DOC,
    SCHEMA_VERSION_REALIGNMENT_SESSIONS,
    SCHEMA_VERSION_SETTLEMENTS,
    SCHEMA_VERSION_TASK_LEDGER,
    AgentRewardMemory,
    FeedbackEvent,
    GlobalRealignmentDocument,
    RealignmentSession,
    SettlementRecord,
    TaskLedgerEntry,
)
from .paths import (
    migrate_legacy_reinforcement_store,
    reinforcement_store_dir,
    resolve_store_file_for_read,
    store_file,
)


def _read_json_or_empty(path: Path) -> dict[str, Any]:
    """Read JSON from *path*, returning ``{}`` on missing file or bad JSON."""
    try:
        payload, _ = load_json_safe(path)
        return payload or {}
    except FileNotFoundError:
        return {}


class ReinforcementStore:
    """Read/write reinforcement state under QMD.

    Parameters
    ----------
    repo_root:
        Repository root directory.  Storage is rooted at
        ``{repo_root}/AgentWorkSpace/qmd/global/reinforcement/store/``.
    legacy_context_pack_dir:
        Deprecated and ignored. Retained for caller compatibility.
    """

    def __init__(
        self,
        repo_root: Path,
        legacy_context_pack_dir: Path | None = None,
    ) -> None:
        self._repo_root = Path(repo_root)
        self._root = reinforcement_store_dir(self._repo_root)
        migrate_legacy_reinforcement_store(self._repo_root)

    @property
    def root(self) -> Path:
        return self._root

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _locked_read_modify_write(
        self,
        path: Path,
        modifier: Callable[[dict[str, Any]], dict[str, Any]],
        read_path: Path | None = None,
    ) -> dict[str, Any]:
        """Acquire a file lock, read JSON, apply *modifier*, write back."""
        lock_path = path.with_suffix(".lock")
        fd = acquire_file_lock(lock_path)
        try:
            payload = _read_json_or_empty(read_path or path)
            updated = modifier(payload)
            atomic_write_json(path, updated)
            return updated
        finally:
            release_file_lock(fd)

    def _locked_write(
        self,
        path: Path,
        payload: dict[str, Any],
    ) -> None:
        """Acquire a file lock and write *payload* without reading first."""
        lock_path = path.with_suffix(".lock")
        fd = acquire_file_lock(lock_path)
        try:
            atomic_write_json(path, payload)
        finally:
            release_file_lock(fd)

    def _locked_read(self, path: Path, read_path: Path | None = None) -> dict[str, Any]:
        """Acquire a file lock, read JSON, return data."""
        lock_path = path.with_suffix(".lock")
        fd = acquire_file_lock(lock_path)
        try:
            return _read_json_or_empty(read_path or path)
        finally:
            release_file_lock(fd)

    @staticmethod
    def _ensure_collection(
        data: dict[str, Any],
        schema_version: str,
    ) -> dict[str, Any]:
        """Guarantee ``schema_version`` and ``entries`` keys exist."""
        data.setdefault("schema_version", schema_version)
        data.setdefault("entries", [])
        return data

    # ------------------------------------------------------------------
    # Task ledger
    # ------------------------------------------------------------------
    def _task_ledger_path(self) -> Path:
        return store_file(self._repo_root, "task-ledger.json")

    def _task_ledger_read_path(self) -> Path:
        return resolve_store_file_for_read(self._repo_root, "task-ledger.json")

    @contextlib.contextmanager
    def ledger_lock(self) -> Iterator[None]:
        """Hold the ledger file lock for the duration of the block.

        Use this when multiple ledger operations must be atomic (e.g.
        duplicate-check → append → settlement in the engine).  Inside
        the block, call the ``*_held`` variants which skip re-acquiring.
        """
        lock_path = self._task_ledger_path().with_suffix(".lock")
        fd = acquire_file_lock(lock_path)
        try:
            yield
        finally:
            release_file_lock(fd)

    # -- "held" variants: caller already holds ledger_lock -------------

    def load_task_ledger_held(self) -> list[TaskLedgerEntry]:
        """Load ledger entries — caller must already hold ``ledger_lock``."""
        data = _read_json_or_empty(self._task_ledger_read_path())
        return [
            TaskLedgerEntry.from_dict(e)
            for e in data.get("entries", [])
        ]

    def append_task_entry_held(self, entry: TaskLedgerEntry) -> None:
        """Append a ledger entry — caller must already hold ``ledger_lock``."""
        path = self._task_ledger_path()
        data = _read_json_or_empty(self._task_ledger_read_path())
        self._ensure_collection(data, SCHEMA_VERSION_TASK_LEDGER)
        data["entries"].append(entry.as_dict())
        atomic_write_json(path, data)

    def mark_tasks_rewarded_held(
        self,
        task_ids: set[str],
        settlement_id: str,
    ) -> None:
        """Mark tasks rewarded — caller must already hold ``ledger_lock``."""
        path = self._task_ledger_path()
        data = _read_json_or_empty(self._task_ledger_read_path())
        self._ensure_collection(data, SCHEMA_VERSION_TASK_LEDGER)
        for e in data["entries"]:
            if e["task_id"] in task_ids:
                e["settlement_status"] = "rewarded"
                e["settlement_id"] = settlement_id
        atomic_write_json(path, data)

    # -- Public convenience methods (acquire their own lock) -----------

    def load_task_ledger(self) -> list[TaskLedgerEntry]:
        with self.ledger_lock():
            return self.load_task_ledger_held()

    def append_task_entry(self, entry: TaskLedgerEntry) -> None:
        with self.ledger_lock():
            self.append_task_entry_held(entry)

    def mark_tasks_rewarded(
        self,
        task_ids: set[str],
        settlement_id: str,
    ) -> None:
        with self.ledger_lock():
            self.mark_tasks_rewarded_held(task_ids, settlement_id)

    # ------------------------------------------------------------------
    # Agent rewards
    # ------------------------------------------------------------------
    def _agent_rewards_path(self) -> Path:
        return store_file(self._repo_root, "agent-rewards.json")

    def _agent_rewards_read_path(self) -> Path:
        return resolve_store_file_for_read(self._repo_root, "agent-rewards.json")

    def load_agent_rewards(self) -> list[AgentRewardMemory]:
        data = self._locked_read(
            self._agent_rewards_path(),
            self._agent_rewards_read_path(),
        )
        return [
            AgentRewardMemory.from_dict(e)
            for e in data.get("entries", [])
        ]

    def update_agent_reward(self, reward: AgentRewardMemory) -> None:
        def _upsert(data: dict[str, Any]) -> dict[str, Any]:
            self._ensure_collection(data, SCHEMA_VERSION_AGENT_REWARDS)
            for i, e in enumerate(data["entries"]):
                if e["agent_id"] == reward.agent_id:
                    data["entries"][i] = reward.as_dict()
                    return data
            data["entries"].append(reward.as_dict())
            return data

        self._locked_read_modify_write(
            self._agent_rewards_path(), _upsert, self._agent_rewards_read_path(),
        )

    def bulk_update_agent_rewards(
        self,
        rewards: list[AgentRewardMemory],
    ) -> None:
        """Upsert multiple agent reward records in a single locked write."""
        by_id = {r.agent_id: r.as_dict() for r in rewards}

        def _bulk_upsert(data: dict[str, Any]) -> dict[str, Any]:
            self._ensure_collection(data, SCHEMA_VERSION_AGENT_REWARDS)
            for i, e in enumerate(data["entries"]):
                if e["agent_id"] in by_id:
                    data["entries"][i] = by_id.pop(e["agent_id"])
            for remaining in by_id.values():
                data["entries"].append(remaining)
            return data

        self._locked_read_modify_write(
            self._agent_rewards_path(),
            _bulk_upsert,
            self._agent_rewards_read_path(),
        )

    # ------------------------------------------------------------------
    # Settlements
    # ------------------------------------------------------------------
    def _settlements_path(self) -> Path:
        return store_file(self._repo_root, "settlements.json")

    def _settlements_read_path(self) -> Path:
        return resolve_store_file_for_read(self._repo_root, "settlements.json")

    def load_settlements(self) -> list[SettlementRecord]:
        data = self._locked_read(
            self._settlements_path(),
            self._settlements_read_path(),
        )
        return [
            SettlementRecord.from_dict(e)
            for e in data.get("entries", [])
        ]

    def append_settlement(self, record: SettlementRecord) -> None:
        def _append(data: dict[str, Any]) -> dict[str, Any]:
            self._ensure_collection(data, SCHEMA_VERSION_SETTLEMENTS)
            data["entries"].append(record.as_dict())
            return data

        self._locked_read_modify_write(
            self._settlements_path(), _append, self._settlements_read_path(),
        )

    # ------------------------------------------------------------------
    # Feedback events
    # ------------------------------------------------------------------
    def _feedback_path(self) -> Path:
        return store_file(self._repo_root, "feedback-events.json")

    def _feedback_read_path(self) -> Path:
        return resolve_store_file_for_read(self._repo_root, "feedback-events.json")

    def load_feedback_events(self) -> list[FeedbackEvent]:
        data = self._locked_read(
            self._feedback_path(),
            self._feedback_read_path(),
        )
        return [
            FeedbackEvent.from_dict(e)
            for e in data.get("entries", [])
        ]

    def append_feedback_event(self, event: FeedbackEvent) -> None:
        def _append(data: dict[str, Any]) -> dict[str, Any]:
            self._ensure_collection(data, SCHEMA_VERSION_FEEDBACK_EVENTS)
            data["entries"].append(event.as_dict())
            return data

        self._locked_read_modify_write(
            self._feedback_path(), _append, self._feedback_read_path(),
        )

    # ------------------------------------------------------------------
    # Realignment sessions
    # ------------------------------------------------------------------
    def _realignment_sessions_path(self) -> Path:
        return store_file(self._repo_root, "realignment", "sessions.json")

    def _realignment_sessions_read_path(self) -> Path:
        return resolve_store_file_for_read(
            self._repo_root, "realignment", "sessions.json",
        )

    def _realignment_notes_dir(self) -> Path:
        return self._root / "realignment" / "notes"

    def ensure_realignment_notes_dir_writable(self) -> Path:
        """Create and return the canonical realignment notes directory."""
        notes_dir = self._realignment_notes_dir()
        notes_dir.mkdir(parents=True, exist_ok=True)
        if not notes_dir.is_dir():
            raise NotADirectoryError(str(notes_dir))
        return notes_dir

    def load_realignment_sessions(self) -> list[RealignmentSession]:
        data = self._locked_read(
            self._realignment_sessions_path(),
            self._realignment_sessions_read_path(),
        )
        return [
            RealignmentSession.from_dict(e)
            for e in data.get("entries", [])
        ]

    def save_realignment_session(self, session: RealignmentSession) -> None:
        def _upsert(data: dict[str, Any]) -> dict[str, Any]:
            self._ensure_collection(data, SCHEMA_VERSION_REALIGNMENT_SESSIONS)
            for i, e in enumerate(data["entries"]):
                if e["realignment_id"] == session.realignment_id:
                    data["entries"][i] = session.as_dict()
                    return data
            data["entries"].append(session.as_dict())
            return data

        self._locked_read_modify_write(
            self._realignment_sessions_path(),
            _upsert,
            self._realignment_sessions_read_path(),
        )

    def save_realignment_notes(
        self,
        realignment_id: str,
        notes: str,
    ) -> Path:
        notes_dir = self._realignment_notes_dir()
        notes_dir.mkdir(parents=True, exist_ok=True)
        notes_path = notes_dir / f"{realignment_id}.md"
        notes_path.write_text(notes, encoding="utf-8")
        return notes_path

    # ------------------------------------------------------------------
    # Global Realignment Document
    # ------------------------------------------------------------------
    def _global_doc_path(self) -> Path:
        return store_file(self._repo_root, "global-realignment-doc.json")

    def _global_doc_read_path(self) -> Path:
        return resolve_store_file_for_read(
            self._repo_root, "global-realignment-doc.json",
        )

    def load_global_realignment_document(self) -> GlobalRealignmentDocument:
        data = self._locked_read(
            self._global_doc_path(),
            self._global_doc_read_path(),
        )
        if not data:
            return GlobalRealignmentDocument()
        return GlobalRealignmentDocument.from_dict(data)

    def save_global_realignment_document(
        self,
        doc: GlobalRealignmentDocument,
    ) -> None:
        payload = doc.as_dict()
        payload["schema_version"] = SCHEMA_VERSION_GLOBAL_REALIGNMENT_DOC
        self._locked_write(self._global_doc_path(), payload)
