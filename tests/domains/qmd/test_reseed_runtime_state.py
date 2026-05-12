from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pytest  # noqa: E402

from src.backend.mcp.repo_context_mcp.models import RepoSeedResult  # noqa: E402
from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path  # noqa: E402
from src.backend.mcp.repo_context_mcp.services.marker import (  # noqa: E402
    RESEED_MARKER_FILENAME,
    update_pack_seed_state,
    update_pack_seed_state_failure,
)
from src.backend.mcp.repo_context_mcp.services.seeding_service import SeedingService  # noqa: E402


def _write_context_pack(context_pack_dir: Path) -> Path:
    scope_dir = context_pack_dir / "qmd" / "scope"
    scope_dir.mkdir(parents=True)
    (context_pack_dir / "qmd" / "repo-sources.json").write_text(
        json.dumps({
            "context_pack_id": "orders-estate",
            "qmd_scope_root": "qmd/scope",
            "repositories": [{"repo_id": "orders-api", "repo_name": "Orders API"}],
        }),
        encoding="utf-8",
    )
    return scope_dir


def _service(workspace_root: Path) -> SeedingService:
    return SeedingService(
        workspace_root=workspace_root,
        default_manifest="qmd/repo-sources.json",
        default_plan_file="qmd/bootstrap/seed-plan.json",
        normalize_repo_entry=lambda _root, repo, _scope: repo,
        detect_source_ref=lambda _path: "",
        iter_scan_files=lambda _roots: ([], []),
        relative_source_path=lambda _root, path: str(path),
        detect_artifact_type=lambda _path: "source",
        record_storage_path=lambda scope, _repo, _kind, record_id: scope / f"{record_id}.json",
        sidecar_record_path=lambda path: path,
        state_file_path=lambda scope, name: scope / name,
        report_file_path=lambda scope, indexed_at: scope / f"context-pack-seed-report-{indexed_at}.json",
        write_json=lambda path, payload: path.write_text(json.dumps(payload), encoding="utf-8"),
        write_text=lambda path, text: path.write_text(text, encoding="utf-8"),
        invalidate_record=lambda **_: None,
        create_artifact_record=lambda **_: {},
        create_summary_record=lambda **_: {},
        create_bootstrap_note_record=lambda **_: {},
        build_repo_summary_markdown=lambda **_: "",
        build_bootstrap_note_markdown=lambda **_: "",
        build_context_pack_conventions_markdown=lambda **_: "",
        create_context_pack_conventions_record=lambda **_: {},
    )


def _plan() -> dict[str, Any]:
    return {
        "context_pack_id": "orders-estate",
        "qmd_scope_root": "qmd/scope",
        "repositories": [{"repo_id": "orders-api", "repo_name": "Orders API"}],
    }


def _stub_seed_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.backend.mcp.repo_context_mcp.services.seeding_service.maybe_write_context_pack_conventions",
        lambda *_args, **_kwargs: {"status": "deferred"},
    )
    monkeypatch.setattr(
        "src.backend.mcp.repo_context_mcp.services.seeding_service.write_scope_indexes",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        "src.backend.mcp.repo_context_mcp.services.seeding_service.analyze_workspace_counts",
        lambda _manifest: {"folder_count": 0, "file_count": 0},
    )


def test_update_pack_seed_state_failure_writes_failure_metadata(tmp_path: Path) -> None:
    update_pack_seed_state_failure(
        scope_dir=tmp_path,
        failed_at="2026-05-10T12:00:00+00:00",
        reason="overall_status=failed",
        last_failure_run_id="seed-report-1",
    )

    payload = json.loads(pack_seed_state_path(tmp_path).read_text(encoding="utf-8"))
    assert payload["state"] == "bootstrap-empty"
    assert payload["last_failure_at"] == "2026-05-10T12:00:00+00:00"
    assert payload["last_failure_reason"] == "overall_status=failed"
    assert payload["last_failure_run_id"] == "seed-report-1"


def test_success_preserves_last_failure_metadata(tmp_path: Path) -> None:
    update_pack_seed_state_failure(
        scope_dir=tmp_path,
        failed_at="2026-05-10T12:00:00+00:00",
        reason="exception",
        last_failure_run_id=None,
    )

    update_pack_seed_state(
        scope_dir=tmp_path,
        indexed_at="2026-05-10T12:05:00+00:00",
        last_seed_run_id="seed-report-2",
    )

    payload = json.loads(pack_seed_state_path(tmp_path).read_text(encoding="utf-8"))
    assert payload["state"] == "seeded"
    assert payload["last_seed_at"] == "2026-05-10T12:05:00+00:00"
    assert payload["last_seed_run_id"] == "seed-report-2"
    assert payload["last_failure_at"] == "2026-05-10T12:00:00+00:00"
    assert payload["last_failure_reason"] == "exception"


