"""HTTP trust-boundary tests (HB-1/2/3) for the repo-context handler.

Kept in a separate module from test_repo_context_http_transport.py, which is
already at its size baseline and must not grow. Reuses the harness stub classes
from that module and rebuilds the in-process handler (no real sockets — see
tests/support/http_handler_harness and tests/conftest.py).
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.backend.mcp.repo_context_mcp.transport.http import RepoContextHttpHandler
from tests.domains.repo_context.test_repo_context_http_transport import (
    _MutableCallbacks,
    _RuntimeStateStub,
)
from tests.support.http_handler_harness import Response, call


class RepoContextHttpBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._temp_dir = tempfile.TemporaryDirectory()
        cls._callbacks = _MutableCallbacks()
        cls._runtime = _RuntimeStateStub()
        cbs = cls._callbacks
        transport = RepoContextHttpHandler(
            workspace_root=Path(cls._temp_dir.name),
            request_id_header="X-Request-ID",
            auth_header="X-Repo-Context-Token",
            auth_token="test-token",
            default_port=8811,
            default_manifest="qmd/repo-sources.json",
            default_plan_file="qmd/bootstrap/seed-plan.json",
            max_request_bytes=2048,
            active_context_pack_dir=lambda: cbs.active_context_pack_dir(),
            runtime_state=cls._runtime,
            execute_seed_run=lambda **kw: cbs.execute_seed_run(**kw),
            resolve_seed_scope_key=lambda **kw: cbs.resolve_seed_scope_key(**kw),
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
    def post_headers(auth_token: str = "test-token") -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Repo-Context-Token": auth_token,
        }

    def test_post_rejects_non_object_json_body(self) -> None:
        # HB-1: valid JSON that is not an object must be 400, not a 500 from an
        # AttributeError when a handler calls payload.get(...).
        for body in (b"[]", b"42", b"\"str\"", b"null"):
            with self.subTest(body=body):
                resp = self._request(
                    "POST", "/seed", body=body, headers=self.post_headers()
                )
                self.assertEqual(resp.status, 400)
                self.assertIn("must be a JSON object", resp.json()["error"])

    def test_seed_route_rejects_invalid_plan_mode(self) -> None:
        # HB-2: plan_mode must match the CLI allowlist; an unknown value is a
        # 400 rather than silently falling back to manifest-only behavior.
        resp = self._request(
            "POST",
            "/seed",
            body=json.dumps(
                {
                    "context_pack_dir": "/workspace/context-pack",
                    "manifest": "qmd/custom-manifest.json",
                    "plan_file": "qmd/custom-plan.json",
                    "plan_mode": "bogus-mode",
                }
            ).encode("utf-8"),
            headers=self.post_headers(),
        )
        self.assertEqual(resp.status, 400)
        self.assertIn("invalid plan_mode", resp.json()["error"])

    def test_get_route_exception_writes_500_json_then_reraises(self) -> None:
        # HB-3: an unhandled exception in a GET route writes a 500 JSON body
        # (mirroring do_POST) before the framework-level re-raise, instead of
        # resetting the connection with no response. On the old code no 500
        # would be written at all.
        captured: dict[str, object] = {}
        original_write_json = self._handler_class._write_json

        def recording_write_json(handler_self, status, body, request_id):
            captured["status"] = status
            captured["body"] = body
            return original_write_json(handler_self, status, body, request_id)

        with patch.object(
            self._handler_class, "_write_json", recording_write_json
        ):
            with patch.object(
                self._runtime, "snapshot", side_effect=RuntimeError("boom")
            ):
                with self.assertRaises(RuntimeError):
                    self._request("GET", "/status")
        self.assertEqual(captured["status"], 500)
        self.assertEqual(captured["body"], {"error": "internal server error"})

    def test_foreign_host_rejected(self) -> None:
        # A crafted Host is rejected before dispatch to block DNS rebinding.
        for host in ("evil.com", "evil.com:8811", "localhost.evil.com"):
            with self.subTest(host=host):
                resp = self._request("GET", "/health", headers={"Host": host})
                self.assertEqual(resp.status, 403)

    def test_loopback_hosts_allowed(self) -> None:
        for host in ("localhost", "127.0.0.1", "[::1]", "localhost:8811"):
            with self.subTest(host=host):
                resp = self._request("GET", "/health", headers={"Host": host})
                self.assertEqual(resp.status, 200)

    def test_foreign_origin_rejected(self) -> None:
        resp = self._request(
            "GET",
            "/health",
            headers={"Host": "localhost", "Origin": "http://evil.com"},
        )
        self.assertEqual(resp.status, 403)

    def test_loopback_origin_allowed(self) -> None:
        resp = self._request(
            "GET",
            "/health",
            headers={"Host": "localhost", "Origin": "http://localhost:8811"},
        )
        self.assertEqual(resp.status, 200)

    def test_wildcard_bind_still_rejects_foreign_host(self) -> None:
        # The default Docker/Podman config binds 0.0.0.0 inside the container;
        # that must NOT disable DNS-rebind protection on the host loopback port.
        with patch.dict(os.environ, {"REPO_CONTEXT_MCP_HOST": "0.0.0.0"}):
            for host in ("evil.com", "evil.com:8811", "localhost.evil.com"):
                with self.subTest(host=host):
                    resp = self._request("GET", "/health", headers={"Host": host})
                    self.assertEqual(resp.status, 403)
            ok = self._request(
                "GET", "/health", headers={"Host": "127.0.0.1:8811"}
            )
            self.assertEqual(ok.status, 200)

    def test_explicit_allowed_host_accepted(self) -> None:
        # Genuine external exposure is opt-in via REPO_CONTEXT_MCP_ALLOWED_HOSTS.
        with patch.dict(
            os.environ, {"REPO_CONTEXT_MCP_ALLOWED_HOSTS": "myhost.local"}
        ):
            ok = self._request(
                "GET", "/health", headers={"Host": "myhost.local"}
            )
            self.assertEqual(ok.status, 200)
            bad = self._request(
                "GET", "/health", headers={"Host": "evil.com"}
            )
            self.assertEqual(bad.status, 403)

    def test_get_500_does_not_leak_exception_detail(self) -> None:
        # Unexpected GET file-content errors return a generic body, not
        # str(exc), which could disclose internal paths.
        secret = "/secret/internal/path-should-not-leak"

        def _boom() -> dict:
            raise RuntimeError(secret)

        self._callbacks.load_shared_retrospective_memory_summary = _boom
        resp = self._request("GET", "/shared-retrospective-memory")
        self.assertEqual(resp.status, 500)
        self.assertNotIn(secret, resp.text())
        self.assertIn("internal server error", resp.text())

    def test_get_auth_flag_off_allows_unauthenticated_read(self) -> None:
        # The unauthenticated read contract is preserved by default.
        resp = self._request("GET", "/shared-retrospective-memory")
        self.assertEqual(resp.status, 200)

    def test_get_auth_flag_on_requires_token(self) -> None:
        gated = (
            "/shared-retrospective-memory",
            "/context-pack-conventions",
            "/behavior-corrections",
        )
        with patch.dict(os.environ, {"REPO_CONTEXT_MCP_REQUIRE_GET_AUTH": "1"}):
            for route in gated:
                with self.subTest(route=route):
                    unauth = self._request("GET", route)
                    self.assertEqual(unauth.status, 401)
            ok = self._request(
                "GET",
                "/shared-retrospective-memory",
                headers={"X-Repo-Context-Token": "test-token"},
            )
            self.assertEqual(ok.status, 200)
            # Default-on safety: the ungated healthcheck route must NOT require a
            # token under the flag, or the container healthcheck would fail.
            health = self._request("GET", "/health")
            self.assertEqual(health.status, 200)


if __name__ == "__main__":
    unittest.main()
