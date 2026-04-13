from __future__ import annotations

import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from ..file_analysis import read_preview
from ..models import RepoSeedResult, SeedRuntimeSnapshot
from .qmd_index_service import QmdIndexService
from src.backend.mcp.repo_type_probe import classify_repository_type
from src.backend.mcp.context_estate.workspace_analysis import analyze_workspace_counts
import logging

from ..utils import (
    ensure_non_empty_string,
    load_json,
    resolve_context_pack_dir as _resolve_context_pack_dir,
    resolve_path_within,
    utc_now,
)

logger = logging.getLogger(__name__)


class SeedRuntimeState:
    def __init__(self, lock: threading.Lock | None = None) -> None:
        self._run_lock = lock or threading.Lock()
        self._state_lock = threading.Lock()
        self._latest_run: dict[str, Any] | None = None

    def acquire_seed_run(self) -> bool:
        return self._run_lock.acquire(blocking=False)

    def release_seed_run(self) -> None:
        self._run_lock.release()

    def force_release_if_held(self) -> bool:
        """Release the seed lock if currently held. Returns True if released."""
        if not self._run_lock.locked():
            return False
        try:
            self._run_lock.release()
        except RuntimeError:
            return False
        return True

    def set_latest_run(self, report: dict[str, Any]) -> None:
        frozen = copy.deepcopy(report)
        with self._state_lock:
            self._latest_run = frozen

    def snapshot(self) -> SeedRuntimeSnapshot:
        with self._state_lock:
            ref = self._latest_run
        return SeedRuntimeSnapshot(latest_run=ref)


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
        return _resolve_context_pack_dir(
            self.workspace_root, context_pack_dir,
        )

    def _normalize_qmd_scope_root(
        self,
        *,
        context_pack_dir: Path,
        qmd_scope_root: str,
    ) -> str:
        scope_dir = resolve_path_within(
            context_pack_dir,
            qmd_scope_root,
            "qmd_scope_root",
        )
        return scope_dir.relative_to(context_pack_dir).as_posix()

    def _resolve_path_in_context_pack(
        self,
        *,
        context_pack_dir: Path,
        value: str,
        field_name: str,
    ) -> Path:
        return resolve_path_within(context_pack_dir, value, field_name)

    def _write_scope_indexes(
        self,
        *,
        context_pack_dir: Path,
        scope_dir: Path,
        plan: dict[str, Any],
        repositories: list[dict[str, Any]],
        latest_seed_run_path: str | None,
    ) -> dict[str, str]:
        self.qmd_index_service.invalidate_descriptor_cache(scope_dir)
        repository_index = self.qmd_index_service.build_repository_index(
            scope_dir=scope_dir,
            repositories=repositories,
        )
        task_index = self.qmd_index_service.build_glopml_task_index(scope_dir=scope_dir)
        lineage_index = self.qmd_index_service.build_top_level_lineage_index(scope_dir=scope_dir)
        context_pack_index = self.qmd_index_service.build_context_pack_index(
            scope_dir=scope_dir,
            repository_entries=repository_index["repositories"],
            task_entries=task_index["tasks"],
            lineage_entries=lineage_index["lineage_roots"],
            latest_seed_run_path=latest_seed_run_path,
        )

        repositories_index_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=f"{plan['qmd_scope_root']}/indexes/repositories.json",
            field_name="qmd_scope_root",
        )
        tasks_index_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=f"{plan['qmd_scope_root']}/indexes/tasks.json",
            field_name="qmd_scope_root",
        )
        lineage_index_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=f"{plan['qmd_scope_root']}/indexes/lineage.json",
            field_name="qmd_scope_root",
        )

        context_pack_index_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=f"{plan['qmd_scope_root']}/indexes/context-pack-index.json",
            field_name="qmd_scope_root",
        )

        self.write_json(context_pack_index_path, context_pack_index)
        self.write_json(repositories_index_path, repository_index)
        self.write_json(tasks_index_path, task_index)
        self.write_json(lineage_index_path, lineage_index)

        return {
            "context_pack_index": str(context_pack_index_path),
            "repositories_index": str(repositories_index_path),
            "tasks_index": str(tasks_index_path),
            "lineage_index": str(lineage_index_path),
        }

    def _context_pack_conventions_paths(
        self,
        *,
        context_pack_dir: Path,
        plan: dict[str, Any],
    ) -> tuple[Path, Path]:
        markdown_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=(
                f"{plan['qmd_scope_root']}/canonical/context-pack/"
                "codepmse-conventions.md"
            ),
            field_name="qmd_scope_root",
        )
        return markdown_path, self.sidecar_record_path(markdown_path)

    def _maybe_write_context_pack_conventions(
        self,
        *,
        context_pack_dir: Path,
        plan: dict[str, Any],
        repositories: list[dict[str, Any]],
        indexed_at: str,
    ) -> dict[str, Any]:
        markdown_path, record_path = self._context_pack_conventions_paths(
            context_pack_dir=context_pack_dir,
            plan=plan,
        )
        result = {
            "status": "existing",
            "markdown_path": str(markdown_path),
            "record_path": str(record_path),
        }

        if markdown_path.exists() or record_path.exists():
            result["reason"] = "Context-pack conventions memo already exists."
            return result

        if not repositories:
            result["status"] = "deferred"
            result["reason"] = (
                "Conventions memo generation is deferred until at least one "
                "repository seeds successfully."
            )
            return result

        if not any(repo.get("source_paths") for repo in repositories):
            result["status"] = "insufficient-inputs"
            result["reason"] = (
                "Conventions memo generation was skipped because no bounded "
                "source paths were observed in the successful seed inputs."
            )
            return result

        markdown = self.build_context_pack_conventions_markdown(
            context_pack_id=plan["context_pack_id"],
            repositories=repositories,
            generated_at=indexed_at,
        )
        self.write_text(markdown_path, markdown)
        record = self.create_context_pack_conventions_record(
            context_pack_id=plan["context_pack_id"],
            qmd_scope=plan["qmd_scope_root"],
            indexed_at=indexed_at,
            record_path=record_path,
            repositories=repositories,
        )
        self.write_json(record_path, record)
        result["status"] = "created"
        result["reason"] = (
            "Context-pack conventions memo was created from the first "
            "successful live seed inputs."
        )
        return result

    def build_plan(self, context_pack_dir: Path, manifest_path: Path) -> dict[str, Any]:
        manifest = load_json(manifest_path)
        context_pack_id = ensure_non_empty_string(
            manifest.get("context_pack_id") or context_pack_dir.name,
            "context_pack_id",
        )
        qmd_scope_root = ensure_non_empty_string(
            manifest.get("qmd_scope_root")
            or f"qmd/context-packs/{context_pack_id}",
            "qmd_scope_root",
        )
        qmd_scope_root = self._normalize_qmd_scope_root(
            context_pack_dir=context_pack_dir,
            qmd_scope_root=qmd_scope_root,
        )
        repositories = manifest.get("repositories")
        if not isinstance(repositories, list) or not repositories:
            raise ValueError("Manifest requires a non-empty 'repositories' list")

        repo_plans: list[dict[str, Any]] = []
        seen_repo_ids: set[str] = set()
        for raw_entry in repositories:
            if not isinstance(raw_entry, dict):
                raise ValueError("Each repository entry must be a JSON object")
            normalized = self.normalize_repo_entry(
                context_pack_dir,
                raw_entry,
                qmd_scope_root,
            )
            repo_id = normalized["repo_id"]
            if repo_id in seen_repo_ids:
                raise ValueError(
                    f"Duplicate repository repo_id detected in manifest: {repo_id}"
                )
            seen_repo_ids.add(repo_id)
            repo_plans.append(normalized)

        warning_count = sum(len(repo["warnings"]) for repo in repo_plans)
        ready_count = sum(1 for repo in repo_plans if repo["status"] == "ready")
        blocked_count = sum(
            1 for repo in repo_plans if repo["status"] == "blocked"
        )

        return {
            "plan_type": "qmd-seeding-live-input",
            "plan_version": "qmd-seeding-live-input/v1",
            "context_pack_id": context_pack_id,
            "context_pack_dir": str(context_pack_dir),
            "manifest_path": str(manifest_path),
            "qmd_scope_root": qmd_scope_root,
            "repository_count": len(repo_plans),
            "ready_count": ready_count,
            "blocked_count": blocked_count,
            "warning_count": warning_count,
            "repositories": repo_plans,
        }

    def load_plan(self, plan_path: Path) -> dict[str, Any]:
        plan = load_json(plan_path)
        required_fields = [
            "context_pack_id",
            "qmd_scope_root",
            "repositories",
        ]
        for field_name in required_fields:
            if field_name not in plan:
                raise ValueError(
                    f"Plan file is missing required field '{field_name}'"
                )
        repositories = plan.get("repositories")
        if not isinstance(repositories, list) or not repositories:
            raise ValueError("Plan file requires a non-empty 'repositories' list")
        return plan

    def get_live_plan(
        self,
        context_pack_dir: Path,
        manifest_path: Path,
        plan_path: Path,
        plan_mode: str,
    ) -> tuple[dict[str, Any], str]:
        if plan_mode in {"prefer-plan", "require-plan"} and plan_path.exists():
            plan = self.load_plan(plan_path)
            plan["qmd_scope_root"] = self._normalize_qmd_scope_root(
                context_pack_dir=context_pack_dir,
                qmd_scope_root=ensure_non_empty_string(
                    plan.get("qmd_scope_root"),
                    "qmd_scope_root",
                ),
            )
            return plan, "dry-run-plan"
        if plan_mode == "require-plan":
            raise ValueError(
                f"Approved dry-run plan is required but missing: {plan_path}"
            )
        return self.build_plan(context_pack_dir, manifest_path), "manifest"

    def seed_repository(
        self,
        context_pack_dir: Path,
        plan: dict[str, Any],
        repo: dict[str, Any],
        indexed_at: str,
    ) -> RepoSeedResult:
        repo = dict(repo)
        repo["context_pack_id"] = plan["context_pack_id"]
        repo["qmd_scope"] = plan["qmd_scope_root"]

        if repo.get("status") != "ready":
            return RepoSeedResult(
                repo_id=repo["repo_id"],
                repo_name=repo["repo_name"],
                status="blocked",
                source_root=None,
                seeded_records=0,
                invalidated_records=0,
                warnings=list(repo.get("warnings", [])),
                errors=[],
                report_files={},
            )

        existing_roots = repo.get("existing_roots") or []
        if not existing_roots:
            raise ValueError(
                f"Repository '{repo['repo_id']}' is marked ready without an existing root"
            )

        source_root = Path(existing_roots[0]).resolve()
        source_ref = self.detect_source_ref(source_root)
        scope_dir = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=plan["qmd_scope_root"],
            field_name="qmd_scope_root",
        )
        summary_markdown_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=repo["qmd_targets"]["canonical_repo_summary"],
            field_name="canonical_repo_summary",
        )
        bootstrap_markdown_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_dir,
            value=repo["qmd_targets"]["operational_bootstrap_note"],
            field_name="operational_bootstrap_note",
        )
        summary_record_path = self.sidecar_record_path(summary_markdown_path)
        bootstrap_record_path = self.sidecar_record_path(bootstrap_markdown_path)
        state_path = self.state_file_path(scope_dir, repo["repo_id"])

        scan_files, scan_warnings = self.iter_scan_files(repo.get("scan_targets", []))
        warnings = list(repo.get("warnings", [])) + scan_warnings
        active_record_files: list[str] = []
        source_paths: list[str] = []
        accumulated_records: list[tuple[Path, dict[str, Any]]] = []
        files_to_process = scan_files[:self.max_files_per_repo]
        files_skipped = max(0, len(scan_files) - self.max_files_per_repo)

        # Pre-compute relative paths (avoids duplicate Path.resolve() calls).
        source_path_entries = [
            (self.relative_source_path(source_root, fp), fp)
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
                        logger.debug("Preview read failed for %s", futures[future], exc_info=True)
                        preview_cache[futures[future]] = ""

        # Phase 2: Sequential record creation (CPU-bound, uses cached previews).
        for source_path, _file_path in source_path_entries:
            source_paths.append(source_path)
            artifact_preview_path = Path(source_path)
            effective_layer = (
                "documents"
                if self.detect_artifact_type(artifact_preview_path)
                in {"architecture-doc", "runbook"}
                else repo["system_layer"]
            )
            artifact_record_path = self.record_storage_path(
                scope_dir,
                effective_layer,
                repo["repo_id"],
                source_path,
            )
            artifact_record = self.create_artifact_record(
                repo=repo,
                source_root=source_root,
                source_ref=source_ref,
                source_path=source_path,
                indexed_at=indexed_at,
                record_path=artifact_record_path,
                preview=preview_cache.get(source_path),
            )
            self.write_json(artifact_record_path, artifact_record)
            active_record_files.append(str(artifact_record_path))
            accumulated_records.append((artifact_record_path, artifact_record))

        if files_skipped > 0:
            logger.warning(
                "Reached max_files_per_repo limit (%d) for %s; skipped %d files",
                self.max_files_per_repo,
                repo["repo_id"],
                files_skipped,
            )

        summary_markdown = self.build_repo_summary_markdown(
            repo=repo,
            source_root=source_root,
            source_ref=source_ref,
            source_paths=source_paths,
            warnings=warnings,
            generated_at=indexed_at,
        )
        self.write_text(summary_markdown_path, summary_markdown)
        summary_record = self.create_summary_record(
            repo=repo,
            source_ref=source_ref,
            indexed_at=indexed_at,
            record_path=summary_record_path,
            source_paths=source_paths,
        )
        self.write_json(summary_record_path, summary_record)
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
            modified = self.invalidate_record(
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

        bootstrap_markdown = self.build_bootstrap_note_markdown(
            repo=repo,
            source_root=source_root,
            source_ref=source_ref,
            seeded_count=len(source_paths),
            invalidated_count=invalidated_records,
            warnings=warnings,
            generated_at=indexed_at,
        )
        self.write_text(bootstrap_markdown_path, bootstrap_markdown)
        bootstrap_record = self.create_bootstrap_note_record(
            repo=repo,
            source_ref=source_ref,
            indexed_at=indexed_at,
            record_path=bootstrap_record_path,
            source_paths=source_paths,
        )
        self.write_json(bootstrap_record_path, bootstrap_record)
        active_record_files.append(str(bootstrap_record_path))
        accumulated_records.append((bootstrap_record_path, bootstrap_record))

        self.write_json(
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
        manifest_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_path,
            value=effective_manifest,
            field_name="manifest",
        )
        plan_path = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_path,
            value=effective_plan_file,
            field_name="plan_file",
        )
        plan, plan_source = self.get_live_plan(
            context_pack_dir=context_pack_path,
            manifest_path=manifest_path,
            plan_path=plan_path,
            plan_mode=plan_mode,
        )

        indexed_at = utc_now()
        scope_dir = self._resolve_path_in_context_pack(
            context_pack_dir=context_pack_path,
            value=plan["qmd_scope_root"],
            field_name="qmd_scope_root",
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
                result = RepoSeedResult(
                    repo_id=str(
                        repo.get("repo_id") or repo.get("repo_name") or "unknown"
                    ),
                    repo_name=str(
                        repo.get("repo_name") or repo.get("repo_id") or "unknown"
                    ),
                    status="error",
                    source_root=(repo.get("existing_roots") or [None])[0],
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
            repo_index_entry["last_seeded_at"] = indexed_at if result.status == "seeded" else ""
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

        # Re-probe repository types and update manifest if classifications changed.
        self._update_manifest_repository_types(manifest_path, plan["repositories"])

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
        report["conventions_summary"] = (
            self._maybe_write_context_pack_conventions(
                context_pack_dir=context_pack_path,
                plan=plan,
                repositories=seeded_repositories,
                indexed_at=indexed_at,
            )
        )

        try:
            report["workspace_counts"] = analyze_workspace_counts(load_json(manifest_path))
        except Exception:  # noqa: BLE001
            logger.warning("workspace_analysis: failed to compute workspace counts", exc_info=True)
        if all_accumulated_records:
            self.qmd_index_service.warm_and_merge_records(
                scope_dir, all_accumulated_records,
            )

        report["index_outputs"] = self._write_scope_indexes(
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

        return report

    def _update_manifest_repository_types(
        self,
        manifest_path: Path,
        plan_repos: list[dict[str, Any]],
    ) -> None:
        """Re-probe repos and update manifest repository_type values.

        Only writes the manifest if at least one classification changed.
        """
        try:
            manifest = load_json(manifest_path)
            repositories = manifest.get("repositories")
            if not isinstance(repositories, list):
                return

            repo_roots_by_id: dict[str, str] = {}
            for plan_repo in plan_repos:
                roots = plan_repo.get("existing_roots", [])
                if roots:
                    repo_roots_by_id[plan_repo["repo_id"]] = roots[0]

            changed = False
            for repo in repositories:
                repo_id = repo.get("repo_id", "")
                root_path = repo_roots_by_id.get(repo_id)
                if not root_path:
                    continue
                probe = classify_repository_type(
                    Path(root_path),
                    languages=repo.get("languages"),
                    repo_name=repo.get("repo_name", repo_id),
                )
                new_type = probe["repository_type"]
                if repo.get("repository_type") != new_type:
                    repo["repository_type"] = new_type
                    changed = True

            if changed:
                self.write_json(manifest_path, manifest)
        except Exception:
            logging.getLogger(__name__).debug(
                "Failed to update manifest repository types during reseed",
                exc_info=True,
            )
