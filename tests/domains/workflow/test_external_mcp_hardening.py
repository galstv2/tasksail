"""End-to-end hardening tests for external MCP lifecycle.

Verifies status taxonomy consistency, fail-closed env resolution,
malformed registry rejection, and deletion lifecycle across active
runtime surfaces.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from typing import Any

import sys
SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "src" / "backend" / "scripts" / "python"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.role_agent.external_mcp.renderer import (
    LaunchContext,
    prepare_launch_context,
    resolve_headers,
)


def _make_server(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "test-mcp",
        "display_name": "Test MCP",
        "purpose": "Test purpose",
        "enabled": True,
        "transport": "sse",
        "url": "https://mcp.example.com/sse",
        "agent_scope": {"mode": "allowlist", "agent_ids": ["swe"]},
    }
    base.update(overrides)
    return base


class StatusTaxonomyTests(unittest.TestCase):
    """Verify each status produces correct exports."""

    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="ext-mcp-taxonomy-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_available_status_exports(self) -> None:
        ctx = prepare_launch_context(self.tmpdir, "swe", [_make_server()])
        exports = ctx.env_exports()
        self.assertEqual(ctx.status, "available")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_STATUS"], "available")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "true")
        self.assertIn("COPILOT_HOME", exports)
        self.assertIn("EXTERNAL_MCP_CONTEXT_FILE", exports)
        # Artifacts must exist.
        self.assertTrue(Path(exports["COPILOT_HOME"]).is_dir())
        self.assertTrue(Path(exports["EXTERNAL_MCP_CONTEXT_FILE"]).is_file())

    def test_not_applicable_status_exports(self) -> None:
        ctx = prepare_launch_context(self.tmpdir, "swe", [])
        exports = ctx.env_exports()
        self.assertEqual(ctx.status, "not-applicable")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_STATUS"], "not-applicable")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false")
        self.assertNotIn("COPILOT_HOME", exports)
        self.assertNotIn("EXTERNAL_MCP_CONTEXT_FILE", exports)

    def test_unavailable_status_exports(self) -> None:
        server = _make_server(headers={"Auth": "${MISSING_VAR_TAXONOMY}"})
        env = {k: v for k, v in os.environ.items() if k != "MISSING_VAR_TAXONOMY"}
        with mock.patch.dict(os.environ, env, clear=True):
            ctx = prepare_launch_context(self.tmpdir, "swe", [server])
        exports = ctx.env_exports()
        self.assertEqual(ctx.status, "unavailable")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_STATUS"], "unavailable")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false")
        self.assertNotIn("COPILOT_HOME", exports)
        self.assertNotIn("EXTERNAL_MCP_CONTEXT_FILE", exports)

    def test_degraded_status_exports(self) -> None:
        good = _make_server(id="good")
        bad = _make_server(id="bad", headers={"Auth": "${MISSING_VAR_DEGRADED}"})
        env = {k: v for k, v in os.environ.items() if k != "MISSING_VAR_DEGRADED"}
        with mock.patch.dict(os.environ, env, clear=True):
            ctx = prepare_launch_context(self.tmpdir, "swe", [good, bad])
        exports = ctx.env_exports()
        self.assertEqual(ctx.status, "degraded")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_STATUS"], "degraded")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "true")
        self.assertIn("COPILOT_HOME", exports)
        self.assertIn("EXTERNAL_MCP_CONTEXT_FILE", exports)
        self.assertIn("excluded", exports["EXTERNAL_MCP_CONTEXT_REASON"])

    def test_malformed_status_exports(self) -> None:
        ctx = LaunchContext(
            status="malformed",
            reason="registry corrupted",
            injection_enabled=False,
        )
        exports = ctx.env_exports()
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_STATUS"], "malformed")
        self.assertEqual(exports["EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED"], "false")
        self.assertNotIn("COPILOT_HOME", exports)
        self.assertNotIn("EXTERNAL_MCP_CONTEXT_FILE", exports)


class FailClosedEnvResolutionTests(unittest.TestCase):
    """Verify env resolution is fail-closed per server end-to-end."""

    def test_missing_env_var_excludes_server(self) -> None:
        server = _make_server(headers={"Auth": "${NONEXISTENT_VAR_FC}"})
        env = {k: v for k, v in os.environ.items() if k != "NONEXISTENT_VAR_FC"}
        with mock.patch.dict(os.environ, env, clear=True):
            result = resolve_headers(server)
        self.assertIsNone(result)

    def test_present_env_var_resolves(self) -> None:
        server = _make_server(headers={"Auth": "${FC_TEST_TOKEN}"})
        with mock.patch.dict(os.environ, {"FC_TEST_TOKEN": "Bearer abc"}):
            result = resolve_headers(server)
        self.assertIsNotNone(result)
        self.assertEqual(result["Auth"], "Bearer abc")

    def test_no_unresolved_placeholders_in_mcp_config(self) -> None:
        """Rendered mcp-config.json must never contain ${...} placeholders."""
        tmpdir = Path(tempfile.mkdtemp(prefix="ext-mcp-fc-"))
        try:
            server = _make_server(headers={"Auth": "${FC_RESOLVED}"})
            with mock.patch.dict(os.environ, {"FC_RESOLVED": "actual_value"}):
                ctx = prepare_launch_context(tmpdir, "swe", [server])
            config_path = Path(ctx.copilot_home) / "mcp-config.json"
            content = config_path.read_text()
            self.assertNotIn("${", content)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


class DeletionLifecycleTests(unittest.TestCase):
    """Verify deleted MCPs leave no stale references in active surfaces."""

    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="ext-mcp-delete-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_deleted_server_absent_from_next_launch_config(self) -> None:
        server = _make_server(id="will-delete")
        ctx1 = prepare_launch_context(self.tmpdir, "swe", [server])
        self.assertTrue(ctx1.injection_enabled)
        config1 = json.loads(
            (Path(ctx1.copilot_home) / "mcp-config.json").read_text()
        )
        self.assertIn("will-delete", config1["mcpServers"])

        # "Delete" the server.
        ctx2 = prepare_launch_context(self.tmpdir, "swe", [])
        self.assertEqual(ctx2.status, "not-applicable")
        self.assertIsNone(ctx2.copilot_home)

    def test_deleted_server_absent_from_next_launch_summary(self) -> None:
        server = _make_server(id="will-delete", display_name="Deletable MCP")
        ctx1 = prepare_launch_context(self.tmpdir, "swe", [server])
        summary1 = (Path(ctx1.copilot_home) / "mcp-capability-summary.md").read_text()
        self.assertIn("Deletable MCP", summary1)

        ctx2 = prepare_launch_context(self.tmpdir, "swe", [])
        self.assertIsNone(ctx2.context_file)

    def test_deleted_server_absent_from_exports(self) -> None:
        server = _make_server()
        ctx1 = prepare_launch_context(self.tmpdir, "swe", [server])
        exports1 = ctx1.env_exports()
        self.assertIn("COPILOT_HOME", exports1)

        ctx2 = prepare_launch_context(self.tmpdir, "swe", [])
        exports2 = ctx2.env_exports()
        self.assertNotIn("COPILOT_HOME", exports2)
        self.assertEqual(exports2["EXTERNAL_MCP_CONTEXT_STATUS"], "not-applicable")

    def test_past_receipts_remain_immutable(self) -> None:
        """Past launch directories (historical receipts) are not rewritten."""
        server = _make_server()
        ctx1 = prepare_launch_context(self.tmpdir, "swe", [server])
        receipt_path = Path(ctx1.copilot_home) / "mcp-receipt.json"
        receipt_path.write_text(json.dumps({"status": "available"}))

        # Next launch with no servers.
        prepare_launch_context(self.tmpdir, "swe", [])

        # Historical receipt from ctx1 still exists (PID is alive).
        self.assertTrue(receipt_path.is_file())
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["status"], "available")


if __name__ == "__main__":
    unittest.main()