def test_failure_preserves_last_success_metadata(tmp_path: Path) -> None:
    update_pack_seed_state(
        scope_dir=tmp_path,
        indexed_at="2026-05-10T12:00:00+00:00",
        last_seed_run_id="seed-report-1",
    )

    update_pack_seed_state_failure(
        scope_dir=tmp_path,
        failed_at="2026-05-10T12:10:00+00:00",
        reason="overall_status=failed",
        last_failure_run_id="seed-report-2",
    )

    payload = json.loads(pack_seed_state_path(tmp_path).read_text(encoding="utf-8"))
    assert payload["state"] == "seeded"
    assert payload["last_seed_at"] == "2026-05-10T12:00:00+00:00"
    assert payload["last_seed_run_id"] == "seed-report-1"
    assert payload["last_failure_at"] == "2026-05-10T12:10:00+00:00"
    assert payload["last_failure_reason"] == "overall_status=failed"
    assert payload["last_failure_run_id"] == "seed-report-2"


def test_execute_seed_run_exception_records_failure_and_clears_marker(
    tmp_path: Path,
) -> None:
    context_pack_dir = tmp_path / "context-pack"
    scope_dir = _write_context_pack(context_pack_dir)
    service = _service(tmp_path)
    service.get_live_plan = lambda **_: (_ for _ in ()).throw(RuntimeError("plan failed"))  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="plan failed"):
        service.execute_seed_run(str(context_pack_dir))

    payload = json.loads(pack_seed_state_path(scope_dir).read_text(encoding="utf-8"))
    assert payload["last_failure_reason"] == "exception"
    assert "last_failure_run_id" not in payload
    assert not (context_pack_dir / RESEED_MARKER_FILENAME).exists()


def test_execute_seed_run_failed_status_records_failure_and_preserves_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context_pack_dir = tmp_path / "context-pack"
    scope_dir = _write_context_pack(context_pack_dir)
    update_pack_seed_state(
        scope_dir=scope_dir,
        indexed_at="2026-05-10T12:00:00+00:00",
        last_seed_run_id="context-pack-seed-report-success",
    )
    service = _service(tmp_path)
    service.get_live_plan = lambda **_: (_plan(), "test")  # type: ignore[method-assign]
    service.seed_repository = lambda **_: (_ for _ in ()).throw(RuntimeError("seed failed"))  # type: ignore[method-assign]
    _stub_seed_side_effects(monkeypatch)

    report = service.execute_seed_run(str(context_pack_dir))

    payload = json.loads(pack_seed_state_path(scope_dir).read_text(encoding="utf-8"))
    assert report["overall_status"] == "failed"
    assert payload["state"] == "seeded"
    assert payload["last_seed_at"] == "2026-05-10T12:00:00+00:00"
    assert payload["last_seed_run_id"] == "context-pack-seed-report-success"
    assert payload["last_failure_reason"] == "overall_status=failed"
    assert payload["last_failure_run_id"] == Path(report["report_path"]).stem
    assert not (context_pack_dir / RESEED_MARKER_FILENAME).exists()


def test_execute_seed_run_success_after_failure_preserves_failure_metadata(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context_pack_dir = tmp_path / "context-pack"
    scope_dir = _write_context_pack(context_pack_dir)
    update_pack_seed_state_failure(
        scope_dir=scope_dir,
        failed_at="2026-05-10T12:00:00+00:00",
        reason="overall_status=failed",
        last_failure_run_id="context-pack-seed-report-failed",
    )
    service = _service(tmp_path)
    service.get_live_plan = lambda **_: (_plan(), "test")  # type: ignore[method-assign]
    service.seed_repository = lambda **_: RepoSeedResult(
        repo_id="orders-api",
        repo_name="Orders API",
        status="seeded",
        source_root=str(tmp_path / "repo"),
        seeded_records=1,
        invalidated_records=0,
        warnings=[],
        errors=[],
        report_files={},
    )  # type: ignore[method-assign]
    _stub_seed_side_effects(monkeypatch)

    report = service.execute_seed_run(str(context_pack_dir))

    payload = json.loads(pack_seed_state_path(scope_dir).read_text(encoding="utf-8"))
    assert report["overall_status"] == "success"
    assert payload["state"] == "seeded"
    assert payload["last_seed_run_id"] == Path(report["report_path"]).stem
    assert payload["last_failure_at"] == "2026-05-10T12:00:00+00:00"
    assert payload["last_failure_reason"] == "overall_status=failed"
    assert payload["last_failure_run_id"] == "context-pack-seed-report-failed"
