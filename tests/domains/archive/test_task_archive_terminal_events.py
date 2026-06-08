from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path

import pytest

archive_mod = import_module("src.backend.scripts.python.file-task-archive")


def test_copy_terminal_events_snapshot_preserves_hidden_payload(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    staging_dir = tmp_path / "staging"
    task_id = "CAP-2001"
    runtime_terminal_path = (
        repo_root
        / ".platform-state"
        / "runtime"
        / "tasks"
        / task_id
        / "terminal-events.json"
    )
    terminal_payload = {
        "events": [
            {
                "eventId": "agent.artifact_check.started:ron:cleanup:launch-artifact",
                "source": "runtime.agent",
                "role": "agent",
                "severity": "info",
                "visible": False,
                "message": "Checking required agent artifacts.",
                "createdAt": "2026-06-03T00:00:00.000Z",
                "actorName": "Ron - QA (cleanup)",
                "extra": {
                    "agentId": "ron",
                    "launchId": "launch-artifact",
                    "displayPhase": "cleanup",
                },
            }
        ]
    }
    runtime_terminal_path.parent.mkdir(parents=True, exist_ok=True)
    staging_dir.mkdir(parents=True, exist_ok=True)
    runtime_terminal_path.write_text(json.dumps(terminal_payload, indent=2) + "\n", encoding="utf-8")

    copied_name = archive_mod._copy_terminal_events_snapshot_to_archive(
        repo_root,
        staging_dir,
        task_id,
    )

    assert copied_name == "terminal-events.json"
    assert json.loads((staging_dir / "terminal-events.json").read_text(encoding="utf-8")) == terminal_payload


def test_copy_terminal_events_snapshot_returns_none_when_missing(tmp_path: Path) -> None:
    staging_dir = tmp_path / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)

    copied_name = archive_mod._copy_terminal_events_snapshot_to_archive(
        tmp_path / "repo",
        staging_dir,
        "CAP-2001",
    )

    assert copied_name is None
    assert not (staging_dir / "terminal-events.json").exists()


def test_copy_terminal_events_snapshot_rejects_invalid_shape(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    staging_dir = tmp_path / "staging"
    task_id = "CAP-2001"
    runtime_terminal_path = (
        repo_root
        / ".platform-state"
        / "runtime"
        / "tasks"
        / task_id
        / "terminal-events.json"
    )
    runtime_terminal_path.parent.mkdir(parents=True, exist_ok=True)
    staging_dir.mkdir(parents=True, exist_ok=True)
    runtime_terminal_path.write_text(json.dumps({"events": {}}), encoding="utf-8")

    with pytest.raises(ValueError, match="expected object with events list"):
        archive_mod._copy_terminal_events_snapshot_to_archive(repo_root, staging_dir, task_id)

    assert not (staging_dir / "terminal-events.json").exists()
