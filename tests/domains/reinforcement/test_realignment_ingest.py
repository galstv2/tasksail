"""Tests for the standalone realignment ingest CLI."""
from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.fairness import FairnessManager
from src.backend.mcp.reinforcement.models import GlobalRealignmentDocument
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager

SCRIPT_PATH = (
    Path(__file__).resolve().parents[3]
    / "src"
    / "backend"
    / "scripts"
    / "python"
    / "realignment-ingest.py"
)


@pytest.fixture()
def ingest_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("realignment_ingest", SCRIPT_PATH)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def context_pack_dir(tmp_path: Path) -> Path:
    path = tmp_path / "context-pack"
    path.mkdir()
    return path


def _store(tmp_path: Path) -> ReinforcementStore:
    return ReinforcementStore(tmp_path)


def _session(tmp_path: Path) -> str:
    manager = RealignmentManager(_store(tmp_path))
    session = manager.start_session(
        "TASK-1",
        "FB-1",
        ["software-engineer", "qa"],
    )
    return session.realignment_id


def _payload(actions: list[str] | None = None) -> dict[str, object]:
    return {
        "failure_analysis": "The workflow missed an edge case.",
        "root_cause": "Validation did not cover rerun state.",
        "corrective_actions": actions or ["Add rerun-state validation."],
        "validation_notes": "Focused checks passed.",
        "meeting_notes": "Keep guidance reusable.",
    }


def _run_stdin(
    ingest_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    context_pack_dir: Path,
    realignment_id: str,
    payload: dict[str, object],
) -> int:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(payload)))
    return ingest_module.main([
        "--repo-root",
        str(tmp_path),
        "--context-pack-dir",
        str(context_pack_dir),
        "--realignment-id",
        realignment_id,
        "--stdin",
    ])


def test_success_ingests_promotes_compacts_and_archives(
    ingest_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    context_pack_dir: Path,
) -> None:
    realignment_id = _session(tmp_path)
    fairness = FairnessManager(_store(tmp_path))
    fairness.update_global_document({
        "lessons_learned": [f"old lesson {i}" for i in range(30)],
        "behavioral_guidance": [f"old guidance {i}" for i in range(30)],
    })

    exit_code = _run_stdin(
        ingest_module,
        monkeypatch,
        tmp_path,
        context_pack_dir,
        realignment_id,
        _payload(),
    )

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "archived"
    assert output["realignment_id"] == realignment_id
    assert output["global_realignment_version"] == 2
    notes_path = Path(output["notes_path"])
    assert notes_path.exists()
    assert "AgentWorkSpace/qmd/global/reinforcement/store/realignment/notes" in str(
        notes_path,
    )
    assert "Validation Notes: Focused checks passed." in notes_path.read_text()

    doc = _store(tmp_path).load_global_realignment_document()
    assert doc.version == 2
    assert len(doc.lessons_learned) == 25
    assert len(doc.behavioral_guidance) == 25
    assert doc.lessons_learned[-1] == "Add rerun-state validation."
    assert doc.behavioral_guidance[-1] == (
        "Avoid: Validation did not cover rerun state."
    )


def test_invalid_payload_is_pre_promotion_and_mark_error_compatible(
    ingest_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    context_pack_dir: Path,
) -> None:
    realignment_id = _session(tmp_path)
    store = _store(tmp_path)
    store.save_global_realignment_document(GlobalRealignmentDocument(
        lessons_learned=["unchanged"],
        version=4,
        updated_at="2026-01-01T00:00:00Z",
    ))

    exit_code = _run_stdin(
        ingest_module,
        monkeypatch,
        tmp_path,
        context_pack_dir,
        realignment_id,
        {**_payload(), "corrective_actions": "not-a-list"},
    )

    assert exit_code == 1
    assert "corrective_actions" in capsys.readouterr().err
    doc = _store(tmp_path).load_global_realignment_document()
    assert doc.version == 4
    assert doc.lessons_learned == ["unchanged"]
    assert _store(tmp_path).load_realignment_sessions()[0].status == "open"

    mark_exit = ingest_module.main([
        "--repo-root",
        str(tmp_path),
        "--context-pack-dir",
        str(context_pack_dir),
        "--realignment-id",
        realignment_id,
        "--mark-error",
        "--reason",
        "analysis failed",
    ])
    assert mark_exit == 0
    session = _store(tmp_path).load_realignment_sessions()[0]
    assert session.status == "error"
    assert "analysis failed" in session.meeting_notes


def test_post_promotion_archive_failure_reports_partial_without_repromotion(
    ingest_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    context_pack_dir: Path,
) -> None:
    realignment_id = _session(tmp_path)

    def fail_archive(self: RealignmentManager, session: object) -> dict[str, object]:
        raise RuntimeError("notes write failed")

    monkeypatch.setattr(
        RealignmentManager,
        "archive_reviewed_session",
        fail_archive,
    )
    exit_code = _run_stdin(
        ingest_module,
        monkeypatch,
        tmp_path,
        context_pack_dir,
        realignment_id,
        _payload(["Promote once."]),
    )

    assert exit_code == 1
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "partial"
    assert output["reason"] == "promotion_committed_archive_failed"
    assert output["global_realignment_version"] == 1
    doc = _store(tmp_path).load_global_realignment_document()
    assert doc.version == 1
    assert doc.lessons_learned == ["Promote once."]
    assert _store(tmp_path).load_realignment_sessions()[0].status == "reviewed"


def test_archive_reviewed_recovers_partial_without_repromotion(
    ingest_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    context_pack_dir: Path,
) -> None:
    realignment_id = _session(tmp_path)
    _run_stdin(
        ingest_module,
        monkeypatch,
        tmp_path,
        context_pack_dir,
        realignment_id,
        _payload(["Promote once."]),
    )
    manager = RealignmentManager(_store(tmp_path))
    manager.update_session(realignment_id, {"status": "reviewed"})
    capsys.readouterr()

    exit_code = ingest_module.main([
        "--repo-root",
        str(tmp_path),
        "--context-pack-dir",
        str(context_pack_dir),
        "--realignment-id",
        realignment_id,
        "--archive-reviewed",
    ])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "archived"
    assert output["global_realignment_version"] == 1
    doc = _store(tmp_path).load_global_realignment_document()
    assert doc.version == 1
    assert doc.lessons_learned == ["Promote once."]
    assert _store(tmp_path).load_realignment_sessions()[0].status == "archived"


def test_mark_error_rejects_non_analyzable_session(
    ingest_module: ModuleType,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    context_pack_dir: Path,
) -> None:
    realignment_id = _session(tmp_path)
    manager = RealignmentManager(_store(tmp_path))
    manager.update_session(realignment_id, {"status": "archived"})

    with pytest.raises(SystemExit) as exc_info:
        ingest_module.main([
            "--repo-root",
            str(tmp_path),
            "--context-pack-dir",
            str(context_pack_dir),
            "--realignment-id",
            realignment_id,
            "--mark-error",
            "--reason",
            "cannot rerun",
        ])

    assert exc_info.value.code == 3
    logged = json.loads(capsys.readouterr().err)
    assert logged["msg"] == "realignment.ingest.session_not_analyzable"
    assert logged["extra"]["realignment_id"] == realignment_id
