"""COPILOT_HOME gate test.

Proves that the ``copilot --agent`` CLI reads ``mcp-config.json`` from
the directory pointed to by ``COPILOT_HOME`` during an agent launch.

This test is gated behind ``RUN_SLOW_TESTS`` because it:
- binds a real TCP port (requires the ``real_socket`` fixture)
- spawns a real ``copilot`` subprocess
- needs the ``copilot`` binary on PATH

If this test fails, the entire external MCP injection spec must be
revised — the mechanism it depends on does not work as expected.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

_SKIP_REASON = "Requires RUN_SLOW_TESTS=1 and copilot on PATH"
_SHOULD_SKIP = not os.environ.get("RUN_SLOW_TESTS") or not shutil.which("copilot")


@pytest.mark.skipif(_SHOULD_SKIP, reason=_SKIP_REASON)
def test_copilot_reads_mcp_config_from_copilot_home(real_socket: object) -> None:
    """The Copilot CLI must attempt to connect to the MCP endpoint
    configured in ``COPILOT_HOME/mcp-config.json`` when launched in
    agent mode.

    Strategy:
    1. Start a local HTTP server that records whether it received
       an MCP ``initialize`` request (or any request at all — proving
       the CLI parsed the config and attempted connection).
    2. Write an ``mcp-config.json`` that points to this server.
    3. Set ``COPILOT_HOME`` to the directory containing the config.
    4. Launch ``copilot --agent test-gate-agent`` with a short timeout.
    5. Assert the server received at least one request.

    We do NOT require the copilot process to succeed — it will likely
    fail because the agent ID does not exist.  We only need proof that
    it attempted to connect to the configured MCP endpoint.
    """
    received_requests: list[dict[str, object]] = []

    class McpProbeHandler(BaseHTTPRequestHandler):
        """Captures incoming requests to prove config was parsed."""

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            received_requests.append({
                "path": self.path,
                "body": body.decode("utf-8", errors="replace"),
            })
            # Respond with a minimal MCP initialize result.
            response = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": {"name": "gate-test", "version": "0.1.0"},
                },
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self) -> None:
            """Handle SSE endpoint probe (some transports use GET)."""
            received_requests.append({
                "path": self.path,
                "body": "",
            })
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    # Start test server on an ephemeral port.
    server = HTTPServer(("127.0.0.1", 0), McpProbeHandler)
    port = server.server_address[1]
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    copilot_home = tempfile.mkdtemp(prefix="copilot-home-gate-")
    try:
        # Write mcp-config.json pointing to the test server.
        mcp_config = {
            "mcpServers": {
                "gate-test-mcp": {
                    "type": "http",
                    "url": f"http://127.0.0.1:{port}/mcp",
                },
            },
        }
        config_path = Path(copilot_home) / "mcp-config.json"
        config_path.write_text(json.dumps(mcp_config, indent=2))

        # Launch copilot with COPILOT_HOME set.
        env = {**os.environ, "COPILOT_HOME": copilot_home}
        try:
            subprocess.run(
                ["copilot", "--agent", "test-gate-agent"],
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
            )
        except subprocess.TimeoutExpired:
            # Timeout is acceptable — we only care whether the server
            # received a connection attempt.
            pass

        # Gate assertion: did the MCP test server receive any request?
        assert len(received_requests) > 0, (
            "copilot --agent did not attempt to connect to the MCP endpoint "
            "configured in COPILOT_HOME/mcp-config.json. The COPILOT_HOME "
            "mechanism does not work as expected — the external MCP injection "
            "spec must be revised."
        )
    finally:
        server.shutdown()
        server_thread.join(timeout=5)
        shutil.rmtree(copilot_home, ignore_errors=True)
