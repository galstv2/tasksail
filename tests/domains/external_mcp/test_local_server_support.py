"""Tests for local (stdio) external MCP server support.

Covers the operator opt-in gate (fail-closed), the shared ${ENV_VAR} resolver
applied to local env, the shutil.which command preflight, the TCP-preflight
skip for local servers, and the local resolved-server projection.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

SCRIPT_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "src" / "backend" / "scripts" / "python"
)
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.role_agent.external_mcp import renderer  # noqa: E402
from lib.role_agent.external_mcp.local_servers import (  # noqa: E402
    command_available,
    is_local_server,
    local_mcp_enabled,
    project_local_server,
    resolve_env_ref_map,
)
from lib.role_agent.external_mcp.renderer import (  # noqa: E402
    prepare_launch_context,
    resolve_mcp_servers,
)

_ENABLED = {"TASKSAIL_LOCAL_MCP_ENABLED": "1"}
_DISABLED = {"TASKSAIL_LOCAL_MCP_ENABLED": ""}


def _local_server(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "local-fs",
        "display_name": "Local FS MCP",
        "purpose": "Local filesystem tools",
        "enabled": True,
        "transport": "local",
        "command": "npx",
        "args": ["-y", "@scope/fs"],
        "tools": ["read_file", "list_dir"],
        "agent_scope": {"mode": "allowlist", "agent_ids": ["swe"]},
    }
    base.update(overrides)
    return base


def _url_server(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "vendor-docs",
        "display_name": "Vendor Docs MCP",
        "purpose": "Vendor API docs",
        "enabled": True,
        "transport": "sse",
        "url": "https://mcp.vendor.example/sse",
        "agent_scope": {"mode": "allowlist", "agent_ids": ["swe"]},
    }
    base.update(overrides)
    return base


class OptInFlagTests(unittest.TestCase):
    def test_enabled_only_for_truthy_values(self) -> None:
        for value, expected in [("1", True), ("true", True), ("TRUE", True),
                                ("", False), ("0", False), ("false", False),
                                ("yes", False)]:
            with mock.patch.dict(os.environ, {"TASKSAIL_LOCAL_MCP_ENABLED": value}):
                self.assertEqual(local_mcp_enabled(), expected, value)

    def test_disabled_when_absent(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "TASKSAIL_LOCAL_MCP_ENABLED"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(local_mcp_enabled())


class SharedEnvResolverTests(unittest.TestCase):
    def test_resolves_local_env_reference(self) -> None:
        with mock.patch.dict(os.environ, {"API_KEY": "sek"}):
            result = resolve_env_ref_map({"API_KEY": "${API_KEY}", "MODE": "prod"}, "local-fs")
        self.assertEqual(result, {"API_KEY": "sek", "MODE": "prod"})

    def test_fail_closed_on_missing_env(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "MISSING_LOCAL_VAR"}
        with mock.patch.dict(os.environ, env, clear=True):
            result = resolve_env_ref_map({"API_KEY": "${MISSING_LOCAL_VAR}"}, "local-fs")
        self.assertIsNone(result)

class CommandAvailabilityTests(unittest.TestCase):
    def test_false_for_empty_command(self) -> None:
        self.assertFalse(command_available(""))


class ProjectLocalServerTests(unittest.TestCase):
    def test_projection_shape(self) -> None:
        record = project_local_server(_local_server(cwd="/abs/work"), {"API_KEY": "sek"})
        self.assertEqual(record, {
            "id": "local-fs",
            "transport": "local",
            "command": "npx",
            "args": ["-y", "@scope/fs"],
            "env": {"API_KEY": "sek"},
            "cwd": "/abs/work",
            "tools": ["read_file", "list_dir"],
        })

    def test_cwd_omitted_when_absent(self) -> None:
        record = project_local_server(_local_server(), {})
        self.assertNotIn("cwd", record)
        self.assertNotIn("url", record)
        self.assertNotIn("headers", record)


class ResolveMcpServersLocalTests(unittest.TestCase):
    def test_local_projection_via_resolve_mcp_servers(self) -> None:
        resolved = resolve_mcp_servers([_local_server()], [{"API_KEY": "sek"}])
        self.assertEqual(resolved, [{
            "id": "local-fs",
            "transport": "local",
            "command": "npx",
            "args": ["-y", "@scope/fs"],
            "env": {"API_KEY": "sek"},
            "tools": ["read_file", "list_dir"],
        }])

    def test_url_tools_emitted_only_when_present(self) -> None:
        with_tools = resolve_mcp_servers([_url_server(tools=["search"])], [{}])
        self.assertEqual(with_tools[0].get("tools"), ["search"])
        without_tools = resolve_mcp_servers([_url_server()], [{}])
        self.assertNotIn("tools", without_tools[0])


class PrepareLaunchContextLocalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="ext-mcp-local-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_opt_in_disabled_excludes_local_and_emits_event(self) -> None:
        with mock.patch.dict(os.environ, _DISABLED):
            with self.assertLogs(level="WARNING") as cm:
                ctx = prepare_launch_context(self.tmpdir, "swe", [_local_server()])
        self.assertFalse(ctx.injection_enabled)
        self.assertEqual(ctx.status, "unavailable")
        self.assertIn("local-fs", ctx.excluded_servers)
        self.assertTrue(any("external_mcp.local.disabled" in line for line in cm.output))

    def test_opt_in_disabled_emits_event_once(self) -> None:
        servers = [_local_server(id="a"), _local_server(id="b")]
        with mock.patch.dict(os.environ, _DISABLED):
            with self.assertLogs(level="WARNING") as cm:
                prepare_launch_context(self.tmpdir, "swe", servers)
        disabled_lines = [line for line in cm.output if "external_mcp.local.disabled" in line]
        self.assertEqual(len(disabled_lines), 1)

    def test_enabled_local_server_is_resolved(self) -> None:
        with mock.patch.dict(os.environ, _ENABLED), \
                mock.patch.object(shutil, "which", return_value="/usr/bin/npx"):
            ctx = prepare_launch_context(self.tmpdir, "swe", [_local_server()])
        self.assertTrue(ctx.injection_enabled)
        self.assertEqual(ctx.status, "available")
        self.assertEqual(ctx.resolved_servers, [{
            "id": "local-fs",
            "transport": "local",
            "command": "npx",
            "args": ["-y", "@scope/fs"],
            "env": {},
            "tools": ["read_file", "list_dir"],
        }])

    def test_missing_command_excludes_with_event(self) -> None:
        with mock.patch.dict(os.environ, _ENABLED), \
                mock.patch.object(shutil, "which", return_value=None):
            with self.assertLogs(level="WARNING") as cm:
                ctx = prepare_launch_context(self.tmpdir, "swe", [_local_server()])
        self.assertFalse(ctx.injection_enabled)
        self.assertIn("local-fs", ctx.excluded_servers)
        self.assertTrue(any("external_mcp.server.excluded_missing_command" in line for line in cm.output))

    def test_missing_env_excludes_fail_closed(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "MISSING_LOCAL_VAR"}
        env["TASKSAIL_LOCAL_MCP_ENABLED"] = "1"
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(shutil, "which", return_value="/usr/bin/npx"):
            with self.assertLogs(level="WARNING") as cm:
                ctx = prepare_launch_context(
                    self.tmpdir, "swe",
                    [_local_server(env={"API_KEY": "${MISSING_LOCAL_VAR}"})],
                )
        self.assertFalse(ctx.injection_enabled)
        self.assertIn("local-fs", ctx.excluded_servers)
        self.assertTrue(any("external_mcp.server.excluded_missing_env" in line for line in cm.output))

    def test_tcp_preflight_skips_local_servers(self) -> None:
        with mock.patch.dict(os.environ, _ENABLED), \
                mock.patch.object(shutil, "which", return_value="/usr/bin/npx"), \
                mock.patch.object(renderer, "preflight_check_servers", return_value=[]) as preflight:
            prepare_launch_context(self.tmpdir, "swe", [_local_server()])
        preflight.assert_called_once_with([])

    def test_mixed_url_and_local_with_flag_off(self) -> None:
        servers = [_url_server(), _local_server()]
        with mock.patch.dict(os.environ, _DISABLED), \
                mock.patch.object(renderer, "preflight_check_servers", return_value=[]):
            ctx = prepare_launch_context(self.tmpdir, "swe", servers)
        # The url server survives; the local server is excluded by the flag.
        self.assertTrue(ctx.injection_enabled)
        self.assertEqual(ctx.status, "degraded")
        self.assertIn("local-fs", ctx.excluded_servers)
        resolved_ids = {s["id"] for s in ctx.resolved_servers}
        self.assertEqual(resolved_ids, {"vendor-docs"})
        self.assertTrue(all(not is_local_server(s) for s in ctx.resolved_servers))


if __name__ == "__main__":
    unittest.main()
