"""repo-context-mcp application runtime.

Thread safety is supported through explicit locks around shared service
initialization/caches and request-scoped context.
"""

from __future__ import annotations

import logging
import signal
import subprocess  # noqa: F401 — re-exported for test patching
import threading
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer as ThreadedServer
from pathlib import Path
from typing import Any

from .config import (
    REQUEST_ID_HEADER,
    RepoContextConfig,
    ServerConfig,
)
from .file_analysis import (
    detect_artifact_type,
    detect_path_kind,  # noqa: F401 - re-exported for helper tests and callers
    detect_source_ref,
    looks_like_entrypoint,  # noqa: F401 - re-exported for helper tests and callers
    normalize_language,  # noqa: F401 - re-exported for helper tests and callers
    normalize_repo_entry,
    read_preview,  # noqa: F401 - re-exported for helper tests and callers
    relative_source_path,
    run_git_command,  # noqa: F401 - re-exported for helper tests and callers
    unique_paths,  # noqa: F401 - re-exported for helper tests and callers
)
from .file_analysis import (
    iter_scan_files as _iter_scan_files,
)
from .record_factory import (
    build_bootstrap_note_markdown,
    build_repo_summary_markdown,
    create_artifact_record,
    create_bootstrap_note_record,
    create_summary_record,
    record_storage_path,
    report_file_path,
    sidecar_record_path,
    state_file_path,
    write_json,
    write_text,
)
from .record_factory import (
    invalidate_record as _invalidate_record,
)
from .services.archive_service import TaskArchiveService
from .services.carry_forward_service import CarryForwardService
from .services.conventions_service import (
    build_context_pack_conventions_markdown,
    create_context_pack_conventions_record,
    load_context_pack_conventions_summary,
    render_context_pack_conventions_summary,
)
from .services.correction_memo_service import (
    load_behavior_correction_memo,
    render_behavior_correction_memo,
)
from .services.discovery_service import (
    discover_backend_platform_signals,  # noqa: F401 - re-exported for helper tests and callers
    discover_frontend_surfaces,  # noqa: F401 - re-exported for helper tests and callers
)
from .services.lineage_service import LineageService
from .services.qmd_index_service import QmdIndexService
from .services.record_cache import ScopedRecordCache
from .services.report_service import ReportRenderer
from .services.seeding_service import SeedingService, SeedRuntimeState
from .transport.cli import RepoContextCli
from .transport.http import (
    RepoContextHttpHandler,
    active_context_pack_dir_from_env,
)
from .utils import resolve_request_id

logger = logging.getLogger(__name__)


SERVER_CONFIG = ServerConfig.from_env()
REPO_CONTEXT_CONFIG = RepoContextConfig.from_env()

DEFAULT_MANIFEST = REPO_CONTEXT_CONFIG.default_manifest
DEFAULT_PLAN_FILE = REPO_CONTEXT_CONFIG.default_plan_file
DEFAULT_GLOBAL_RETROSPECTIVE_ROOT = (
    REPO_CONTEXT_CONFIG.global_retrospective_root
)
DEFAULT_PORT = SERVER_CONFIG.port
DEFAULT_HOST = SERVER_CONFIG.host
DEFAULT_MAX_FILES_PER_REPO = REPO_CONTEXT_CONFIG.max_files_per_repo

REPORT_RENDERER = ReportRenderer()
RUNTIME_STATE = SeedRuntimeState()
_RECORD_CACHE = ScopedRecordCache(ttl_seconds=300.0)


def iter_scan_files(scan_targets: list[str]) -> tuple[list[Path], list[str]]:
    return _iter_scan_files(scan_targets, max_files_per_repo=DEFAULT_MAX_FILES_PER_REPO)


def invalidate_record(
    record_path: Path, indexed_at: str, reason: str,
) -> dict[str, Any] | None:
    return _invalidate_record(record_path, indexed_at, reason)


def create_seeding_service(
    workspace_root: Path | None = None,
) -> SeedingService:
    root = workspace_root or Path.cwd()
    return SeedingService(
        workspace_root=root,
        default_manifest=DEFAULT_MANIFEST,
        default_plan_file=DEFAULT_PLAN_FILE,
        normalize_repo_entry=normalize_repo_entry,
        detect_source_ref=detect_source_ref,
        iter_scan_files=iter_scan_files,
        relative_source_path=relative_source_path,
        detect_artifact_type=detect_artifact_type,
        record_storage_path=record_storage_path,
        sidecar_record_path=sidecar_record_path,
        state_file_path=state_file_path,
        report_file_path=report_file_path,
        write_json=write_json,
        write_text=write_text,
        invalidate_record=invalidate_record,
        create_artifact_record=create_artifact_record,
        create_summary_record=create_summary_record,
        create_bootstrap_note_record=create_bootstrap_note_record,
        build_repo_summary_markdown=build_repo_summary_markdown,
        build_bootstrap_note_markdown=build_bootstrap_note_markdown,
        build_context_pack_conventions_markdown=(
            build_context_pack_conventions_markdown
        ),
        create_context_pack_conventions_record=(
            create_context_pack_conventions_record
        ),
        qmd_index_service=get_qmd_index_service(),
        max_files_per_repo=DEFAULT_MAX_FILES_PER_REPO,
    )


