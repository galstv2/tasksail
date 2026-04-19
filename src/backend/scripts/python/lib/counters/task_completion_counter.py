"""Per-context-pack task completion counter for retrospective cycling."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..io import load_json_safe
from ..locking import acquire_file_lock, release_file_lock
from ..time import current_utc_timestamp

TASK_COUNTER_DIR_RELATIVE = ".platform-state/task-counters"
RETROSPECTIVE_CYCLE_LENGTH = 10
DEFAULT_CONTEXT_PACK_ID = "platform-core"
SCHEMA_VERSION = "task-counter/v1"


def _empty_state(context_pack_id: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "context_pack_id": context_pack_id,
        "completed_count": 0,
        "cycle_count": 0,
        "last_archived_task_id": "",
        "last_archived_at": "",
        "last_retrospective_at": "",
        "cycle_task_ids": [],
    }


class TaskCompletionCounter:
    """Manages a per-context-pack task completion counter."""

    CYCLE_LENGTH = RETROSPECTIVE_CYCLE_LENGTH

    def __init__(self, root_dir: Path, context_pack_id: str) -> None:
        self._root_dir = root_dir.resolve()
        self._context_pack_id = context_pack_id or DEFAULT_CONTEXT_PACK_ID
        self._counter_dir = self._root_dir / TASK_COUNTER_DIR_RELATIVE
        self._counter_path = self._counter_dir / f"{self._context_pack_id}.json"

    @classmethod
    def from_context_pack_dir(
        cls,
        root_dir: Path,
        context_pack_dir: Path | None,
    ) -> TaskCompletionCounter:
        if context_pack_dir and context_pack_dir.name:
            pack_id = context_pack_dir.name
        else:
            pack_id = DEFAULT_CONTEXT_PACK_ID
        return cls(root_dir, pack_id)

    def read(self) -> dict[str, Any]:
        try:
            data, error = load_json_safe(self._counter_path)
        except FileNotFoundError:
            return _empty_state(self._context_pack_id)
        if error or data is None:
            return _empty_state(self._context_pack_id)
        if not isinstance(data.get("completed_count"), int):
            return _empty_state(self._context_pack_id)
        return data

    def completed_count(self) -> int:
        return int(self.read().get("completed_count", 0))

    def cycle_position(self) -> int:
        """Return the 1-based position of the next task (completed_count + 1)."""
        return self.completed_count() + 1

    def is_retrospective_required(self) -> bool:
        return self.cycle_position() % self.CYCLE_LENGTH == 0

    def increment(self, task_id: str) -> dict[str, Any]:
        """Atomically increment the counter and reset at cycle boundary.

        Cycle-wrap guard: if ``completed_count`` is already 0 and
        ``task_id`` matches ``last_archived_task_id`` the task is being
        re-archived after a prior cycle wrap that already captured it.
        In that case the write is skipped to prevent a spurious second
        wrap (and a double retrospective trigger) on retry.
        """
        import json

        self._counter_dir.mkdir(parents=True, exist_ok=True)
        lock_path = self._counter_path.with_suffix(".lock")
        lock_fd = acquire_file_lock(lock_path)
        try:
            state = self.read()
            completed_count = int(state.get("completed_count", 0))
            last_archived_task_id = str(state.get("last_archived_task_id", ""))

            # Cycle-wrap guard: a previous increment for this task_id already
            # wrapped the cycle (completed_count reset to 0).  Re-incrementing
            # would incorrectly advance the counter a second time.
            if completed_count == 0 and task_id == last_archived_task_id:
                return state

            state["completed_count"] = completed_count + 1
            state["last_archived_task_id"] = task_id
            state["last_archived_at"] = current_utc_timestamp()

            cycle_task_ids = list(state.get("cycle_task_ids") or [])
            cycle_task_ids.append(task_id)
            if len(cycle_task_ids) > self.CYCLE_LENGTH:
                cycle_task_ids = cycle_task_ids[-self.CYCLE_LENGTH :]
            state["cycle_task_ids"] = cycle_task_ids

            if state["completed_count"] >= self.CYCLE_LENGTH:
                state["completed_count"] = 0
                state["cycle_count"] = int(state.get("cycle_count", 0)) + 1
                state["last_retrospective_at"] = current_utc_timestamp()

            state["schema_version"] = SCHEMA_VERSION
            state["context_pack_id"] = self._context_pack_id

            self._counter_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self._counter_path.with_suffix(".tmp")
            tmp_path.write_text(
                json.dumps(state, indent=2, sort_keys=False) + "\n",
                encoding="utf-8",
            )
            tmp_path.rename(self._counter_path)
            return state
        finally:
            release_file_lock(lock_fd)
