"""Task completion counter unit tests."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SCRIPTS_PYTHON = REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PYTHON))

from lib.counters.task_completion_counter import (
    RETROSPECTIVE_CYCLE_LENGTH,
    TaskCompletionCounter,
)


def test_nine_increments_requires_retrospective(tmp_path: Path) -> None:
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    for i in range(1, 10):
        counter.increment(f"TASK-{i}")
    assert counter.completed_count() == 9
    assert counter.cycle_position() == 10
    assert counter.is_retrospective_required() is True


def test_tenth_increment_resets_counter(tmp_path: Path) -> None:
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    for i in range(1, 10):
        counter.increment(f"TASK-{i}")
    state = counter.increment("TASK-10")
    assert state["completed_count"] == 0
    assert state["cycle_count"] == 1
    assert counter.cycle_position() == 1
    assert counter.is_retrospective_required() is False


def test_corrupt_state_above_cycle_length_does_not_keep_requirement_stuck_true(tmp_path: Path) -> None:
    counter_dir = tmp_path / ".platform-state" / "task-counters"
    counter_dir.mkdir(parents=True)
    counter_file = counter_dir / "test-pack.json"
    counter_file.write_text(
        json.dumps({
            "schema_version": "task-counter/v1",
            "context_pack_id": "test-pack",
            "completed_count": 10,
            "cycle_count": 1,
        }),
        encoding="utf-8",
    )
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    assert counter.cycle_position() == 11
    assert counter.is_retrospective_required() is False


def test_cycle_task_ids_preserved_after_reset(tmp_path: Path) -> None:
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    for i in range(1, 11):
        state = counter.increment(f"TASK-{i}")
    assert len(state["cycle_task_ids"]) == 10
    assert state["cycle_task_ids"][0] == "TASK-1"
    assert state["cycle_task_ids"][-1] == "TASK-10"


def test_cycle_task_ids_capped_at_10(tmp_path: Path) -> None:
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    for i in range(1, 13):
        state = counter.increment(f"TASK-{i}")
    assert len(state["cycle_task_ids"]) <= RETROSPECTIVE_CYCLE_LENGTH


def test_claimed_retrospective_winner_is_not_counted_again_after_loser_closeout(tmp_path: Path) -> None:
    counter_dir = tmp_path / ".platform-state" / "task-counters"
    counter_dir.mkdir(parents=True)
    counter_file = counter_dir / "test-pack.json"
    counter_file.write_text(
        json.dumps({
            "schema_version": "task-counter/v1",
            "context_pack_id": "test-pack",
            "completed_count": 1,
            "cycle_count": 1,
            "last_archived_task_id": "TASK-11",
            "last_archived_at": "2026-01-11T00:00:00.000Z",
            "last_retrospective_at": "2026-01-10T00:00:00.000Z",
            "last_retrospective_task_id": "TASK-10",
            "cycle_task_ids": ["TASK-10", "TASK-11"],
        }),
        encoding="utf-8",
    )

    counter = TaskCompletionCounter(tmp_path, "test-pack")
    state = counter.increment("TASK-10")

    assert state["completed_count"] == 1
    assert state["cycle_count"] == 1
    assert state["last_archived_task_id"] == "TASK-11"
    assert state["last_retrospective_task_id"] == "TASK-10"
    assert state["cycle_task_ids"] == ["TASK-10", "TASK-11"]


def test_corrupted_file_returns_empty_state(tmp_path: Path) -> None:
    counter_dir = tmp_path / ".platform-state" / "task-counters"
    counter_dir.mkdir(parents=True)
    counter_file = counter_dir / "test-pack.json"
    counter_file.write_text("not valid json", encoding="utf-8")
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    assert counter.completed_count() == 0
    assert counter.cycle_position() == 1


def test_from_context_pack_dir_uses_dir_name(tmp_path: Path) -> None:
    pack_dir = tmp_path / "my-context-pack"
    pack_dir.mkdir()
    counter = TaskCompletionCounter.from_context_pack_dir(tmp_path, pack_dir)
    counter.increment("T-1")
    state = counter.read()
    assert state["context_pack_id"] == "my-context-pack"


def test_multiple_full_cycles(tmp_path: Path) -> None:
    counter = TaskCompletionCounter(tmp_path, "test-pack")
    for cycle in range(3):
        for i in range(1, 11):
            state = counter.increment(f"C{cycle}-TASK-{i}")
    assert state["cycle_count"] == 3
    assert state["completed_count"] == 0
