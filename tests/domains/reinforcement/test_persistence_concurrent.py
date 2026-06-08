"""Multiprocess concurrent-writer tests for ReinforcementStore.

Gated behind RUN_SLOW_TESTS per repo testing conventions.  Uses
``multiprocessing.Process`` to fan out N workers against the same store
root — no real sockets (satisfies tests/conftest.py bind guard).
"""
from __future__ import annotations

import multiprocessing
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_SLOW_TESTS"),
    reason="Set RUN_SLOW_TESTS=1 to run concurrent-writer tests",
)
pytestmark = [
    pytestmark,
    pytest.mark.skipif(
        not os.environ.get("TASKSAIL_AGENT_REGISTRY_PATH", "").strip(),
        reason=(
            "TASKSAIL_AGENT_REGISTRY_PATH is not set; skipping reinforcement "
            "tests that require the active CLI provider agent registry."
        ),
    ),
]

# Ensure repo root is importable from worker processes.
_REPO_ROOT = Path(__file__).resolve().parents[3]


# Worker functions (must be importable at module level for multiprocessing)

def _worker_append_task_entry(repo_root_str: str, task_id: str) -> None:
    """Worker: appends a single TaskLedgerEntry to the store."""
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    from src.backend.mcp.reinforcement.models import TaskLedgerEntry
    from src.backend.mcp.reinforcement.persistence import ReinforcementStore

    store = ReinforcementStore(Path(repo_root_str))
    entry = TaskLedgerEntry(
        task_id=task_id,
        parent_task_id="",
        is_child=False,
        difficulty="medium",
        base_reward=1000,
        effective_reward=1000,
        settlement_status="unrewarded",
        quality_outcome="success",
        feedback_id="",
        settlement_id="",
        realignment_id="",
        created_at="2026-01-01T00:00:00Z",
    )
    store.append_task_entry(entry)


def _worker_update_agent_reward(repo_root_str: str, agent_id: str, reward: int) -> None:
    """Worker: upserts an AgentRewardMemory entry in the store."""
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    from src.backend.mcp.reinforcement.models import AgentRewardMemory
    from src.backend.mcp.reinforcement.persistence import ReinforcementStore

    store = ReinforcementStore(Path(repo_root_str))
    mem = AgentRewardMemory(
        agent_id=agent_id,
        role="Software Engineer",
        multiplier=1.0,
        lifetime_reward=reward,
        unrewarded_task_count=1,
        unrewarded_reward_total=reward,
    )
    store.update_agent_reward(mem)


def _worker_append_settlement(repo_root_str: str, settlement_id: str) -> None:
    """Worker: appends a SettlementRecord to the store."""
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    from src.backend.mcp.reinforcement.models import SettlementRecord
    from src.backend.mcp.reinforcement.persistence import ReinforcementStore

    store = ReinforcementStore(Path(repo_root_str))
    record = SettlementRecord(
        settlement_id=settlement_id,
        trigger="streak",
        tasks_included=["T-concurrent"],
        per_agent_rewards={"software-engineer": 500},
        settled_at="2026-01-01T00:00:00Z",
    )
    store.append_settlement(record)


def _run_workers(
    target,
    args_list: list[tuple],
    *,
    timeout: float = 30.0,
) -> list[str]:
    """Spawn workers, join within timeout, return list of error strings."""
    processes = [
        multiprocessing.Process(target=target, args=args)
        for args in args_list
    ]
    for p in processes:
        p.start()
    errors: list[str] = []
    for p in processes:
        p.join(timeout=timeout)
        if p.is_alive():
            p.terminate()
            p.join()
            errors.append(f"Worker pid={p.pid} timed out after {timeout}s")
        elif p.exitcode != 0:
            errors.append(f"Worker pid={p.pid} exited with code {p.exitcode}")
    return errors


