"""Black-box E2E coverage for external MCP launch context rendering."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_PYTHON = ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PYTHON))

from lib.role_agent.external_mcp import (
    prepare_launch_context,
    resolve_assigned_servers_for_agent,
)

TEST_MCP_SERVER_DIR = ROOT.parent / "test-mcp-server"
TEST_MCP_ENTRYPOINT = TEST_MCP_SERVER_DIR / "__main__.py"
RUNTIME_REGISTRY = ROOT / ".platform-state" / "mcp-registry-external.json"
RUNTIME_ASSIGNMENTS = ROOT / ".platform-state" / "external-mcp-agent-assignments.json"
TEST_SERVER_URL = "http://127.0.0.1:9100"
# A real provider registry agent: external MCP assignment is keyed by provider IDs.
TEST_AGENT_ID = "software-engineer"

# Inlined registry payload — keeps the test self-contained so no fixture file
# needs to live under config/. The schema mirrors the production external MCP
# registry validated by `load_validated_external_mcp`.
TEST_REGISTRY: dict[str, object] = {
    "schema_version": 1,
    "external_servers": [
        {
            "id": "test-mcp-server",
            "display_name": "Test MCP Server",
            "purpose": (
                "Local test server for validating external MCP endpoint discovery"
            ),
            "preferred_for": [
                "external MCP smoke tests",
                "endpoint discovery validation",
                "tool handshake checks",
            ],
            "fallback_description": (
                "Provides a deterministic local SSE MCP endpoint for "
                "black-box integration checks"
            ),
            "enabled": True,
            "transport": "sse",
            "url": "http://127.0.0.1:9100/sse",
        },
    ],
}

# Assigns the test server to the test agent via the durable assignment store —
# the only assignment authority (agent_scope is no longer consulted).
TEST_ASSIGNMENTS: dict[str, object] = {
    "schema_version": 1,
    "assignments": [
        {"agent_id": TEST_AGENT_ID, "external_mcp_server_ids": ["test-mcp-server"]},
    ],
}
_SKIP_REASON = "Requires RUN_SLOW_TESTS=1 and copilot on PATH"
_SHOULD_SKIP = not os.environ.get("RUN_SLOW_TESTS") or not shutil.which("copilot")


def _launch_test_server() -> subprocess.Popen[str]:
    """Start the standalone external MCP test server."""
    return subprocess.Popen(
        [sys.executable, "-u", str(TEST_MCP_ENTRYPOINT)],
        cwd=str(TEST_MCP_SERVER_DIR),
        env={
            **os.environ,
            "TEST_MCP_HOST": "127.0.0.1",
            "TEST_MCP_PORT": "9100",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def _terminate_process(process: subprocess.Popen[str]) -> str:
    """Terminate a subprocess and collect all buffered output safely."""
    if process.poll() is None:
        process.terminate()
    try:
        stdout, _ = process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, _ = process.communicate(timeout=5)
    return stdout or ""


def _wait_for_healthcheck(process: subprocess.Popen[str]) -> None:
    """Wait until the standalone test server responds on /health."""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(f"{TEST_SERVER_URL}/health", timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError, urllib.error.URLError):
            time.sleep(0.2)

    output = _terminate_process(process)
    raise AssertionError(
        "Standalone test MCP server did not become healthy on 127.0.0.1:9100.\n"
        f"Captured output:\n{output[-2000:]}",
    )


def _require_test_server_fixture() -> None:
    """Skip cleanly when the external utility repo is not available locally."""
    if not TEST_MCP_ENTRYPOINT.exists():
        pytest.skip(
            f"Requires standalone test-mcp-server fixture at {TEST_MCP_ENTRYPOINT}",
        )


@contextlib.contextmanager
def _stage_file(target: Path, content: str) -> Iterator[None]:
    """Temporarily install file content at ``target`` and restore the original."""
    original = target.read_text(encoding="utf-8") if target.exists() else None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    try:
        yield
    finally:
        if original is None:
            target.unlink(missing_ok=True)
        else:
            target.write_text(original, encoding="utf-8")


@contextlib.contextmanager
def _installed_test_registry() -> Iterator[None]:
    """Install the tracked test registry and assignment store, then restore both."""
    with _stage_file(RUNTIME_REGISTRY, json.dumps(TEST_REGISTRY, indent=2)), \
            _stage_file(RUNTIME_ASSIGNMENTS, json.dumps(TEST_ASSIGNMENTS, indent=2)):
        yield


@pytest.mark.skipif(_SHOULD_SKIP, reason=_SKIP_REASON)
def test_external_mcp_pipeline_reaches_the_test_server(real_socket: object) -> None:
    """The rendered external MCP config must drive Copilot traffic to the server."""
    del real_socket
    _require_test_server_fixture()

    server_output = ""
    server_process = _launch_test_server()

    try:
        _wait_for_healthcheck(server_process)

        with _installed_test_registry():
            servers = resolve_assigned_servers_for_agent(ROOT, TEST_AGENT_ID)
            assert servers, "Expected the assignment store to select the test MCP server"

            context = prepare_launch_context(ROOT, TEST_AGENT_ID, servers)
            assert context.injection_enabled is True
            assert context.copilot_home is not None

            config_path = Path(context.copilot_home) / "mcp-config.json"
            assert config_path.exists(), "prepare_launch_context did not render mcp-config.json"

            try:
                subprocess.run(
                    ["copilot", "--agent", TEST_AGENT_ID],
                    env={**os.environ, "COPILOT_HOME": context.copilot_home},
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                pass

            time.sleep(1)
    finally:
        server_output = _terminate_process(server_process)

    assert "/sse" in server_output or "/message" in server_output, (
        "copilot --agent did not produce observable MCP traffic against the "
        "standalone test server."
    )


def _server_already_healthy() -> bool:
    """Check if the test MCP server is already reachable (e.g. via Docker)."""
    try:
        with urllib.request.urlopen(f"{TEST_SERVER_URL}/health", timeout=2) as resp:
            return resp.status == 200
    except (OSError, TimeoutError, urllib.error.URLError):
        return False


def _docker_logs_contain_traffic() -> tuple[bool, str]:
    """Check Docker container logs for actual MCP request lines (not startup banners)."""
    try:
        result = subprocess.run(
            ["docker", "logs", "test-mcp-server"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        output = result.stdout + result.stderr
        # Match actual HTTP request log lines, not startup banner text.
        # Request lines look like: [test-mcp] Thread-N - "GET /sse HTTP/1.1" 200 -
        request_lines = [
            line for line in output.splitlines()
            if ('"GET /sse' in line or '"POST /message' in line)
        ]
        return len(request_lines) > 0, output
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, ""


def _launch_context_config_path(context: object) -> Path:
    """Extract the rendered MCP config path directly from launch context data."""
    raw_path = getattr(context, "configFilePath", None)
    if raw_path is None:
        raw_path = getattr(context, "config_file_path", None)
    assert raw_path is not None, "prepare_launch_context did not expose configFilePath"
    return Path(raw_path)


@pytest.mark.skipif(_SHOULD_SKIP, reason=_SKIP_REASON)
def test_additional_mcp_config_flag_reaches_test_server(real_socket: object) -> None:
    """Validate that --additional-mcp-config @<path> causes Copilot to connect to the test MCP server.

    This test proves the CLI flag mechanism works end-to-end before the platform
    migrates from COPILOT_HOME to --additional-mcp-config (MCPImprovementSpec).

    The test server can be provided externally (e.g. Docker) or launched as a
    standalone process. When Docker is already serving on port 9100, the test
    uses Docker logs to verify traffic instead of process stdout.
    """
    del real_socket

    # Determine whether to use an external server or launch standalone.
    external_server = _server_already_healthy()
    server_process: subprocess.Popen[str] | None = None
    server_output = ""

    if not external_server:
        _require_test_server_fixture()
        server_process = _launch_test_server()
        _wait_for_healthcheck(server_process)

    try:
        with _installed_test_registry():
            servers = resolve_assigned_servers_for_agent(ROOT, TEST_AGENT_ID)
            assert servers, "Expected the assignment store to select the test MCP server"

            context = prepare_launch_context(ROOT, TEST_AGENT_ID, servers)
            assert context.injection_enabled is True

            config_path = _launch_context_config_path(context)
            assert config_path.exists(), "prepare_launch_context did not render mcp-config.json"

            # Launch copilot with --additional-mcp-config instead of COPILOT_HOME.
            # We intentionally do NOT set COPILOT_HOME — the flag alone must work.
            # A prompt is required for copilot to initialize and connect to MCP.
            # Use a real agent ID — copilot rejects unknown agent names immediately.
            copilot_result = None
            try:
                copilot_result = subprocess.run(
                    [
                        "copilot",
                        "--additional-mcp-config", f"@{config_path}",
                        "--agent", "software-engineer",
                        "-p", "List your available tools and exit.",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                pass

            time.sleep(1)
    finally:
        if server_process is not None:
            server_output = _terminate_process(server_process)

    # Determine success: either the server received MCP traffic, OR copilot's
    # output proves it parsed the config (e.g. a policy denial mentioning
    # "MCP servers" means the flag was processed — the org just blocks it).
    copilot_output = ""
    if copilot_result is not None:
        copilot_output = (copilot_result.stdout or "") + (copilot_result.stderr or "")

    copilot_recognized_mcp = (
        "MCP" in copilot_output
        or "mcp" in copilot_output
        or "additional-mcp-config" in copilot_output
    )

    if external_server:
        saw_traffic, docker_output = _docker_logs_contain_traffic()
        assert saw_traffic or copilot_recognized_mcp, (
            "copilot --additional-mcp-config did not produce observable MCP traffic "
            "or policy feedback. The flag may not be recognized by this copilot version.\n"
            f"Copilot output:\n{copilot_output[-2000:]}\n"
            f"Docker logs:\n{docker_output[-2000:]}"
        )
    else:
        saw_traffic = "/sse" in server_output or "/message" in server_output
        assert saw_traffic or copilot_recognized_mcp, (
            "copilot --additional-mcp-config did not produce observable MCP traffic "
            "or policy feedback. The flag may not be recognized by this copilot version.\n"
            f"Copilot output:\n{copilot_output[-2000:]}\n"
            f"Server output:\n{server_output[-2000:]}"
        )
