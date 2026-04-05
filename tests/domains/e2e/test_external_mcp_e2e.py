"""Black-box E2E coverage for external MCP launch context rendering."""
from __future__ import annotations

import contextlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_PYTHON = ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PYTHON))

from lib.role_agent.external_mcp import (
    load_validated_external_mcp,
    prepare_launch_context,
    select_servers_for_agent,
)

TEST_MCP_SERVER_DIR = ROOT.parent / "test-mcp-server"
TEST_MCP_ENTRYPOINT = TEST_MCP_SERVER_DIR / "__main__.py"
TEST_REGISTRY_CONFIG = ROOT / "config" / "mcp-registry-external.test.json"
RUNTIME_REGISTRY = ROOT / ".platform-state" / "mcp-registry-external.json"
TEST_SERVER_URL = "http://127.0.0.1:9100"
TEST_AGENT_ID = "test-gate-agent"
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
def _installed_test_registry() -> object:
    """Install the tracked test registry as runtime state and restore it."""
    original = None
    if RUNTIME_REGISTRY.exists():
        original = RUNTIME_REGISTRY.read_text(encoding="utf-8")

    RUNTIME_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    registry_text = TEST_REGISTRY_CONFIG.read_text(encoding="utf-8")
    RUNTIME_REGISTRY.write_text(registry_text, encoding="utf-8")
    try:
        yield
    finally:
        if original is None:
            RUNTIME_REGISTRY.unlink(missing_ok=True)
        else:
            RUNTIME_REGISTRY.write_text(original, encoding="utf-8")


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
            registry = load_validated_external_mcp(ROOT)
            servers = select_servers_for_agent(
                registry["external_servers"],
                TEST_AGENT_ID,
            )
            assert servers, "Expected tracked test registry to select the test MCP server"

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