_SEEDING_SERVICE: SeedingService | None = None
_SERVICE_INIT_LOCK = threading.RLock()


def get_seeding_service() -> SeedingService:
    global _SEEDING_SERVICE  # noqa: PLW0603
    with _SERVICE_INIT_LOCK:
        if _SEEDING_SERVICE is None:
            _SEEDING_SERVICE = create_seeding_service()
    return _SEEDING_SERVICE


_ARCHIVE_SERVICE: TaskArchiveService | None = None


def get_archive_service() -> TaskArchiveService:
    global _ARCHIVE_SERVICE  # noqa: PLW0603
    with _SERVICE_INIT_LOCK:
        if _ARCHIVE_SERVICE is None:
            _ARCHIVE_SERVICE = TaskArchiveService(
                workspace_root=Path.cwd(),
                render_lineage_summary=(
                    REPORT_RENDERER.render_task_lineage_summary
                ),
                global_retrospective_root=(
                    REPO_CONTEXT_CONFIG.global_retrospective_root
                ),
                record_cache=_RECORD_CACHE,
            )
    return _ARCHIVE_SERVICE


_QMD_INDEX_SERVICE: QmdIndexService | None = None


def get_qmd_index_service() -> QmdIndexService:
    global _QMD_INDEX_SERVICE  # noqa: PLW0603
    with _SERVICE_INIT_LOCK:
        if _QMD_INDEX_SERVICE is None:
            _QMD_INDEX_SERVICE = QmdIndexService(
                workspace_root=Path.cwd(),
                archive_service=get_archive_service(),
                global_retrospective_root=(
                    REPO_CONTEXT_CONFIG.global_retrospective_root
                ),
            )
    return _QMD_INDEX_SERVICE


_LINEAGE_SERVICE: LineageService | None = None


def get_lineage_service() -> LineageService:
    global _LINEAGE_SERVICE  # noqa: PLW0603
    with _SERVICE_INIT_LOCK:
        if _LINEAGE_SERVICE is None:
            qmd = get_qmd_index_service()
            _LINEAGE_SERVICE = LineageService(
                workspace_root=Path.cwd(),
                qmd_index_service=qmd,
                render_lineage_summary=(
                    REPORT_RENDERER.render_task_lineage_summary
                ),
            )
            qmd.set_lineage_service(_LINEAGE_SERVICE)
    return _LINEAGE_SERVICE


def create_cli() -> RepoContextCli:
    return RepoContextCli(
        default_host=DEFAULT_HOST,
        default_port=DEFAULT_PORT,
        default_manifest=DEFAULT_MANIFEST,
        default_plan_file=DEFAULT_PLAN_FILE,
        execute_seed_run=execute_seed_run,
        load_context_pack_conventions_summary=(
            load_context_pack_conventions_summary
        ),
        load_behavior_correction_memo_summary=(
            load_behavior_correction_memo
        ),
        build_carry_forward_summary=build_carry_forward_summary,
        build_task_lineage_summary=build_task_lineage_summary,
        render_context_pack_conventions_summary=(
            render_context_pack_conventions_summary
        ),
        render_behavior_correction_memo=(
            render_behavior_correction_memo
        ),
        render_run_markdown=render_run_markdown,
    )


def create_handler_class() -> type[BaseHTTPRequestHandler]:
    transport = RepoContextHttpHandler(
        workspace_root=Path.cwd(),
        request_id_header=REQUEST_ID_HEADER,
        auth_header=SERVER_CONFIG.auth_header,
        auth_token=SERVER_CONFIG.auth_token,
        default_port=DEFAULT_PORT,
        default_manifest=DEFAULT_MANIFEST,
        default_plan_file=DEFAULT_PLAN_FILE,
        max_request_bytes=SERVER_CONFIG.max_request_bytes,
        active_context_pack_dir=active_context_pack_dir_from_env,
        runtime_state=RUNTIME_STATE,
        execute_seed_run=execute_seed_run,
        resolve_seed_scope_key=resolve_seed_scope_key,
        load_context_pack_conventions_summary=(
            load_context_pack_conventions_summary
        ),
        load_behavior_correction_memo_summary=(
            load_behavior_correction_memo
        ),
        build_task_lineage_summary=build_task_lineage_summary,
        build_carry_forward_summary=build_carry_forward_summary,
        build_task_retrospective_summary=build_task_retrospective_summary,
        load_shared_retrospective_memory_summary=(
            load_shared_retrospective_memory_summary
        ),
        resolve_request_id=resolve_request_id,
        invalidate_cache=invalidate_all_caches,
    )
    return transport.make_handler_class()


