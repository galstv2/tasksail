"""Tests for lib.workspace_paths helpers.

Covers both singleton (TASKSAIL_TASK_ID unset) and per-task
(TASKSAIL_TASK_ID=t1) modes to enforce compatibility.
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
    cli_home_root,
    handoffs_dir,
    implementation_steps_dir,
    platform_runtime_root,
    task_worktree_root,
)

REPO = Path("/fake/repo")


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


def test_handoffs_dir_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert handoffs_dir(REPO) == REPO / "AgentWorkSpace" / "handoffs"


def test_handoffs_dir_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert handoffs_dir(REPO) == REPO / "AgentWorkSpace" / "tasks" / "t1" / "handoffs"


def test_implementation_steps_dir_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert implementation_steps_dir(REPO) == REPO / "AgentWorkSpace" / "ImplementationSteps"


def test_implementation_steps_dir_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert implementation_steps_dir(REPO) == REPO / "AgentWorkSpace" / "tasks" / "t1" / "ImplementationSteps"


def test_cli_home_root_singleton_default():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        os.environ.pop("TASKSAIL_CLI_HOME_DIR_NAME", None)
        assert cli_home_root(REPO) == REPO / ".platform-state" / "runtime" / "cli-home"


def test_cli_home_root_singleton_from_env():
    with mock.patch.dict(os.environ, {"TASKSAIL_CLI_HOME_DIR_NAME": "provider-home"}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert cli_home_root(REPO) == REPO / ".platform-state" / "runtime" / "provider-home"


def test_cli_home_root_per_task():
    with mock.patch.dict(
        os.environ,
        {"TASKSAIL_TASK_ID": "t1", "TASKSAIL_CLI_HOME_DIR_NAME": "provider-home"},
        clear=False,
    ):
        assert cli_home_root(REPO) == REPO / ".platform-state" / "runtime" / "tasks" / "t1" / "provider-home"


def test_platform_runtime_root_singleton():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TASKSAIL_TASK_ID", None)
        assert platform_runtime_root(REPO) == REPO / ".platform-state" / "runtime"


def test_platform_runtime_root_per_task():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "t1"}, clear=False):
        assert platform_runtime_root(REPO) == REPO / ".platform-state" / "runtime" / "tasks" / "t1"


def test_different_task_ids_produce_different_paths():
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "a"}, clear=False):
        path_a = handoffs_dir(REPO)
    with mock.patch.dict(os.environ, {"TASKSAIL_TASK_ID": "b"}, clear=False):
        path_b = handoffs_dir(REPO)
    assert path_a != path_b
    assert str(path_a).endswith("tasks/a/handoffs")
    assert str(path_b).endswith("tasks/b/handoffs")
