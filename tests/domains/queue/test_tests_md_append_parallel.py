"""Regression guard: parallel Dalton writes with per-task locks are independent.

Spawns two subprocesses with TASKSAIL_TASK_ID=a and TASKSAIL_TASK_ID=b.
Each appends its own section to its per-task tests.md.
Asserts:
  1. Both writes land in their respective per-task handoffs/tests.md files.
  2. Neither write appears in the other task's file (no cross-contamination).
  3. Each task's lock file is co-located with its tests.md (per-task handoffs dir).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

# Ensure lib is importable from this test module.
_SCRIPTS_PYTHON = Path(__file__).resolve().parents[3] / "src" / "backend" / "scripts" / "python"


_APPEND_SCRIPT = textwrap.dedent("""
import sys
import os
from pathlib import Path

scripts_python = Path({scripts_python!r})
if str(scripts_python) not in sys.path:
    sys.path.insert(0, str(scripts_python))

from lib.role_agent.tests_md_append import append_tests_md_section

root_dir = Path({root_dir!r})
instance_id = {instance_id!r}
slice_id = {slice_id!r}

# Ensure tests.md parent dir exists (normally created by workspace setup).
from lib.workspace_paths import handoffs_dir
handoffs_dir(root_dir).mkdir(parents=True, exist_ok=True)

result = append_tests_md_section(
    root_dir=root_dir,
    instance_id=instance_id,
    slice_id=slice_id,
    slice_path=f"ImplementationSteps/{{slice_id}}",
    content=f"Test content for {{instance_id}}",
)
print("written" if result else "skipped")
""")


def _spawn_append(root_dir: Path, task_id: str, instance_id: str, slice_id: str) -> subprocess.Popen:
    """Start a subprocess that appends a tests.md section for the given task."""
    env = {**os.environ, "TASKSAIL_TASK_ID": task_id}
    script = _APPEND_SCRIPT.format(
        scripts_python=str(_SCRIPTS_PYTHON),
        root_dir=str(root_dir),
        instance_id=instance_id,
        slice_id=slice_id,
    )
    return subprocess.Popen(
        [sys.executable, "-c", script],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_parallel_writes_land_in_separate_task_files():
    """Both subprocesses complete without error and each write lands in its own tests.md."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)

        proc_a = _spawn_append(root, "a", "dalton-a", "slice-1")
        proc_b = _spawn_append(root, "b", "dalton-b", "slice-1")

        out_a, err_a = proc_a.communicate(timeout=30)
        out_b, err_b = proc_b.communicate(timeout=30)

        assert proc_a.returncode == 0, f"Task-a subprocess failed: {err_a.decode()}"
        assert proc_b.returncode == 0, f"Task-b subprocess failed: {err_b.decode()}"
        assert out_a.decode().strip() == "written", f"Task-a did not write: {out_a.decode()}"
        assert out_b.decode().strip() == "written", f"Task-b did not write: {out_b.decode()}"

        tests_md_a = root / "AgentWorkSpace" / "tasks" / "a" / "handoffs" / "tests.md"
        tests_md_b = root / "AgentWorkSpace" / "tasks" / "b" / "handoffs" / "tests.md"

        assert tests_md_a.exists(), "tests.md for task a not created"
        assert tests_md_b.exists(), "tests.md for task b not created"

        content_a = tests_md_a.read_text(encoding="utf-8")
        content_b = tests_md_b.read_text(encoding="utf-8")

        assert "dalton-a" in content_a, "Task-a content missing from task-a tests.md"
        assert "dalton-b" in content_b, "Task-b content missing from task-b tests.md"

        # No cross-contamination.
        assert "dalton-b" not in content_a, "Task-b content bled into task-a tests.md"
        assert "dalton-a" not in content_b, "Task-a content bled into task-b tests.md"


def test_lock_files_are_co_located_with_tests_md():
    """Each task's lock file lives in the same per-task handoffs dir as tests.md."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)

        proc_a = _spawn_append(root, "a", "inst-a", "slice-2")
        proc_b = _spawn_append(root, "b", "inst-b", "slice-2")

        proc_a.communicate(timeout=30)
        proc_b.communicate(timeout=30)

        lock_a = root / "AgentWorkSpace" / "tasks" / "a" / "handoffs" / "tests.md.lock"
        lock_b = root / "AgentWorkSpace" / "tasks" / "b" / "handoffs" / "tests.md.lock"

        assert lock_a.exists(), f"Per-task lock for task a missing at {lock_a}"
        assert lock_b.exists(), f"Per-task lock for task b missing at {lock_b}"

        # Confirm the singleton path is NOT used.
        singleton_lock = root / ".platform-state" / "runtime" / "parallel" / "tests-md.lock"
        assert not singleton_lock.exists(), (
            f"Singleton lock path still created at {singleton_lock} — "
            "per-task lock migration incomplete"
        )


def test_concurrent_writes_both_complete():
    """Both subprocesses hold independent locks and both writes succeed simultaneously."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)

        # Launch both before waiting for either — true concurrency.
        proc_a = _spawn_append(root, "a", "concurrent-a", "slice-3")
        proc_b = _spawn_append(root, "b", "concurrent-b", "slice-3")

        out_a, err_a = proc_a.communicate(timeout=30)
        out_b, err_b = proc_b.communicate(timeout=30)

        assert proc_a.returncode == 0, f"Concurrent task-a failed: {err_a.decode()}"
        assert proc_b.returncode == 0, f"Concurrent task-b failed: {err_b.decode()}"
        assert out_a.decode().strip() == "written"
        assert out_b.decode().strip() == "written"
