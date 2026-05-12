"""Repository-level seeding logic for SeedingService.

Extracted from seeding_service.py (Phase 6 Gate G1).  The public surface of
``SeedingService`` is unchanged: ``seed_repository`` delegates here.
``service`` is the SeedingService instance passed as an explicit dependency
so no new class hierarchy is introduced.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, Any

from src.backend.mcp.pack_io import NoExistingPathError, resolve_first_existing

from ..file_analysis import read_preview
from ..models import RepoSeedResult
from ..utils import load_json
from .scope import resolve_path_in_context_pack

if TYPE_CHECKING:
    from .seeding_service import SeedingService

logger = logging.getLogger(__name__)


def seed_repository_impl(
    context_pack_dir: Path,
    plan: dict[str, Any],
    repo: dict[str, Any],
    indexed_at: str,
    *,
    service: "SeedingService",
) -> RepoSeedResult:
    """Execute the full repo-level seed and return a ``RepoSeedResult``.

    This is the extracted body of ``SeedingService.seed_repository``.
    """
    repo = dict(repo)
    repo["context_pack_id"] = plan["context_pack_id"]
    repo["qmd_scope"] = plan["qmd_scope_root"]

    if repo.get("status") != "ready":
        return RepoSeedResult(
            repo_id=repo["repo_id"],
            repo_name=repo["repo_name"],
            status="blocked",
            source_root=repo.get("source_root"),
            seeded_records=0,
            invalidated_records=0,
            warnings=list(repo.get("warnings", [])),
            errors=list(repo.get("errors", [])),
            report_files={},
        )

    existing_roots = repo.get("existing_roots") or []
    if not existing_roots:
        raise ValueError(
            f"Repository '{repo['repo_id']}' is marked ready without an existing root"
        )

    try:
        source_root, skipped_paths = resolve_first_existing(existing_roots)
    except NoExistingPathError:
        raise ValueError(
            f"Repository '{repo['repo_id']}' has no existing readable root "
            f"among: {existing_roots}"
        )
    source_root = source_root.resolve()
    if skipped_paths:
        logger.warning(
            "seeding.multi-path-skip",
            extra={
                "event": "seeding.multi-path-skip",
                "repo_id": repo["repo_id"],
                "chosen": str(source_root),
                "skipped": [
                    {"path": str(s.path), "reason": s.reason} for s in skipped_paths
                ],
            },
        )
    source_ref = service.detect_source_ref(source_root)
    scope_dir = resolve_path_in_context_pack(
        context_pack_dir,
        plan["qmd_scope_root"],
        "qmd_scope_root",
    )
    summary_markdown_path = resolve_path_in_context_pack(
        context_pack_dir,
        repo["qmd_targets"]["canonical_repo_summary"],
        "canonical_repo_summary",
    )
    bootstrap_markdown_path = resolve_path_in_context_pack(
        context_pack_dir,
        repo["qmd_targets"]["operational_bootstrap_note"],
        "operational_bootstrap_note",
    )
    summary_record_path = service.sidecar_record_path(summary_markdown_path)
    bootstrap_record_path = service.sidecar_record_path(bootstrap_markdown_path)
    state_path = service.state_file_path(scope_dir, repo["repo_id"])

    scan_files, scan_warnings = service.iter_scan_files(repo.get("scan_targets", []))
    warnings = list(repo.get("warnings", [])) + scan_warnings
    active_record_files: list[str] = []
    source_paths: list[str] = []
    accumulated_records: list[tuple[Path, dict[str, Any]]] = []
    files_to_process = scan_files[: service.max_files_per_repo]
    files_skipped = max(0, len(scan_files) - service.max_files_per_repo)

    # Pre-compute relative paths (avoids duplicate Path.resolve() calls).
    source_path_entries = [
        (service.relative_source_path(source_root, fp), fp)
        for fp in files_to_process
    ]

    # Phase 1: Parallel preview reads (I/O-bound, safe for threading).
    preview_cache: dict[str, str] = {}
    if source_path_entries:
        worker_count = min(8, len(source_path_entries))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            futures = {
                pool.submit(read_preview, full_path): sp
                for sp, full_path in source_path_entries
            }
            for future in futures:
                try:
                    preview_cache[futures[future]] = future.result()
                except Exception:
                    logger.debug(
                        "Preview read failed for %s", futures[future], exc_info=True
                    )
                    preview_cache[futures[future]] = ""

    # Phase 2: Sequential record creation (CPU-bound, uses cached previews).
    for source_path, _file_path in source_path_entries:
        source_paths.append(source_path)
        artifact_preview_path = Path(source_path)
        effective_layer = (
            "documents"
            if service.detect_artifact_type(artifact_preview_path)
            in {"architecture-doc", "runbook"}
            else repo["system_layer"]
        )
        artifact_record_path = service.record_storage_path(
            scope_dir,
            effective_layer,
            repo["repo_id"],
            source_path,
        )
        artifact_record = service.create_artifact_record(
            repo=repo,
            source_root=source_root,
            source_ref=source_ref,
            source_path=source_path,
            indexed_at=indexed_at,
            record_path=artifact_record_path,
            preview=preview_cache.get(source_path),
        )
        service.write_json(artifact_record_path, artifact_record)
        active_record_files.append(str(artifact_record_path))
        accumulated_records.append((artifact_record_path, artifact_record))

    if files_skipped > 0:
        logger.warning(
            "Reached max_files_per_repo limit (%d) for %s; skipped %d files",
            service.max_files_per_repo,
            repo["repo_id"],
            files_skipped,
        )

    summary_markdown = service.build_repo_summary_markdown(
        repo=repo,
        source_root=source_root,
        source_ref=source_ref,
        source_paths=source_paths,
        warnings=warnings,
        generated_at=indexed_at,
    )
    service.write_text(summary_markdown_path, summary_markdown)
    summary_record = service.create_summary_record(
        repo=repo,
        source_ref=source_ref,
        indexed_at=indexed_at,
        record_path=summary_record_path,
        source_paths=source_paths,
    )
    service.write_json(summary_record_path, summary_record)
    active_record_files.append(str(summary_record_path))
    accumulated_records.append((summary_record_path, summary_record))

    previous_state: dict[str, Any] = {}
    if state_path.exists():
        try:
            previous_state = load_json(state_path)
        except ValueError:
            logger.warning("Corrupted seed state at %s, starting fresh", state_path)
            previous_state = {}

    invalidated_records = 0
    active_record_set = set(active_record_files)
    for previous_record in previous_state.get("active_record_files", []):
        if previous_record in active_record_set:
            continue
        record_path_obj = Path(previous_record)
        modified = service.invalidate_record(
            record_path_obj,
            indexed_at=indexed_at,
            reason=(
                "Source artifact was not observed in the latest live "
                "seed refresh."
            ),
        )
        if modified is not None:
            invalidated_records += 1
            accumulated_records.append((record_path_obj, modified))

    bootstrap_markdown = service.build_bootstrap_note_markdown(
        repo=repo,
        source_root=source_root,
        source_ref=source_ref,
        seeded_count=len(source_paths),
        invalidated_count=invalidated_records,
        warnings=warnings,
        generated_at=indexed_at,
    )
    service.write_text(bootstrap_markdown_path, bootstrap_markdown)
    bootstrap_record = service.create_bootstrap_note_record(
        repo=repo,
        source_ref=source_ref,
        indexed_at=indexed_at,
        record_path=bootstrap_record_path,
        source_paths=source_paths,
    )
    service.write_json(bootstrap_record_path, bootstrap_record)
    active_record_files.append(str(bootstrap_record_path))
    accumulated_records.append((bootstrap_record_path, bootstrap_record))

    service.write_json(
        state_path,
        {
            "repo_id": repo["repo_id"],
            "repo_name": repo["repo_name"],
            "source_root": str(source_root),
            "source_ref": source_ref,
            "last_seeded_at": indexed_at,
            "active_record_files": active_record_files,
        },
    )

    report_files = {
        "repo_summary": str(summary_markdown_path),
        "repo_summary_record": str(summary_record_path),
        "bootstrap_note": str(bootstrap_markdown_path),
        "bootstrap_note_record": str(bootstrap_record_path),
        "seed_state": str(state_path),
    }
    return RepoSeedResult(
        repo_id=repo["repo_id"],
        repo_name=repo["repo_name"],
        status="seeded",
        source_root=str(source_root),
        seeded_records=len(source_paths) + 2,
        invalidated_records=invalidated_records,
        warnings=warnings,
        errors=[],
        report_files=report_files,
        source_ref=source_ref,
        source_paths=source_paths,
        files_skipped=files_skipped,
        accumulated_records=accumulated_records,
    )
