"""Tests for lib.workspace_paths helpers.

Covers both singleton (TASKSAIL_TASK_ID unset) and per-task
(TASKSAIL_TASK_ID=t1) modes to enforce back-compat and §1.6 parameterization.
"""
from __future__ import annotations

import os

# Ensure the lib package is importable from this test.
import sys
from pathlib import Path
from unittest import mock

_SCRIPTS_PYTHON = Path(__file__).resolve().parents[3] / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.workspace_paths import (
    copilot_home_root,
    handoffs_dir,
    implementation_steps_dir,
    platform_runtime_root,
    task_worktree_root,
)

REPO = Path("/fake/repo")


# ---------------------------------------------------------------------------
# task_worktree_root
# ---------------------------------------------------------------------------

def test_task_worktree_root_singleton_when_unset():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert task_worktree_root(REPO) == REPO / "AgentWorkSpace"


def test_task_worktree_root_singleton_when_empty():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "  "}, clear=False):
        assert task_worktree_root(REPO) == REPO / "AgentWorkSpace"


def test_task_worktree_root_per_task_when_set():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert task_worktree_root(REPO) == REPO / "AgentWorkSpace" / "tasks" / "t1"


# ---------------------------------------------------------------------------
# handoffs_dir
# ---------------------------------------------------------------------------

def test_handoffs_dir_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert handoffs_dir(REPO) == REPO / "AgentWorkSpace" / "handoffs"


def test_handoffs_dir_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert handoffs_dir(REPO) == REPO / "AgentWorkSpace" / "tasks" / "t1" / "handoffs"


# ---------------------------------------------------------------------------
# implementation_steps_dir
# ---------------------------------------------------------------------------

def test_implementation_steps_dir_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert implementation_steps_dir(REPO) == REPO / "AgentWorkSpace" / "ImplementationSteps"


def test_implementation_steps_dir_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert implementation_steps_dir(REPO) == REPO / "AgentWorkSpace" / "tasks" / "t1" / "ImplementationSteps"


# ---------------------------------------------------------------------------
# copilot_home_root
# ---------------------------------------------------------------------------

def test_copilot_home_root_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert copilot_home_root(REPO) == REPO / ".platform-state" / "runtime" / "copilot-home"


def test_copilot_home_root_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert copilot_home_root(REPO) == REPO / ".platform-state" / "runtime" / "tasks" / "t1" / "copilot-home"


# ---------------------------------------------------------------------------
# platform_runtime_root
# ---------------------------------------------------------------------------

def test_platform_runtime_root_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert platform_runtime_root(REPO) == REPO / ".platform-state" / "runtime"


def test_platform_runtime_root_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert platform_runtime_root(REPO) == REPO / ".platform-state" / "runtime" / "tasks" / "t1"


# ---------------------------------------------------------------------------
# Different task IDs produce different paths (isolation guarantee)
# ---------------------------------------------------------------------------

def test_different_task_ids_produce_different_paths():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "a"}, clear=False):
        path_a = handoffs_dir(REPO)
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "b"}, clear=False):
        path_b = handoffs_dir(REPO)
    assert path_a != path_b
    assert str(path_a).endswith("tasks/a/handoffs")
    assert str(path_b).endswith("tasks/b/handoffs")
