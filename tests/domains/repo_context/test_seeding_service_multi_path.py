from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.backend.mcp.path_resolution import ContainerPathMissing
from src.backend.mcp.repo_context_mcp.services.seeding_service import SeedingService


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _make_service(tmp_path: Path, normalize_repo_entry) -> SeedingService:
    return SeedingService(
        workspace_root=tmp_path,
        default_manifest="qmd/repo-sources.json",
        default_plan_file="qmd/bootstrap/seed-plan.json",
        normalize_repo_entry=normalize_repo_entry,
        detect_source_ref=lambda _source_root: "unknown",
        iter_scan_files=lambda _scan_targets: ([], []),
        relative_source_path=lambda source_root, file_path: str(file_path.relative_to(source_root)),
        detect_artifact_type=lambda _path: "source",
        record_storage_path=lambda scope_dir, _layer, repo_id, source_path: scope_dir / repo_id / f"{source_path}.json",
        sidecar_record_path=lambda path: path.with_suffix(path.suffix + ".json"),
        state_file_path=lambda scope_dir, repo_id: scope_dir / f"{repo_id}.state.json",
        report_file_path=lambda scope_dir, name: scope_dir / name,
        write_json=_write_json,
        write_text=_write_text,
        invalidate_record=lambda *_args, **_kwargs: None,
        create_artifact_record=lambda **_kwargs: {},
        create_summary_record=lambda **_kwargs: {},
        create_bootstrap_note_record=lambda **_kwargs: {},
        build_repo_summary_markdown=lambda **_kwargs: "summary",
        build_bootstrap_note_markdown=lambda **_kwargs: "bootstrap",
        build_context_pack_conventions_markdown=lambda **_kwargs: "conventions",
        create_context_pack_conventions_record=lambda **_kwargs: {},
    )


def test_seed_repository_uses_first_existing_path_and_logs_skips(
    tmp_path: Path,
    caplog,
) -> None:
    context_pack_dir = tmp_path / "context-pack"
    missing_root = tmp_path / "missing-root"
    chosen_root = tmp_path / "chosen-root"
    not_selected_root = tmp_path / "not-selected-root"
    chosen_root.mkdir()
    not_selected_root.mkdir()

    service = _make_service(
        tmp_path,
        normalize_repo_entry=lambda _context_pack_dir, repo, _qmd_scope_root: repo,
    )

    repo = {
        "repo_id": "orders-api",
        "repo_name": "Orders API",
        "status": "ready",
        "system_layer": "backend",
        "existing_roots": [str(missing_root), str(chosen_root), str(not_selected_root)],
        "scan_targets": [],
        "warnings": [],
        "qmd_targets": {
            "canonical_repo_summary": "qmd/context-packs/orders/orders-api/summary.md",
            "operational_bootstrap_note": "qmd/context-packs/orders/orders-api/bootstrap.md",
        },
    }
    plan = {
        "context_pack_id": "orders",
        "qmd_scope_root": "qmd/context-packs/orders",
    }

    with caplog.at_level(
        logging.WARNING,
        logger="src.backend.mcp.repo_context_mcp.services.seeding_service",
    ):
        result = service.seed_repository(
            context_pack_dir=context_pack_dir,
            plan=plan,
            repo=repo,
            indexed_at="2026-05-09T00:00:00Z",
        )

    assert result.source_root == str(chosen_root.resolve())
    record = next(
        item for item in caplog.records if item.message == "seeding.multi-path-skip"
    )
    assert record.repo_id == "orders-api"
    assert record.chosen == str(chosen_root.resolve())
    assert record.skipped == [
        {"path": str(missing_root), "reason": "missing"},
        {"path": str(not_selected_root), "reason": "not-selected"},
    ]


def test_build_plan_blocks_only_repo_with_missing_container_path(
    tmp_path: Path,
    caplog,
) -> None:
    context_pack_dir = tmp_path / "context-pack"
    manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(
        """{
  "manifest_version": "qmd-repo-sources/v2",
  "manifest_status": "approved",
  "estate_type": "distributed",
  "context_pack_id": "orders",
  "qmd_scope_root": "qmd/context-packs/orders",
  "repositories": [
    {"repo_id": "missing", "repo_name": "Missing", "local_paths": []},
    {"repo_id": "ready", "repo_name": "Ready", "local_paths": []}
  ]
}""",
        encoding="utf-8",
    )

    def normalize_repo_entry(_context_pack_dir, repo, _qmd_scope_root):
        if repo["repo_id"] == "missing":
            raise ContainerPathMissing("/host/missing")
        return {
            "repo_id": repo["repo_id"],
            "repo_name": repo["repo_name"],
            "owner": None,
            "bounded_context": None,
            "system_layer": "backend",
            "languages": [],
            "tags": [],
            "existing_roots": [str(tmp_path)],
            "missing_roots": [],
            "scan_targets": [],
            "qmd_targets": {},
            "status": "ready",
            "warnings": [],
        }

    service = _make_service(tmp_path, normalize_repo_entry=normalize_repo_entry)

    with caplog.at_level(
        logging.WARNING,
        logger="src.backend.mcp.repo_context_mcp.services.seeding_service",
    ):
        plan = service.build_plan(context_pack_dir, manifest_path)

    repos = {repo["repo_id"]: repo for repo in plan["repositories"]}
    assert repos["missing"]["status"] == "blocked"
    assert repos["missing"]["errors"]
    assert repos["ready"]["status"] == "ready"
    record = next(
        item for item in caplog.records
        if getattr(item, "event", "") == "seeding.container-path-missing"
    )
    assert record.repo_id == "missing"
    assert record.host == "/host/missing"
