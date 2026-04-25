from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.backend.mcp.repo_context_mcp.transport.http import RepoContextHttpHandler
from src.backend.mcp.repo_context_mcp.utils import compact_list
from tests.support.http_handler_harness import Response, call


class _RuntimeSnapshot:
    def __init__(self, latest_run: dict[str, object] | None = None) -> None:
        self.latest_run = latest_run


class _RuntimeStateStub:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.locked = False
        self.latest_run: dict[str, object] | None = None
        self.set_calls: list[dict[str, object]] = []
        self.released = 0

    def acquire_seed_run(self) -> bool:
        if self.locked:
            return False
        self.locked = True
        return True

    def release_seed_run(self) -> None:
        self.locked = False
        self.released += 1

    def set_latest_run(self, report: dict[str, object]) -> None:
        self.latest_run = report
        self.set_calls.append(report)

    def snapshot(self) -> _RuntimeSnapshot:
        return _RuntimeSnapshot(self.latest_run)


class _MutableCallbacks:
    """Per-test callback container for the shared handler class.

    Each test reconfigures only the callbacks it needs; reset() restores
    defaults for the next test. The handler class captures these via
    lambda indirection so swaps take effect without rebuilding the class.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.execute_seed_run = lambda **_: {
            "service": "repo-context-mcp",
            "status": "seeded",
        }
        self.load_context_pack_conventions_summary = lambda **_: {
            "conventions_summary_status": "deferred"
        }
        self.build_task_lineage_summary = lambda **_: {
            "summary": "lineage"
        }
        self.build_carry_forward_summary = lambda **_: {
            "summary": "carry-forward"
        }
        self.build_task_retrospective_summary = lambda **_: {
            "summary": "retrospective"
        }
        self.load_shared_retrospective_memory_summary = lambda: {
            "summary": "shared-retrospective-memory"
        }
        self.active_context_pack_dir = lambda: "/workspace/context-pack"


class RepoContextHttpTransportTests(unittest.TestCase):
    # --------------------------------------------------------------------------
    # WHY IN-PROCESS HANDLER CALLS:
    #
    # The handler class produced by RepoContextHttpHandler.make_handler_class()
    # inherits from BaseHTTPRequestHandler, which reads/writes via rfile/wfile.
    # By supplying BytesIO-backed _FakeSocket objects we invoke the full
    # handler pipeline — request parsing, routing, auth, path validation,
    # response serialization — without binding a port, spawning a thread, or
    # making a TCP connection.
    #
    # _MutableCallbacks allows per-test callback reconfiguration.
    # _RuntimeStateStub.reset() clears counters so tests stay isolated.
    # --------------------------------------------------------------------------

    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls._temp_dir = tempfile.TemporaryDirectory()
        cls._workspace_root = Path(cls._temp_dir.name)
        cls._callbacks = _MutableCallbacks()
        cls._runtime = _RuntimeStateStub()

        cbs = cls._callbacks
        transport = RepoContextHttpHandler(
            workspace_root=cls._workspace_root,
            request_id_header="X-Request-ID",
            auth_header="X-Repo-Context-Token",
            auth_token="test-token",
            default_port=8811,
            default_manifest="qmd/repo-sources.json",
            default_plan_file="qmd/bootstrap/seed-plan.json",
            max_request_bytes=2048,
            # Lambda indirection: evaluated at request time, so swapping
            # cbs attributes between tests takes effect without
            # rebuilding the handler class.
            active_context_pack_dir=lambda: cbs.active_context_pack_dir(),
            runtime_state=cls._runtime,
            execute_seed_run=lambda **kw: cbs.execute_seed_run(**kw),
            load_context_pack_conventions_summary=(
                lambda **kw: cbs.load_context_pack_conventions_summary(**kw)
            ),
            build_task_lineage_summary=(
                lambda **kw: cbs.build_task_lineage_summary(**kw)
            ),
            build_carry_forward_summary=(
                lambda **kw: cbs.build_carry_forward_summary(**kw)
            ),
            build_task_retrospective_summary=(
                lambda **kw: cbs.build_task_retrospective_summary(**kw)
            ),
            load_shared_retrospective_memory_summary=(
                lambda: cbs.load_shared_retrospective_memory_summary()
            ),
            resolve_request_id=(
                lambda headers: headers.get("X-Request-ID") or "req-test-123"
            ),
        )
        cls._handler_class = transport.make_handler_class()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._temp_dir.cleanup()

    def setUp(self) -> None:
        self._callbacks.reset()
        self._runtime.reset()

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response:
        return call(self._handler_class, method, path, body=body, headers=headers)

    @staticmethod
    def post_headers(
        *,
        request_id: str | None = None,
        auth_token: str = "test-token",
    ) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "X-Repo-Context-Token": auth_token,
        }
        if request_id is not None:
            headers["X-Request-ID"] = request_id
        return headers

    def test_get_routes_expose_health_sse_status_and_root_capabilities(
        self,
    ) -> None:
        self._runtime.latest_run = {"status": "ready"}

        health = self._request(
            "GET", "/health", headers={"X-Request-ID": "req-health"}
        )
        self.assertEqual(health.text(), "ok")
        self.assertEqual(health.headers.get("X-Request-ID"), "req-health")

        sse = self._request("GET", "/sse")
        self.assertEqual(
            sse.headers.get_content_type(),
            "text/event-stream",
        )
        self.assertIn("event: ready", sse.text())

        status = self._request("GET", "/status")
        status_payload = status.json()
        self.assertEqual(status_payload["latest_run"], {"status": "ready"})
        self.assertIn("task-archive-lineage", status_payload["capabilities"])
        self.assertIn(
            "task-retrospective-retrieval",
            status_payload["capabilities"],
        )
        self.assertIn(
            "context-pack-conventions-summary",
            status_payload["capabilities"],
        )

        # Unknown GET paths return 404
        not_found = self._request("GET", "/nonexistent")
        self.assertEqual(not_found.status, 404)
        error_payload = not_found.json()
        self.assertIn("/nonexistent", error_payload["error"])

        # Explicit /capabilities route returns 200 with capabilities list
        caps = self._request("GET", "/capabilities")
        caps_payload = caps.json()
        self.assertIn("live-qmd-seeding", caps_payload["capabilities"])
        self.assertIn(
            "shared-retrospective-memory",
            caps_payload["capabilities"],
        )
        self.assertIn(
            "context-pack-conventions-summary",
            caps_payload["capabilities"],
        )

    def test_seed_route_rejects_invalid_json_and_missing_context_pack(
        self,
    ) -> None:
        invalid_json = self._request(
            "POST", "/seed", body=b"{", headers=self.post_headers()
        )
        self.assertEqual(invalid_json.status, 400)
        self.assertIn("invalid json", invalid_json.json()["error"])

        # Swap callback to return empty string, triggering missing-context
        # validation without needing a separate handler class.
        self._callbacks.active_context_pack_dir = lambda: ""
        missing_context = self._request(
            "POST", "/seed", body=b"{}", headers=self.post_headers()
        )
        self.assertEqual(missing_context.status, 400)
        self.assertIn("context_pack_dir", missing_context.json()["error"])

    def test_seed_route_sets_latest_run_and_releases_runtime_lock(
        self,
    ) -> None:
        observed: dict[str, object] = {}

        def execute_seed_run(**kwargs):
            observed.update(kwargs)
            return {
                "service": "repo-context-mcp",
                "status": "seeded",
                "context_pack_dir": kwargs["context_pack_dir"],
            }

        self._callbacks.execute_seed_run = execute_seed_run
        resp = self._request(
            "POST",
            "/seed",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "manifest": "qmd/custom-manifest.json",
                    "plan_file": "qmd/custom-plan.json",
                    "plan_mode": "write-plan",
                    "write_report": False,
                }
            ).encode("utf-8"),
            headers=self.post_headers(request_id="req-seed"),
        )

        payload = resp.json()
        self.assertEqual(payload["status"], "seeded")
        self.assertEqual(payload["request_id"], "req-seed")
        self.assertEqual(
            observed["context_pack_dir"],
            "/workspace/context-pack",
        )
        self.assertEqual(observed["manifest"], "qmd/custom-manifest.json")
        self.assertEqual(observed["plan_file"], "qmd/custom-plan.json")
        self.assertEqual(observed["plan_mode"], "write-plan")
        self.assertFalse(observed["write_report"])
        self.assertEqual(
            self._runtime.latest_run,
            {
                "service": "repo-context-mcp",
                "status": "seeded",
                "context_pack_dir": "/workspace/context-pack",
            },
        )
        self.assertEqual(self._runtime.released, 1)

    def test_seed_route_reports_runtime_conflict_and_server_error(
        self,
    ) -> None:
        # Part 1: Pre-lock the shared runtime to simulate a conflict (409).
        self._runtime.locked = True
        conflict = self._request(
            "POST", "/seed", body=b"{}", headers=self.post_headers()
        )
        self.assertEqual(conflict.status, 409)

        # Part 2: Unlock, swap in a failing callback, verify 500 + release.
        self._runtime.locked = False
        self._runtime.released = 0
        self._callbacks.execute_seed_run = lambda **_: (
            _ for _ in ()
        ).throw(RuntimeError("seed exploded"))

        error_resp = self._request(
            "POST",
            "/seed",
            body=json.dumps(
                {"context_pack_dir": "/workspace/context-pack"}
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(error_resp.status, 500)
        self.assertIn("seed exploded", error_resp.text())
        self.assertEqual(self._runtime.released, 1)

    def test_lineage_and_carry_forward_routes_cover_validation(self) -> None:
        lineage_calls: list[dict[str, object]] = []
        carry_forward_calls: list[dict[str, object]] = []

        self._callbacks.build_task_lineage_summary = lambda **kwargs: (
            lineage_calls.append(kwargs)
            or {"lineage": kwargs["task_id"] or kwargs["root_task_id"]}
        )
        self._callbacks.build_carry_forward_summary = lambda **kwargs: (
            carry_forward_calls.append(kwargs)
            or {"carry_forward": kwargs["parent_task_id"]}
        )

        lineage = self._request(
            "POST",
            "/lineage",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "qmd_scope": "qmd/context-packs/sample-org",
                    "task_id": "CAP-1001",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(lineage.json()["lineage"], "CAP-1001")
        self.assertEqual(
            lineage_calls[0]["qmd_scope"],
            "qmd/context-packs/sample-org",
        )

        carry_forward = self._request(
            "POST",
            "/carry-forward",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "parent_qmd_scope": "qmd/context-packs/sample-org",
                    "parent_task_id": "CAP-1001",
                    "parent_qmd_record_id": "task:platform:CAP-1001",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(
            carry_forward.json()["carry_forward"], "CAP-1001"
        )
        self.assertEqual(
            carry_forward_calls[0]["parent_qmd_record_id"],
            "task:platform:CAP-1001",
        )

        # Missing required fields → 400
        bad_lineage = self._request(
            "POST",
            "/lineage",
            body=json.dumps(
                {"context_pack_dir": "/workspace/context-pack"}
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(bad_lineage.status, 400)

        # Swap carry-forward to a failing callback to verify 500 handling.
        self._callbacks.build_carry_forward_summary = lambda **_: (
            _ for _ in ()
        ).throw(RuntimeError("carry forward failure"))

        carry_error = self._request(
            "POST",
            "/carry-forward",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "parent_qmd_scope": "qmd/context-packs/sample-org",
                    "parent_task_id": "CAP-1001",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(carry_error.status, 500)

    def test_post_routes_require_auth_and_reject_path_escape(self) -> None:
        no_auth = self._request(
            "POST",
            "/seed",
            body=json.dumps(
                {"context_pack_dir": "context-pack"}
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(no_auth.status, 401)

        path_escape = self._request(
            "POST",
            "/lineage",
            body=json.dumps(
                {
                    "context_pack_dir": "../escape",
                    "qmd_scope": "qmd/context-packs/sample-org",
                    "task_id": "CAP-1001",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(path_escape.status, 400)
        self.assertIn("context_pack_dir", path_escape.json()["error"])

    def test_post_routes_enforce_request_size_limits(self) -> None:
        oversized_body = json.dumps(
            {"context_pack_dir": "context-pack", "padding": "x" * 5000}
        ).encode("utf-8")

        oversized = self._request(
            "POST",
            "/seed",
            body=oversized_body,
            headers=self.post_headers(),
        )
        self.assertEqual(oversized.status, 413)

    def test_retrospective_and_shared_memory_routes_return_expected_payloads(
        self,
    ) -> None:
        retrospective_calls: list[dict[str, object]] = []

        self._callbacks.build_task_retrospective_summary = (
            lambda **kwargs: (
                retrospective_calls.append(kwargs)
                or {"task_id": kwargs["task_id"]}
            )
        )
        self._callbacks.load_shared_retrospective_memory_summary = lambda: {
            "synthesized_from_task_ids": ["CAP-1001"]
        }

        retrospective = self._request(
            "POST",
            "/retrospective",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "qmd_scope": "qmd/context-packs/sample-org",
                    "task_id": "CAP-1001",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(retrospective.json()["task_id"], "CAP-1001")
        self.assertEqual(
            retrospective_calls[0]["qmd_scope"],
            "qmd/context-packs/sample-org",
        )

        shared = self._request("GET", "/shared-retrospective-memory")
        self.assertEqual(
            shared.json()["synthesized_from_task_ids"],
            ["CAP-1001"],
        )

    def test_context_pack_conventions_route_returns_summary_payload(
        self,
    ) -> None:
        convention_calls: list[dict[str, object]] = []

        self._callbacks.load_context_pack_conventions_summary = (
            lambda **kwargs: (
                convention_calls.append(kwargs)
                or {
                    "conventions_summary_status": "available",
                    "context_pack_dir": kwargs["context_pack_dir"],
                }
            )
        )

        resp = self._request(
            "GET",
            "/context-pack-conventions?context_pack_dir=/workspace/context-pack",
        )
        payload = resp.json()
        self.assertEqual(payload["conventions_summary_status"], "available")
        self.assertEqual(
            convention_calls[0]["context_pack_dir"],
            "/workspace/context-pack",
        )

    def test_context_pack_conventions_route_rejects_missing_context_pack(
        self,
    ) -> None:
        self._callbacks.active_context_pack_dir = lambda: ""

        resp = self._request("GET", "/context-pack-conventions")
        self.assertEqual(resp.status, 400)
        self.assertIn("context_pack_dir", resp.json()["error"])

    def test_json_responses_use_compact_format(self) -> None:
        resp = self._request("GET", "/status")
        payload = resp.json()
        expected = json.dumps(payload, separators=(",", ":"), sort_keys=False)
        self.assertEqual(resp.text(), expected)

    def test_compact_list_does_not_double_call(self) -> None:
        values = ["hello world", "", "  ", "foo bar", "baz"]
        result = compact_list(values, max_items=10, max_length=140)
        self.assertEqual(result, ["hello world", "foo bar", "baz"])

    def test_do_post_logs_when_error_response_write_fails(self) -> None:
        """When _dispatch_post raises and _write_json also fails, the debug log fires."""
        self._callbacks.execute_seed_run = lambda **_: (_ for _ in ()).throw(
            KeyboardInterrupt()
        )
        original_write_json = self._handler_class._write_json

        def broken_write_json(handler_self, status, body, request_id):
            if status == 500 and body.get("error") == "internal server error":
                raise OSError("broken pipe")
            return original_write_json(handler_self, status, body, request_id)

        with patch.object(self._handler_class, "_write_json", broken_write_json):
            with self.assertLogs("repo-context-mcp", level="DEBUG") as cm:
                with self.assertRaises(KeyboardInterrupt):
                    self._request(
                        "POST",
                        "/seed",
                        body=json.dumps(
                            {"context_pack_dir": "/workspace/context-pack"}
                        ).encode(),
                        headers=self.post_headers(),
                    )
        self.assertTrue(
            any("Failed to send 500 error response" in m for m in cm.output)
        )


if __name__ == "__main__":
    unittest.main()
