from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from tests.support.http_handler_harness import Response, call

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_repo_context_app(env_overrides: dict[str, str] | None = None):
    import importlib
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    # Purge cached modules so reload picks up new env
    purge_keys = [
        k for k in sys.modules
        if k == "src.backend.mcp.repo_context_mcp.app"
        or k.startswith("src.backend.mcp.repo_context_mcp.")
    ]
    saved = {k: sys.modules.pop(k) for k in purge_keys}

    try:
        with mock.patch.dict(os.environ, env, clear=True):
            mod = importlib.import_module("src.backend.mcp.repo_context_mcp.app")
        return mod
    except Exception:
        # Restore on failure
        sys.modules.update(saved)
        raise


class RepoContextRequestIdTests(unittest.TestCase):
    # --------------------------------------------------------------------------
    # All HTTP tests use the in-process harness from
    # tests/support/http_handler_harness.py — no HTTPServer, no threads,
    # no TCP.  See tests/conftest.py for the socket guard.
    # --------------------------------------------------------------------------

    @classmethod
    def setUpClass(cls) -> None:
        cls.app = load_repo_context_app(
            {"REPO_CONTEXT_MCP_AUTH_TOKEN": "test-token"}
        )

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response:
        return call(self.app.Handler, method, path, body=body, headers=headers)

    def test_status_echoes_supplied_request_id(self) -> None:
        resp = self._request(
            "GET", "/status", headers={"X-Request-ID": "pilot-request-123"}
        )

        payload = resp.json()
        self.assertEqual(
            resp.headers.get("X-Request-ID"), "pilot-request-123"
        )
        self.assertEqual(payload["request_id"], "pilot-request-123")

    def test_seed_parse_args_uses_activation_facing_env_defaults(
        self,
    ) -> None:
        env = {
            "ACTIVE_CONTEXT_PACK_DIR": "/tmp/context-pack",
            "CONTEXT_PACK_QMD_REPO_SOURCES_FILE": "qmd/custom-manifest.json",
            "CONTEXT_PACK_QMD_DRY_RUN_PLAN_FILE": "qmd/custom-plan.json",
        }
        app = load_repo_context_app(env)

        with mock.patch.dict(os.environ, {**os.environ, **env}, clear=True):
            args = app.parse_args(["seed"])

        self.assertEqual(args.context_pack_dir, "/tmp/context-pack")
        self.assertEqual(args.manifest, "qmd/custom-manifest.json")
        self.assertEqual(args.plan_file, "qmd/custom-plan.json")

    def test_health_generates_request_id_when_missing(self) -> None:
        resp = self._request("GET", "/health")

        request_id = resp.headers.get("X-Request-ID")
        self.assertIsNotNone(request_id)
        self.assertTrue(request_id.startswith("req-"))
        self.assertEqual(resp.text(), "ok")

    def test_unknown_post_returns_request_id_in_header_and_body(
        self,
    ) -> None:
        resp = self._request(
            "POST",
            "/unknown",
            body=b"{}",
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(resp.status, 404)
        request_id = resp.headers.get("X-Request-ID")
        self.assertIsNotNone(request_id)
        payload = resp.json()
        self.assertEqual(payload["request_id"], request_id)
        self.assertEqual(payload["error"], "unknown endpoint")

    def test_seed_returns_conflict_when_runtime_state_is_locked(
        self,
    ) -> None:
        acquired = self.app.RUNTIME_STATE.acquire_seed_run(
            "/workspace/context-pack"
        )
        self.assertTrue(acquired)
        self.addCleanup(
            self.app.RUNTIME_STATE.release_seed_run,
            "/workspace/context-pack",
        )

        seed_service = mock.Mock()
        seed_service.resolve_seed_scope_key.return_value = (
            "/workspace/context-pack"
        )
        with mock.patch.object(
            self.app, "get_seeding_service", return_value=seed_service,
        ):
            resp = self._request(
                "POST",
                "/seed",
                body=b'{"context_pack_dir": "/workspace/context-pack"}',
                headers={
                    "Content-Type": "application/json",
                    "X-Repo-Context-Token": "test-token",
                },
            )

        self.assertEqual(resp.status, 409)
        payload = resp.json()
        self.assertEqual(
            payload["error"], "a seed run is already in progress"
        )


if __name__ == "__main__":
    unittest.main()
