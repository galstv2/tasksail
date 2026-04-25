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


def _make_server(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "test-mcp",
        "display_name": "Test MCP",
        "purpose": "Test purpose",
        "enabled": True,
        "transport": "sse",
        "url": "",
        "agent_scope": {"mode": "allowlist", "agent_ids": ["software-engineer"]},
    }
    base.update(overrides)
    return base


class RunRoleAgentHelperExternalMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="helper-ext-mcp-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_runtime_registry(self, servers: list[dict[str, Any]]) -> None:
        runtime_path = self.tmpdir / ".platform-state" / "mcp-registry-external.json"
        runtime_path.parent.mkdir(parents=True, exist_ok=True)
        runtime_path.write_text(
            json.dumps({
                "schema_version": 1,
                "external_servers": servers,
            }),
            encoding="utf-8",
        )

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
        self.assertIn("COPILOT_HOME", payload["envExports"])
        self.assertIn("EXTERNAL_MCP_CONTEXT_FILE", payload["envExports"])

    def test_not_applicable_payload_is_machine_readable_noop(self) -> None:
        self._write_runtime_registry([
            _make_server(agent_scope={"mode": "allowlist", "agent_ids": ["qa"]}),
        ])

        completed = self._run_helper()

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["status"], "not-applicable")
        self.assertEqual(
            payload["reason"], "no external MCP servers apply to this agent",
        )
        self.assertFalse(payload["injectionEnabled"])
        self.assertEqual(payload["selectedServerIds"], [])
        self.assertEqual(payload["excludedServerIds"], [])
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_STATUS"], "not-applicable",
        )
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false",
        )
        self.assertNotIn("COPILOT_HOME", payload["envExports"])
        self.assertNotIn("EXTERNAL_MCP_CONTEXT_FILE", payload["envExports"])

    def test_malformed_registry_returns_payload_instead_of_process_failure(self) -> None:
        completed = self._run_helper()

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["status"], "malformed")
        self.assertFalse(payload["injectionEnabled"])
        self.assertEqual(payload["selectedServerIds"], [])
        self.assertEqual(payload["excludedServerIds"], [])
        self.assertIn("External MCP registry validation failed", payload["reason"])
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_STATUS"], "malformed",
        )
        self.assertEqual(
            payload["envExports"]["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false",
        )
        self.assertNotIn("COPILOT_HOME", payload["envExports"])
        self.assertNotIn("EXTERNAL_MCP_CONTEXT_FILE", payload["envExports"])


if __name__ == "__main__":
    unittest.main()