class TestPersistenceConcurrent:
    """Concurrent multiprocess writers against a shared ReinforcementStore."""

    def test_concurrent_append_task_entries_all_persist(
        self, tmp_path: Path,
    ) -> None:
        """N workers each append a distinct task entry; all N must appear."""
        n = 8
        task_ids = [f"T-CONC-{i:03d}" for i in range(n)]
        errors = _run_workers(
            _worker_append_task_entry,
            [(str(tmp_path), tid) for tid in task_ids],
        )
        assert not errors, f"Worker failures: {errors}"

        if str(_REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(_REPO_ROOT))
        from src.backend.mcp.reinforcement.persistence import ReinforcementStore

        store = ReinforcementStore(tmp_path)
        ledger = store.load_task_ledger()
        found_ids = {e.task_id for e in ledger}
        missing = set(task_ids) - found_ids
        assert not missing, f"Missing task entries after concurrent writes: {missing}"

    def test_concurrent_update_agent_rewards_all_persist(
        self, tmp_path: Path,
    ) -> None:
        """N workers each upsert a distinct agent reward; all N must appear."""
        n = 6
        agent_ids = [f"agent-conc-{i:03d}" for i in range(n)]
        errors = _run_workers(
            _worker_update_agent_reward,
            [(str(tmp_path), aid, (i + 1) * 100) for i, aid in enumerate(agent_ids)],
        )
        assert not errors, f"Worker failures: {errors}"

        if str(_REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(_REPO_ROOT))
        from src.backend.mcp.reinforcement.persistence import ReinforcementStore

        store = ReinforcementStore(tmp_path)
        rewards = store.load_agent_rewards()
        found_ids = {r.agent_id for r in rewards}
        missing = set(agent_ids) - found_ids
        assert not missing, f"Missing agent rewards after concurrent writes: {missing}"

    def test_concurrent_append_settlements_all_persist(
        self, tmp_path: Path,
    ) -> None:
        """N workers each append a distinct settlement; all N must appear."""
        n = 6
        settlement_ids = [f"S-CONC-{i:03d}" for i in range(n)]
        errors = _run_workers(
            _worker_append_settlement,
            [(str(tmp_path), sid) for sid in settlement_ids],
        )
        assert not errors, f"Worker failures: {errors}"

        if str(_REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(_REPO_ROOT))
        from src.backend.mcp.reinforcement.persistence import ReinforcementStore

        store = ReinforcementStore(tmp_path)
        settlements = store.load_settlements()
        found_ids = {s.settlement_id for s in settlements}
        missing = set(settlement_ids) - found_ids
        assert not missing, f"Missing settlements after concurrent writes: {missing}"

    def test_mixed_concurrent_writers_all_persist(
        self, tmp_path: Path,
    ) -> None:
        """Mix of task-entry, agent-reward, and settlement writers — all persist."""
        task_ids = [f"T-MIX-{i:02d}" for i in range(4)]
        agent_ids = [f"agent-mix-{i:02d}" for i in range(3)]
        settlement_ids = [f"S-MIX-{i:02d}" for i in range(3)]

        processes: list[multiprocessing.Process] = []
        for tid in task_ids:
            processes.append(
                multiprocessing.Process(
                    target=_worker_append_task_entry,
                    args=(str(tmp_path), tid),
                )
            )
        for i, aid in enumerate(agent_ids):
            processes.append(
                multiprocessing.Process(
                    target=_worker_update_agent_reward,
                    args=(str(tmp_path), aid, (i + 1) * 250),
                )
            )
        for sid in settlement_ids:
            processes.append(
                multiprocessing.Process(
                    target=_worker_append_settlement,
                    args=(str(tmp_path), sid),
                )
            )

        for p in processes:
            p.start()
        errors: list[str] = []
        for p in processes:
            p.join(timeout=30.0)
            if p.is_alive():
                p.terminate()
                p.join()
                errors.append(f"Worker pid={p.pid} timed out")
            elif p.exitcode != 0:
                errors.append(f"Worker pid={p.pid} exited {p.exitcode}")
        assert not errors, f"Worker failures: {errors}"

        if str(_REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(_REPO_ROOT))
        from src.backend.mcp.reinforcement.persistence import ReinforcementStore

        store = ReinforcementStore(tmp_path)
        ledger_ids = {e.task_id for e in store.load_task_ledger()}
        reward_ids = {r.agent_id for r in store.load_agent_rewards()}
        settlement_found = {s.settlement_id for s in store.load_settlements()}

        assert not (set(task_ids) - ledger_ids), "Missing task entries in mixed run"
        assert not (set(agent_ids) - reward_ids), "Missing agent rewards in mixed run"
        assert not (set(settlement_ids) - settlement_found), "Missing settlements in mixed run"
