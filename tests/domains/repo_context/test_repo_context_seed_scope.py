from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.repo_context_mcp.transport.http import RepoContextHttpHandler
from tests.support.http_handler_harness import Response, call


class _RuntimeState:
    def __init__(self) -> None:
        self.locked_scopes: set[str] = set()
        self.released_scopes: list[str] = []
        self.latest_run: dict[str, object] | None = None

    def acquire_seed_run(self, scope_key: str | None = None) -> bool:
        key = scope_key or "default"
        if key in self.locked_scopes:
            return False
        self.locked_scopes.add(key)
        return True

    def release_seed_run(self, scope_key: str | None = None) -> None:
        key = scope_key or "default"
        self.locked_scopes.discard(key)
        self.released_scopes.append(key)

    def set_latest_run(self, report: dict[str, object]) -> None:
        self.latest_run = report


class SeedScopeLockingTests(unittest.TestCase):
    def test_seed_conflict_is_scoped_to_canonical_qmd_scope_dir(self) -> None:
        runtime_state = _RuntimeState()
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        handler: type | None = None
        nested_same_scope: Response | None = None
        nested_different_scope: Response | None = None
        call_count = 0

        def request(body: dict[str, str]) -> Response:
            assert handler is not None
            return call(
                handler,
                "POST",
                "/seed",
                body=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Repo-Context-Token": "test-token",
                },
            )

        def resolve_seed_scope_key(**kwargs: str) -> str:
            if kwargs["plan_file"].endswith("seed-plan-b.json"):
                return "/workspace/context-pack/qmd/scope-b"
            return "/workspace/context-pack/qmd/scope-a"

        def execute_seed_run(**kwargs: str) -> dict[str, str]:
            nonlocal call_count, nested_same_scope, nested_different_scope
            call_count += 1
            if call_count == 1:
                nested_same_scope = request({
                    "context_pack_dir": kwargs["context_pack_dir"],
                    "plan_file": "qmd/bootstrap/seed-plan-a.json",
                })
                nested_different_scope = request({
                    "context_pack_dir": kwargs["context_pack_dir"],
                    "plan_file": "qmd/bootstrap/seed-plan-b.json",
                })
            return {"status": "seeded"}

        handler = RepoContextHttpHandler(
            workspace_root=Path(temp_dir.name),
            request_id_header="X-Request-ID",
            auth_header="X-Repo-Context-Token",
            auth_token="test-token",
            default_port=8811,
            default_manifest="qmd/repo-sources.json",
            default_plan_file="qmd/bootstrap/seed-plan.json",
            max_request_bytes=2048,
            active_context_pack_dir=lambda: "/workspace/context-pack",
            runtime_state=runtime_state,
            execute_seed_run=execute_seed_run,
            resolve_seed_scope_key=resolve_seed_scope_key,
            build_task_lineage_summary=lambda **_: {"summary": "lineage"},
            build_carry_forward_summary=lambda **_: {"summary": "carry-forward"},
            resolve_request_id=lambda headers: headers.get("X-Request-ID") or "req",
        ).make_handler_class()

        outer = request({
            "context_pack_dir": "/workspace/context-pack",
            "plan_file": "qmd/bootstrap/seed-plan-a.json",
        })

        self.assertEqual(outer.status, 200)
        self.assertIsNotNone(nested_same_scope)
        self.assertEqual(nested_same_scope.status, 409)
        self.assertIsNotNone(nested_different_scope)
        self.assertEqual(nested_different_scope.status, 200)
        self.assertEqual(call_count, 2)
        self.assertEqual(
            runtime_state.released_scopes,
            [
                "/workspace/context-pack/qmd/scope-b",
                "/workspace/context-pack/qmd/scope-a",
            ],
        )

if __name__ == "__main__":
    unittest.main()