def build_task_lineage_summary(
    *,
    context_pack_dir: str,
    qmd_scope: str,
    task_id: str | None = None,
    root_task_id: str | None = None,
) -> dict[str, Any]:
    return get_lineage_service().build_task_lineage_summary(
        context_pack_dir=context_pack_dir,
        qmd_scope=qmd_scope,
        task_id=task_id,
        root_task_id=root_task_id,
    )


def invalidate_all_caches(scope_dir: Path | None = None) -> dict[str, Any]:
    """Invalidate shared record, descriptor, and lineage caches.

    Delegates to QmdIndexService.invalidate_archive_cache which cascades
    through archive_service.invalidate_cache (record cache) and
    invalidate_descriptor_cache (descriptor + lineage caches).
    """
    get_qmd_index_service().invalidate_archive_cache(scope_dir)
    return {"status": "invalidated"}


def build_carry_forward_summary(
    *,
    context_pack_dir: str,
    parent_qmd_scope: str,
    parent_qmd_record_id: str | None = None,
    parent_task_id: str | None = None,
) -> dict[str, Any]:
    archive_service = get_archive_service()
    service = CarryForwardService(
        archive_service=archive_service,
        render_carry_forward_summary=(
            REPORT_RENDERER.render_carry_forward_summary
        ),
    )
    return service.build_summary(
        context_pack_dir=context_pack_dir,
        parent_qmd_scope=parent_qmd_scope,
        parent_qmd_record_id=parent_qmd_record_id,
        parent_task_id=parent_task_id,
    )


def build_task_retrospective_summary(
    *,
    context_pack_dir: str,
    qmd_scope: str,
    task_id: str,
) -> dict[str, Any]:
    service = get_archive_service()
    summary = service.build_task_retrospective_summary(
        context_pack_dir=context_pack_dir,
        qmd_scope=qmd_scope,
        task_id=task_id,
    )
    summary["rendered_summary_markdown"] = (
        REPORT_RENDERER.render_task_retrospective_summary(summary)
    )
    return summary


def load_shared_retrospective_memory_summary() -> dict[str, Any]:
    service = get_archive_service()
    summary = service.load_shared_retrospective_memory()
    summary["rendered_summary_markdown"] = (
        REPORT_RENDERER.render_shared_retrospective_memory(summary)
    )
    return summary


def execute_seed_run(
    context_pack_dir: str,
    manifest: str = DEFAULT_MANIFEST,
    plan_file: str = DEFAULT_PLAN_FILE,
    plan_mode: str = "prefer-plan",
    write_report: bool = True,
) -> dict[str, Any]:
    return get_seeding_service().execute_seed_run(
        context_pack_dir=context_pack_dir,
        manifest=manifest,
        plan_file=plan_file,
        plan_mode=plan_mode,
        write_report=write_report,
    )


def resolve_seed_scope_key(
    context_pack_dir: str,
    manifest: str = DEFAULT_MANIFEST,
    plan_file: str = DEFAULT_PLAN_FILE,
    plan_mode: str = "prefer-plan",
) -> str:
    return get_seeding_service().resolve_seed_scope_key(
        context_pack_dir=context_pack_dir,
        manifest=manifest,
        plan_file=plan_file,
        plan_mode=plan_mode,
    )


def render_run_markdown(report: dict[str, Any]) -> str:
    return REPORT_RENDERER.render_run_markdown(report)


Handler = create_handler_class()


def parse_args(argv: list[str] | None = None):
    return create_cli().parse_args(argv)


def run_server(host: str, port: int) -> int:
    logging.basicConfig(
        level=getattr(logging, SERVER_CONFIG.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    server = ThreadedServer((host, port), Handler)

    shutdown_event = threading.Event()
    received_signal: list[int] = []

    def _request_shutdown(signum: int, _frame: object) -> None:
        received_signal.append(signum)
        shutdown_event.set()

    def _shutdown_worker() -> None:
        shutdown_event.wait()
        server.shutdown()

    shutdown_thread = threading.Thread(
        target=_shutdown_worker, name="shutdown-worker", daemon=True,
    )
    shutdown_thread.start()

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    logger.info("repo-context-mcp listening on %s:%d", host, port)
    server.serve_forever()

    if received_signal:
        sig_name = signal.Signals(received_signal[0]).name
        logger.info("Received %s — server stopped, cleaning up", sig_name)
    else:
        logger.info("Server stopped — cleaning up")
    released = RUNTIME_STATE.force_release_if_held()
    if released:
        logger.warning("Seed lock was held at shutdown — released during cleanup")
    server.server_close()
    logger.info("Graceful shutdown complete")
    return 0


def main(argv: list[str] | None = None) -> int:
    return create_cli().run(argv, run_server)


if __name__ == "__main__":
    raise SystemExit(main())
