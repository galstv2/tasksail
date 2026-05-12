from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from src.backend.mcp.context_estate.workspace_analysis import analyze_workspace_counts
from src.backend.mcp.pack_io import NoExistingPathError, resolve_first_existing

from ..models import RepoSeedResult
from ..utils import (
    load_json,
    utc_now,
)
from ..utils import (
    resolve_context_data_dir as _resolve_context_data_dir,
)
from .indexes import maybe_write_context_pack_conventions, write_scope_indexes
from .marker import (
    acquire_reseed_marker,
    clear_reseed_marker,
    update_pack_seed_state,
    update_pack_seed_state_failure,
)
from .plan import build_plan as _build_plan
from .plan import get_live_plan as _get_live_plan
from .plan import load_plan as _load_plan
from .qmd_index_service import QmdIndexService
from .repository_seed import seed_repository_impl
from .runtime_state import SeedRuntimeState  # noqa: F401 - re-exported for existing callers
from .scope import resolve_path_in_context_pack

logger = logging.getLogger(__name__)


class SeedingService:
    def __init__(
        self,
        *,
        workspace_root: Path,
        default_manifest: str,
        default_plan_file: str,
        normalize_repo_entry: Callable[[Path, dict[str, Any], str], dict[str, Any]],
        detect_source_ref: Callable[[Path], str],
        iter_scan_files: Callable[[list[str]], tuple[list[Path], list[str]]],
        relative_source_path: Callable[[Path, Path], str],
        detect_artifact_type: Callable[[Path], str],
        record_storage_path: Callable[[Path, str, str, str], Path],
        sidecar_record_path: Callable[[Path], Path],
        state_file_path: Callable[[Path, str], Path],
        report_file_path: Callable[[Path, str], Path],
        write_json: Callable[[Path, dict[str, Any]], None],
        write_text: Callable[[Path, str], None],
        invalidate_record: Callable[..., dict[str, Any] | None],
        create_artifact_record: Callable[..., dict[str, Any]],
        create_summary_record: Callable[..., dict[str, Any]],
        create_bootstrap_note_record: Callable[..., dict[str, Any]],
        build_repo_summary_markdown: Callable[..., str],
        build_bootstrap_note_markdown: Callable[..., str],
        build_context_pack_conventions_markdown: Callable[..., str],
        create_context_pack_conventions_record: Callable[..., dict[str, Any]],
        qmd_index_service: QmdIndexService | None = None,
        max_files_per_repo: int = 200,
    ) -> None:
        self.workspace_root = workspace_root
        self.default_manifest = default_manifest
        self.default_plan_file = default_plan_file
        self.normalize_repo_entry = normalize_repo_entry
        self.detect_source_ref = detect_source_ref
        self.iter_scan_files = iter_scan_files
        self.relative_source_path = relative_source_path
        self.detect_artifact_type = detect_artifact_type
        self.record_storage_path = record_storage_path
        self.sidecar_record_path = sidecar_record_path
        self.state_file_path = state_file_path
        self.report_file_path = report_file_path
        self.write_json = write_json
        self.write_text = write_text
        self.invalidate_record = invalidate_record
        self.create_artifact_record = create_artifact_record
        self.create_summary_record = create_summary_record
        self.create_bootstrap_note_record = create_bootstrap_note_record
        self.build_repo_summary_markdown = build_repo_summary_markdown
        self.build_bootstrap_note_markdown = build_bootstrap_note_markdown
        self.build_context_pack_conventions_markdown = (
            build_context_pack_conventions_markdown
        )
        self.create_context_pack_conventions_record = (
            create_context_pack_conventions_record
        )
        self.max_files_per_repo = max_files_per_repo
        self.qmd_index_service = qmd_index_service or QmdIndexService(
            workspace_root=workspace_root,
        )

    def _resolve_context_pack_dir(self, context_pack_dir: str) -> Path:
        return _resolve_context_data_dir(context_pack_dir)

    def build_plan(self, context_pack_dir: Path, manifest_path: Path) -> dict[str, Any]:
        return _build_plan(
            context_pack_dir,
            manifest_path,
            normalize_repo_entry=self.normalize_repo_entry,
        )

    def load_plan(self, plan_path: Path) -> dict[str, Any]:
        return _load_plan(plan_path)

    def get_live_plan(
        self,
        context_pack_dir: Path,
        manifest_path: Path,
        plan_path: Path,
        plan_mode: str,
    ) -> tuple[dict[str, Any], str]:
        return _get_live_plan(
            context_pack_dir,
            manifest_path,
            plan_path,
            plan_mode,
            normalize_repo_entry=self.normalize_repo_entry,
        )

    def seed_repository(
        self,
        context_pack_dir: Path,
        plan: dict[str, Any],
        repo: dict[str, Any],
        indexed_at: str,
    ) -> RepoSeedResult:
        return seed_repository_impl(
            context_pack_dir,
            plan,
            repo,
            indexed_at,
            service=self,
        )

    def execute_seed_run(
        self,
        context_pack_dir: str,
        manifest: str | None = None,
        plan_file: str | None = None,
        plan_mode: str = "prefer-plan",
        write_report: bool = True,
    ) -> dict[str, Any]:
        effective_manifest = manifest or self.default_manifest
        effective_plan_file = plan_file or self.default_plan_file
        context_pack_path = self._resolve_context_pack_dir(context_pack_dir)
        marker_path = acquire_reseed_marker(context_pack_path)
        try:
            return self._execute_seed_run_with_marker(
                context_pack_path=context_pack_path,
                effective_manifest=effective_manifest,
                effective_plan_file=effective_plan_file,
                plan_mode=plan_mode,
                write_report=write_report,
            )
        except Exception:
            try:
                manifest_path = resolve_path_in_context_pack(
                    context_pack_path,
                    effective_manifest,
                    "manifest",
                )
                raw_manifest = load_json(manifest_path)
                qmd_scope_root = raw_manifest.get("qmd_scope_root")
                if isinstance(qmd_scope_root, str) and qmd_scope_root:
                    scope_dir = resolve_path_in_context_pack(
                        context_pack_path,
                        qmd_scope_root,
                        "qmd_scope_root",
                    )
                    update_pack_seed_state_failure(
                        scope_dir=scope_dir,
                        failed_at=utc_now(),
                        reason="exception",
                        last_failure_run_id=None,
                    )
            except Exception:  # noqa: BLE001
                logger.warning(
                    "pack_seed_state: failed to record early reseed failure",
                    exc_info=True,
                )
            raise
        finally:
            clear_reseed_marker(marker_path)

    def _execute_seed_run_with_marker(
        self,
        *,
        context_pack_path: Path,
        effective_manifest: str,
        effective_plan_file: str,
        plan_mode: str,
        write_report: bool,
    ) -> dict[str, Any]:
        manifest_path = resolve_path_in_context_pack(
            context_pack_path,
            effective_manifest,
            "manifest",
        )
        plan_path = resolve_path_in_context_pack(
            context_pack_path,
            effective_plan_file,
            "plan_file",
        )
        plan, plan_source = self.get_live_plan(
            context_pack_dir=context_pack_path,
            manifest_path=manifest_path,
            plan_path=plan_path,
            plan_mode=plan_mode,
        )

        indexed_at = utc_now()
        scope_dir = resolve_path_in_context_pack(
            context_pack_path,
            plan["qmd_scope_root"],
            "qmd_scope_root",
        )
        scope_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.report_file_path(scope_dir, indexed_at) if write_report else None
        results: list[dict[str, Any]] = []
        seeded_count = 0
        blocked_count = 0
        error_count = 0
        total_invalidated = 0
        total_files_skipped = 0
        repository_index_inputs: list[dict[str, Any]] = []
        all_accumulated_records: list[tuple[Path, dict[str, Any]]] = []

        for repo in plan["repositories"]:
            try:
                result = self.seed_repository(
                    context_pack_dir=context_pack_path,
                    plan=plan,
                    repo=repo,
                    indexed_at=indexed_at,
                )
            except Exception as exc:  # noqa: BLE001
                roots_for_error = repo.get("existing_roots") or []
                try:
                    chosen_for_error, _ = resolve_first_existing(roots_for_error)
                    error_source_root: str | None = str(chosen_for_error.resolve())
                except NoExistingPathError:
                    error_source_root = roots_for_error[0] if roots_for_error else None
                result = RepoSeedResult(
                    repo_id=str(
                        repo.get("repo_id") or repo.get("repo_name") or "unknown"
                    ),
                    repo_name=str(
                        repo.get("repo_name") or repo.get("repo_id") or "unknown"
                    ),
                    status="error",
                    source_root=error_source_root,
                    seeded_records=0,
                    invalidated_records=0,
                    warnings=list(repo.get("warnings", [])),
                    errors=[str(exc)],
                    report_files={},
                )

            if result.accumulated_records:
                all_accumulated_records.extend(result.accumulated_records)
            results.append(result.to_report_dict())
            repo_index_entry = dict(repo)
            repo_index_entry["seed_status"] = result.status
            repo_index_entry["local_root"] = result.source_root or ""
            repo_index_entry["last_seeded_at"] = (
                indexed_at if result.status == "seeded" else ""
            )
            if result.source_ref:
                repo_index_entry["source_ref"] = result.source_ref
            if result.source_paths:
                repo_index_entry["source_paths"] = list(result.source_paths)
            repository_index_inputs.append(repo_index_entry)
            if result.status == "seeded":
                seeded_count += 1
            elif result.status == "blocked":
                blocked_count += 1
            else:
                error_count += 1
            total_invalidated += result.invalidated_records
            total_files_skipped += result.files_skipped

        if error_count > 0:
            overall_status = "partial-failure" if seeded_count > 0 else "failed"
        elif blocked_count > 0:
            overall_status = "completed-with-blocked-repos"
        else:
            overall_status = "success"

        report = {
            "run_type": "qmd-live-seed",
            "run_version": "qmd-live-seed/v1",
            "run_started_at": indexed_at,
            "context_pack_id": plan["context_pack_id"],
            "context_pack_dir": str(context_pack_path),
            "qmd_scope_root": plan["qmd_scope_root"],
            "input_source": plan_source,
            "manifest_path": str(manifest_path),
            "plan_path": str(plan_path),
            "repository_count": len(plan["repositories"]),
            "seeded_repo_count": seeded_count,
            "blocked_repo_count": blocked_count,
            "error_repo_count": error_count,
            "invalidated_record_count": total_invalidated,
            "files_skipped": total_files_skipped,
            "overall_status": overall_status,
            "repositories": results,
        }

        seeded_repositories = [
            repo
            for repo in repository_index_inputs
            if repo.get("seed_status") == "seeded"
        ]
        report["conventions_summary"] = maybe_write_context_pack_conventions(
            self,
            context_pack_dir=context_pack_path,
            plan=plan,
            repositories=seeded_repositories,
            indexed_at=indexed_at,
        )

        try:
            report["workspace_counts"] = analyze_workspace_counts(load_json(manifest_path))
        except Exception:  # noqa: BLE001
            logger.warning(
                "workspace_analysis: failed to compute workspace counts", exc_info=True
            )
        if all_accumulated_records:
            self.qmd_index_service.warm_and_merge_records(
                scope_dir, all_accumulated_records,
            )

        report["index_outputs"] = write_scope_indexes(
            self,
            context_pack_dir=context_pack_path,
            scope_dir=scope_dir,
            plan=plan,
            repositories=repository_index_inputs,
            latest_seed_run_path=str(output_path) if output_path is not None else None,
        )

        if write_report:
            assert output_path is not None
            self.write_json(output_path, report)
            report["report_path"] = str(output_path)

        run_id = self.report_file_path(scope_dir, indexed_at).stem
        if overall_status != "failed" and not (
            overall_status in {"completed-with-blocked-repos", "partial-failure"}
            and seeded_count == 0
        ):
            update_pack_seed_state(
                scope_dir=scope_dir,
                indexed_at=indexed_at,
                last_seed_run_id=run_id,
            )
        else:
            failure_reason = (
                "overall_status=failed"
                if overall_status == "failed"
                else "overall_status=partial-failure-no-seeded-repos"
            )
            update_pack_seed_state_failure(
                scope_dir=scope_dir,
                failed_at=indexed_at,
                reason=failure_reason,
                last_failure_run_id=run_id,
            )

        return report

    def resolve_seed_scope_key(
        self,
        *,
        context_pack_dir: str,
        manifest: str | None = None,
        plan_file: str | None = None,
        plan_mode: str = "prefer-plan",
    ) -> str:
        effective_manifest = manifest or self.default_manifest
        effective_plan_file = plan_file or self.default_plan_file
        context_pack_path = self._resolve_context_pack_dir(context_pack_dir)
        manifest_path = resolve_path_in_context_pack(
            context_pack_path,
            effective_manifest,
            "manifest",
        )
        plan_path = resolve_path_in_context_pack(
            context_pack_path,
            effective_plan_file,
            "plan_file",
        )
        plan, _ = self.get_live_plan(
            context_pack_dir=context_pack_path,
            manifest_path=manifest_path,
            plan_path=plan_path,
            plan_mode=plan_mode,
        )
        scope_dir = resolve_path_in_context_pack(
            context_pack_path,
            plan["qmd_scope_root"],
            "qmd_scope_root",
        )
        return str(scope_dir.resolve())
