from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
HELPER_SCRIPT = REPO_ROOT / "src" / "backend" / "scripts" / "python" / "run-role-agent-helper.py"

# Full provider roster so the TypeScript selection boundary can enumerate the
# active provider agents (it requires agent_id/role_name/human_name/workflow_order).
_PROVIDER_AGENTS = [
    {"agent_id": "planning-agent", "role_name": "Planning Specialist", "human_name": "Lily", "workflow_order": 0},
    {"agent_id": "product-manager", "role_name": "Product Manager", "human_name": "Alice", "workflow_order": 1},
    {"agent_id": "software-engineer", "role_name": "Software Engineer", "human_name": "Dalton", "workflow_order": 2},
    {"agent_id": "qa", "role_name": "QA and Closeout", "human_name": "Ron", "workflow_order": 3},
    {"agent_id": "software-engineer-verify", "role_name": "Verification Engineer", "human_name": "Dalton Verify", "workflow_order": 99},
]


def _make_server(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "test-mcp",
        "display_name": "Test MCP",
        "purpose": "External MCP server used by the helper launch-context tests.",
        "preferred_for": ["testing"],
        "enabled": True,
        "transport": "sse",
        "url": "https://mcp.example.com/sse",
    }
    base.update(overrides)
    return base


class RunRoleAgentHelperExternalMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="helper-ext-mcp-"))
        self._write_agent_registry()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_agent_registry(self) -> None:
        registry_path = self.tmpdir / ".github" / "agents" / "registry.json"
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        registry_path.write_text(json.dumps({"agents": _PROVIDER_AGENTS}), encoding="utf-8")

    def _write_runtime_registry(self, servers: list[dict[str, Any]]) -> None:
        runtime_path = self.tmpdir / ".platform-state" / "mcp-registry-external.json"
        runtime_path.parent.mkdir(parents=True, exist_ok=True)
        runtime_path.write_text(
            json.dumps({"schema_version": 1, "external_servers": servers}),
            encoding="utf-8",
        )

    def _write_assignments(self, content: Any) -> None:
        path = self.tmpdir / ".platform-state" / "external-mcp-agent-assignments.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = content if isinstance(content, str) else json.dumps(content)
        path.write_text(raw, encoding="utf-8")

    def _run_helper(self, agent_id: str = "software-engineer") -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "python3",
                str(HELPER_SCRIPT),
                "prepare-external-mcp-launch-context",
                agent_id,
                "--repo-root",
                str(self.tmpdir),
            ],
            cwd=str(REPO_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

    def test_available_payload_uses_launch_context_exports(self) -> None:
        self._write_runtime_registry([_make_server()])
        self._write_assignments({
            "schema_version": 1,
            "assignments": [
                {"agent_id": "software-engineer", "external_mcp_server_ids": ["test-mcp"]},
            ],
        })

        completed = self._run_helper()

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["status"], "available")
        self.assertEqual(payload["reason"], "1 external MCP server(s) injected")
        self.assertTrue(payload["injectionEnabled"])
        self.assertEqual(payload["selectedServerIds"], ["test-mcp"])
        self.assertEqual(payload["excludedServerIds"], [])
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_STATUS"], "available",
        )
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "true",
        )
        self.assertNotIn("COPILOT_HOME", payload["envExports"])
        self.assertIn("EXTERNAL_MCP_CONTEXT_FILE", payload["envExports"])
        self.assertEqual(payload["resolvedServers"], [{
            "id": "test-mcp",
            "transport": "sse",
            "url": "https://mcp.example.com/sse",
            "headers": {},
        }])
        self.assertEqual(
            set(payload.keys()),
            {
                "status",
                "reason",
                "injectionEnabled",
                "envExports",
                "launchDir",
                "contextFile",
                "resolvedServers",
                "selectedServerIds",
                "excludedServerIds",
            },
        )

    def test_not_applicable_when_server_is_not_assigned_to_agent(self) -> None:
        self._write_runtime_registry([_make_server()])
        # Assigned to qa only — software-engineer must not inherit it.
        self._write_assignments({
            "schema_version": 1,
            "assignments": [
                {"agent_id": "qa", "external_mcp_server_ids": ["test-mcp"]},
            ],
        })

        completed = self._run_helper("software-engineer")

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["status"], "not-applicable")
        self.assertEqual(
            payload["reason"], "no external MCP servers apply to this agent",
        )
        self.assertFalse(payload["injectionEnabled"])
        self.assertEqual(payload["selectedServerIds"], [])
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false",
        )

    def test_malformed_assignment_file_fails_closed(self) -> None:
        # A malformed assignment file must inject no external servers (fail-closed)
        # and must not fail the process — internal MCP wiring is unaffected. It
        # must also report a degraded "malformed" status, not masquerade as an
        # ordinary "no assignment" case, so the operator can tell data corruption
        # apart from a legitimately empty assignment.
        self._write_runtime_registry([_make_server()])
        self._write_assignments("{ this is not valid json")

        completed = self._run_helper("software-engineer")

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["injectionEnabled"])
        self.assertEqual(payload["selectedServerIds"], [])
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false",
        )
        self.assertEqual(
            payload["status"], "malformed",
            msg=f"expected status=malformed, got {payload['status']}; "
            f"reason={payload.get('reason')!r}",
        )
        self.assertIn("invalid", payload["reason"].lower())

    def test_invalid_schema_version_assignment_emits_malformed_status(self) -> None:
        # A structurally valid file with the wrong schema_version is a data error,
        # not an empty assignment — it must surface as malformed, not not-applicable.
        self._write_runtime_registry([_make_server()])
        self._write_assignments({"schema_version": 99, "assignments": []})

        completed = self._run_helper("software-engineer")

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["injectionEnabled"])
        self.assertEqual(
            payload["status"], "malformed",
            msg=f"expected status=malformed, got {payload['status']}; "
            f"reason={payload.get('reason')!r}",
        )


if __name__ == "__main__":
    unittest.main()
