from __future__ import annotations

import json
import logging
import os
import re
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from ..config import (
    TASKSAIL_CONTEXT_PACK_DIR_HEADER,
    TASKSAIL_TASK_ID_HEADER,
    RequestScope,
)
from ..utils import (
    attach_request_id,
    ensure_non_empty_string,
    normalize_optional_string,
    resolve_context_pack_dir,
    resolve_path_within,
)

logger = logging.getLogger("repo-context-mcp")
TASK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class RepoContextHttpHandler:
    def __init__(
        self,
        *,
        workspace_root: Path,
        request_id_header: str,
        auth_header: str,
        auth_token: str,
        default_port: int,
        default_manifest: str,
        default_plan_file: str,
        max_request_bytes: int,
        active_context_pack_dir: Callable[[], str],
        runtime_state: Any,
        execute_seed_run: Callable[..., dict[str, Any]],
        resolve_seed_scope_key: Callable[..., str] | None = None,
        build_task_lineage_summary: Callable[..., dict[str, Any]],
        build_carry_forward_summary: Callable[..., dict[str, Any]],
        load_context_pack_conventions_summary: (
            Callable[..., dict[str, Any]] | None
        ) = None,
        load_behavior_correction_memo_summary: (
            Callable[..., dict[str, Any]] | None
        ) = None,
        build_task_retrospective_summary: (
            Callable[..., dict[str, Any]] | None
        ) = None,
        load_shared_retrospective_memory_summary: (
            Callable[[], dict[str, Any]] | None
        ) = None,
        resolve_request_id: Callable[[Any], str],
        invalidate_cache: Callable[..., dict[str, Any]] | None = None,
    ) -> None:
        self.workspace_root = workspace_root.resolve()
        self.request_id_header = request_id_header
        self.auth_header = auth_header
        self.auth_token = auth_token
        self.default_port = default_port
        self.default_manifest = default_manifest
        self.default_plan_file = default_plan_file
        self.max_request_bytes = max_request_bytes
        self.active_context_pack_dir = active_context_pack_dir
        self.runtime_state = runtime_state
        self.execute_seed_run = execute_seed_run
        self.resolve_seed_scope_key = resolve_seed_scope_key or (
            lambda **kwargs: kwargs["context_pack_dir"]
        )
        self.load_context_pack_conventions_summary = (
            load_context_pack_conventions_summary
            or (lambda **_: {"conventions_summary_status": "deferred"})
        )
        self.load_behavior_correction_memo_summary = (
            load_behavior_correction_memo_summary
            or (lambda **_: {"corrections_status": "deferred"})
        )
        self.build_task_lineage_summary = build_task_lineage_summary
        self.build_carry_forward_summary = build_carry_forward_summary
        self.build_task_retrospective_summary = (
            build_task_retrospective_summary
            or (lambda **_: {"summary": "retrospective"})
        )
        self.load_shared_retrospective_memory_summary = (
            load_shared_retrospective_memory_summary
            or (lambda: {"summary": "shared-retrospective-memory"})
        )
        self.resolve_request_id = resolve_request_id
        self.invalidate_cache = invalidate_cache

    def normalize_context_pack_dir(self, value: str) -> str:
        return str(
            resolve_context_pack_dir(
                self.workspace_root,
                value,
            )
        )

    def normalize_context_pack_relative_path(
        self,
        *,
        context_pack_dir: str,
        value: str,
        field_name: str,
    ) -> str:
        context_pack_path = Path(context_pack_dir).resolve()
        resolved = resolve_path_within(context_pack_path, value, field_name)
        return resolved.relative_to(context_pack_path).as_posix()

    def make_handler_class(self) -> type[BaseHTTPRequestHandler]:
        runtime = self

        class Handler(BaseHTTPRequestHandler):
            def _write(
                self,
                status: int,
                body: bytes,
                content_type: str,
                request_id: str,
            ) -> None:
                self.send_response(status)
                self.send_header(runtime.request_id_header, request_id)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _write_json(
                self,
                status: int,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                body = json.dumps(
                    attach_request_id(payload, request_id),
                    separators=(",", ":"),
                    sort_keys=False,
                ).encode("utf-8")
                self._write(
                    status,
                    body,
                    "application/json; charset=utf-8",
                    request_id,
                )

            def _payload_value(
                self,
                payload_or_query: dict[str, Any],
                field_name: str,
            ) -> str:
                value = payload_or_query.get(field_name)
                if isinstance(value, list):
                    value = value[0] if value else ""
                return normalize_optional_string(value)

            def _request_scope(
                self,
                payload_or_query: dict[str, Any],
            ) -> RequestScope:
                header_context_pack_dir = normalize_optional_string(
                    self.headers.get(TASKSAIL_CONTEXT_PACK_DIR_HEADER)
                )
                field_context_pack_dir = self._payload_value(
                    payload_or_query,
                    "context_pack_dir",
                )
                if header_context_pack_dir:
                    source = "header"
                    raw_context_pack_dir = header_context_pack_dir
                elif field_context_pack_dir:
                    source = "body"
                    raw_context_pack_dir = field_context_pack_dir
                else:
                    source = "env"
                    raw_context_pack_dir = runtime.active_context_pack_dir()

                context_pack_dir = runtime.normalize_context_pack_dir(
                    ensure_non_empty_string(
                        raw_context_pack_dir,
                        "context_pack_dir",
                    )
                )

                task_id = (
                    normalize_optional_string(
                        self.headers.get(TASKSAIL_TASK_ID_HEADER)
                    )
                    or self._payload_value(payload_or_query, "task_id")
                )
                if task_id and TASK_ID_RE.fullmatch(task_id) is None:
                    raise ValueError(
                        "Field 'task_id' must match "
                        "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
                    )

                return RequestScope(
                    task_id=task_id,
                    context_pack_dir=context_pack_dir,
                    source=source,
                )

            def do_GET(self) -> None:  # noqa: N802
                request_id = runtime.resolve_request_id(self.headers)
                parsed = urlparse(self.path)
                if parsed.path == "/health":
                    self._write(
                        200,
                        b"ok",
                        "text/plain; charset=utf-8",
                        request_id,
                    )
                    return

                if parsed.path == "/sse":
                    payload = (
                        b"event: ready\n"
                        b"data: repo-context-mcp live seed ready\n\n"
                    )
                    self._write(
                        200,
                        payload,
                        "text/event-stream; charset=utf-8",
                        request_id,
                    )
                    return

                if parsed.path == "/status":
                    self._write_json(
                        200,
                        {
                            "service": "repo-context-mcp",
                            "status": "ready",
                            "host_access": (
                                f"http://localhost:{runtime.default_port}"
                            ),
                            "container_access": (
                                "http://repo-context-mcp:"
                                f"{runtime.default_port}"
                            ),
                            "latest_run": (
                                runtime.runtime_state.snapshot().latest_run
                            ),
                            "security": {
                                "post_routes_require_token": bool(
                                    runtime.auth_token
                                ),
                                "auth_header": runtime.auth_header,
                                "max_request_bytes": runtime.max_request_bytes,
                            },
                            "capabilities": [
                                "health",
                                "ready",
                                "status",
                                "capabilities",
                                "live-qmd-seeding",
                                "parent-archive-carry-forward",
                                "task-archive-lineage",
                                "context-pack-conventions-summary",
                                "task-retrospective-retrieval",
                                "shared-retrospective-memory",
                                "behavior-corrections",
                                "invalidate-cache",
                            ],
                        },
                        request_id,
                    )
                    return

                if parsed.path == "/shared-retrospective-memory":
                    try:
                        summary = (
                            runtime.load_shared_retrospective_memory_summary()
                        )
                    except ValueError as exc:
                        self._write_json(400, {"error": str(exc)}, request_id)
                        return
                    except Exception as exc:  # noqa: BLE001
                        self._write_json(500, {"error": str(exc)}, request_id)
                        return

                    self._write_json(200, summary, request_id)
                    return

                if parsed.path == "/context-pack-conventions":
                    try:
                        query = parse_qs(parsed.query)
                        scope = self._request_scope(query)
                        summary = (
                            runtime.load_context_pack_conventions_summary(
                                context_pack_dir=scope.context_pack_dir,
                            )
                        )
                    except ValueError as exc:
                        self._write_json(400, {"error": str(exc)}, request_id)
                        return
                    except Exception as exc:  # noqa: BLE001
                        self._write_json(500, {"error": str(exc)}, request_id)
                        return

                    self._write_json(200, summary, request_id)
                    return

                if parsed.path == "/behavior-corrections":
                    try:
                        query = parse_qs(parsed.query)
                        scope = self._request_scope(query)
                        summary = (
                            runtime.load_behavior_correction_memo_summary(
                                context_pack_dir=scope.context_pack_dir,
                            )
                        )
                    except ValueError as exc:
                        self._write_json(400, {"error": str(exc)}, request_id)
                        return
                    except Exception as exc:  # noqa: BLE001
                        self._write_json(500, {"error": str(exc)}, request_id)
                        return

                    self._write_json(200, summary, request_id)
                    return

                if parsed.path == "/capabilities":
                    self._write_json(
                        200,
                        {
                            "service": "repo-context-mcp",
                            "status": "ready",
                            "capabilities": [
                                "health",
                                "ready",
                                "status",
                                "capabilities",
                                "live-qmd-seeding",
                                "parent-archive-carry-forward",
                                "task-archive-lineage",
                                "context-pack-conventions-summary",
                                "task-retrospective-retrieval",
                                "shared-retrospective-memory",
                                "behavior-corrections",
                                "invalidate-cache",
                            ],
                        },
                        request_id,
                    )
                    return

                logger.warning("Unknown GET path: %s", parsed.path)
                self._write_json(
                    404,
                    {"error": f"Unknown GET path: {parsed.path}"},
                    request_id,
                )

            def _authorize_post(self, request_id: str) -> bool:
                if not runtime.auth_token:
                    self._write_json(
                        503,
                        {
                            "error": (
                                "repo-context POST routes are disabled until "
                                "REPO_CONTEXT_MCP_AUTH_TOKEN is configured"
                            )
                        },
                        request_id,
                    )
                    return False

                provided_token = str(
                    self.headers.get(runtime.auth_header, "") or ""
                ).strip()
                authorization = str(
                    self.headers.get("Authorization", "") or ""
                ).strip()
                if not provided_token and authorization.lower().startswith(
                    "bearer "
                ):
                    provided_token = authorization[7:].strip()

                if not provided_token or not compare_digest(
                    provided_token,
                    runtime.auth_token,
                ):
                    logger.warning(
                        "Auth failed from %s: missing or invalid token",
                        self.client_address,
                    )
                    self._write_json(
                        401,
                        {
                            "error": (
                                "missing or invalid repo-context auth token"
                            )
                        },
                        request_id,
                    )
                    return False
                return True

            def do_POST(self) -> None:  # noqa: N802
                request_id = runtime.resolve_request_id(self.headers)
                try:
                    self._dispatch_post(request_id)
                except BaseException:
                    try:
                        self._write_json(
                            500,
                            {"error": "internal server error"},
                            request_id,
                        )
                    except Exception:  # noqa: BLE001
                        logger.debug("Failed to send 500 error response for request %s", request_id, exc_info=True)
                    raise

            def _dispatch_post(
                self,
                request_id: str,
            ) -> None:
                parsed = urlparse(self.path)
                if parsed.path not in {
                    "/seed",
                    "/carry-forward",
                    "/lineage",
                    "/retrospective",
                    "/invalidate-cache",
                }:
                    logger.warning("Unknown POST endpoint: %s", parsed.path)
                    self._write_json(
                        404,
                        {"error": "unknown endpoint"},
                        request_id,
                    )
                    return

                if not self._authorize_post(request_id):
                    return

                try:
                    content_length = int(
                        self.headers.get("Content-Length", "0")
                    )
                except ValueError:
                    self._write_json(
                        400,
                        {"error": "invalid content length"},
                        request_id,
                    )
                    return

                if content_length < 0:
                    self._write_json(
                        400,
                        {"error": "invalid content length"},
                        request_id,
                    )
                    return

                if content_length > runtime.max_request_bytes:
                    self._write_json(
                        413,
                        {
                            "error": (
                                "request body exceeds repo-context limit of "
                                f"{runtime.max_request_bytes} bytes"
                            )
                        },
                        request_id,
                    )
                    return

                try:
                    payload = json.loads(
                        self.rfile.read(content_length) or b"{}"
                    )
                except json.JSONDecodeError as exc:
                    self._write_json(
                        400,
                        {"error": f"invalid json: {exc}"},
                        request_id,
                    )
                    return

                if parsed.path == "/seed":
                    self._handle_seed(payload, request_id)
                    return

                if parsed.path == "/lineage":
                    self._handle_lineage(payload, request_id)
                    return

                if parsed.path == "/retrospective":
                    self._handle_retrospective(payload, request_id)
                    return

                if parsed.path == "/invalidate-cache":
                    self._handle_invalidate_cache(payload, request_id)
                    return

                self._handle_carry_forward(payload, request_id)

            def _handle_seed(
                self,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                seed_scope_key = ""
                seed_lock_acquired = False
                try:
                    scope = self._request_scope(payload)
                    context_pack_dir = scope.context_pack_dir
                    manifest = runtime.normalize_context_pack_relative_path(
                        context_pack_dir=context_pack_dir,
                        value=ensure_non_empty_string(
                            payload.get("manifest")
                            or runtime.default_manifest,
                            "manifest",
                        ),
                        field_name="manifest",
                    )
                    plan_file = runtime.normalize_context_pack_relative_path(
                        context_pack_dir=context_pack_dir,
                        value=ensure_non_empty_string(
                            payload.get("plan_file")
                            or runtime.default_plan_file,
                            "plan_file",
                        ),
                        field_name="plan_file",
                    )
                    plan_mode = str(payload.get("plan_mode") or "prefer-plan")
                    seed_scope_key = runtime.resolve_seed_scope_key(
                        context_pack_dir=context_pack_dir,
                        manifest=manifest,
                        plan_file=plan_file,
                        plan_mode=plan_mode,
                    )
                    if not runtime.runtime_state.acquire_seed_run(seed_scope_key):
                        self._write_json(
                            409,
                            {"error": "a seed run is already in progress"},
                            request_id,
                        )
                        return
                    seed_lock_acquired = True
                    report = runtime.execute_seed_run(
                        context_pack_dir=context_pack_dir,
                        manifest=manifest,
                        plan_file=plan_file,
                        plan_mode=plan_mode,
                        write_report=bool(payload.get("write_report", True)),
                    )
                except ValueError as exc:
                    logger.error("Seed failed: %s — %s", request_id, exc)
                    self._write_json(400, {"error": str(exc)}, request_id)
                    return
                except Exception as exc:  # noqa: BLE001
                    logger.error("Seed failed: %s — %s", request_id, exc)
                    self._write_json(500, {"error": str(exc)}, request_id)
                    return
                finally:
                    if seed_lock_acquired:
                        runtime.runtime_state.release_seed_run(seed_scope_key)

                runtime.runtime_state.set_latest_run(report)
                logger.info("Seed completed: %s", request_id)
                self._write_json(200, report, request_id)

            def _handle_lineage(
                self,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                try:
                    scope = self._request_scope(payload)
                    context_pack_dir = scope.context_pack_dir
                    qmd_scope = runtime.normalize_context_pack_relative_path(
                        context_pack_dir=context_pack_dir,
                        value=ensure_non_empty_string(
                            payload.get("qmd_scope"),
                            "qmd_scope",
                        ),
                        field_name="qmd_scope",
                    )
                    summary = runtime.build_task_lineage_summary(
                        context_pack_dir=context_pack_dir,
                        qmd_scope=qmd_scope,
                        task_id=(
                            scope.task_id
                            or None
                        ),
                        root_task_id=(
                            normalize_optional_string(
                                payload.get("root_task_id")
                            )
                            or None
                        ),
                    )
                except ValueError as exc:
                    self._write_json(400, {"error": str(exc)}, request_id)
                    return
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": str(exc)}, request_id)
                    return

                self._write_json(200, summary, request_id)

            def _handle_carry_forward(
                self,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                try:
                    scope = self._request_scope(payload)
                    context_pack_dir = scope.context_pack_dir
                    parent_qmd_scope = (
                        runtime.normalize_context_pack_relative_path(
                            context_pack_dir=context_pack_dir,
                            value=ensure_non_empty_string(
                                payload.get("parent_qmd_scope"),
                                "parent_qmd_scope",
                            ),
                            field_name="parent_qmd_scope",
                        )
                    )
                    summary = runtime.build_carry_forward_summary(
                        context_pack_dir=context_pack_dir,
                        parent_qmd_scope=parent_qmd_scope,
                        parent_qmd_record_id=(
                            str(
                                payload.get("parent_qmd_record_id") or ""
                            ).strip()
                            or None
                        ),
                        parent_task_id=(
                            str(payload.get("parent_task_id") or "").strip()
                            or None
                        ),
                    )
                except ValueError as exc:
                    self._write_json(400, {"error": str(exc)}, request_id)
                    return
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": str(exc)}, request_id)
                    return

                self._write_json(200, summary, request_id)

            def _handle_retrospective(
                self,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                try:
                    scope = self._request_scope(payload)
                    context_pack_dir = scope.context_pack_dir
                    qmd_scope = runtime.normalize_context_pack_relative_path(
                        context_pack_dir=context_pack_dir,
                        value=ensure_non_empty_string(
                            payload.get("qmd_scope"),
                            "qmd_scope",
                        ),
                        field_name="qmd_scope",
                    )
                    task_id = ensure_non_empty_string(
                        scope.task_id,
                        "task_id",
                    )
                    summary = runtime.build_task_retrospective_summary(
                        context_pack_dir=context_pack_dir,
                        qmd_scope=qmd_scope,
                        task_id=task_id,
                    )
                except ValueError as exc:
                    self._write_json(400, {"error": str(exc)}, request_id)
                    return
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": str(exc)}, request_id)
                    return

                self._write_json(200, summary, request_id)

            def _handle_invalidate_cache(
                self,
                payload: dict[str, Any],
                request_id: str,
            ) -> None:
                if runtime.invalidate_cache is None:
                    self._write_json(
                        501,
                        {"error": "cache invalidation not configured"},
                        request_id,
                    )
                    return
                try:
                    scope_dir_raw = normalize_optional_string(
                        payload.get("scope_dir")
                    )
                    scope_dir: Path | None = None
                    if scope_dir_raw:
                        scope_dir = resolve_path_within(
                            runtime.workspace_root,
                            scope_dir_raw,
                            "scope_dir",
                        )
                    result = runtime.invalidate_cache(scope_dir)
                except ValueError as exc:
                    self._write_json(400, {"error": str(exc)}, request_id)
                    return
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": str(exc)}, request_id)
                    return

                self._write_json(200, result, request_id)

            def log_message(self, format: str, *args) -> None:  # noqa: A003
                logger.debug(format, *args)

        return Handler


def active_context_pack_dir_from_env() -> str:
    return os.getenv("ACTIVE_CONTEXT_PACK_DIR", "")
