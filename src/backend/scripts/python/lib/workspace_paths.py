"""Per-task workspace path helpers.

All helpers read ``TASKSAIL_TASK_ID`` from the environment.

- Unset or empty → singleton legacy paths (pre-§1.8 back-compat).
- Set to a non-empty string → per-task ``tasks/<taskId>/...`` paths.
"""
from __future__ import annotations

import os
from pathlib import Path


def task_worktree_root(repo_root: Path) -> Path:
    """Return the task worktree root under ``AgentWorkSpace``.

    With ``TASKSAIL_TASK_ID`` unset: ``<repo_root>/AgentWorkSpace``
    With ``TASKSAIL_TASK_ID=t1``: ``<repo_root>/AgentWorkSpace/tasks/t1``
    """
    task_id = os.environ.get("TASKSAIL_TASK_ID", "").strip()
    if task_id:
        return repo_root / "AgentWorkSpace" / "tasks" / task_id
    return repo_root / "AgentWorkSpace"


def handoffs_dir(repo_root: Path) -> Path:
    """Return the handoffs directory for the active task."""
    return task_worktree_root(repo_root) / "handoffs"


def implementation_steps_dir(repo_root: Path) -> Path:
    """Return the ImplementationSteps directory for the active task."""
    return task_worktree_root(repo_root) / "ImplementationSteps"


def copilot_home_root(repo_root: Path) -> Path:
    """Return the Copilot home root for the active task.

    With ``TASKSAIL_TASK_ID`` unset: ``<repo_root>/.platform-state/runtime/copilot-home``
    With ``TASKSAIL_TASK_ID=t1``: ``<repo_root>/.platform-state/runtime/tasks/t1/copilot-home``
    """
    task_id = os.environ.get("TASKSAIL_TASK_ID", "").strip()
    base = repo_root / ".platform-state" / "runtime"
    if task_id:
        return base / "tasks" / task_id / "copilot-home"
    return base / "copilot-home"


def platform_runtime_root(repo_root: Path) -> Path:
    """Return the platform runtime root for the active task.

    With ``TASKSAIL_TASK_ID`` unset: ``<repo_root>/.platform-state/runtime``
    With ``TASKSAIL_TASK_ID=t1``: ``<repo_root>/.platform-state/runtime/tasks/t1``
    """
    task_id = os.environ.get("TASKSAIL_TASK_ID", "").strip()
    base = repo_root / ".platform-state" / "runtime"
    if task_id:
        return base / "tasks" / task_id
    return base


def render_handoff_artifact_label(task_id: str, filename: str) -> str:
    return f"AgentWorkSpace/tasks/{task_id}/handoffs/{filename}"


def render_implementation_steps_label(task_id: str, filename: str) -> str:
    return f"AgentWorkSpace/tasks/{task_id}/ImplementationSteps/{filename}"
