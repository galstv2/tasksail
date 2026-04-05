"""
External MCP runtime materialization.

Renders per-launch-isolated COPILOT_HOME directories containing
``mcp-config.json`` and a capability summary markdown file.

All env variable resolution is fail-closed: missing vars exclude the
server with an actionable warning, never writing unresolved ``${...}``
placeholders.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Root for per-launch Copilot home directories (relative to repo root).
_COPILOT_HOME_ROOT = ".platform-state/runtime/copilot-home"

# Pattern to extract PID from a launch token directory name.
# Format: <agent-id>-<epoch-ms>-<pid>
_LAUNCH_TOKEN_PID_RE = re.compile(r"-(\d+)$")

# Pattern for ${ENV_VAR} references in header values.
_ENV_VAR_REF = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")

# Characters that could break markdown structure in operator text.
_MD_ESCAPE_RE = re.compile(r"([\\*_\[\]#`~>|!])")


def _escape_md(text: str) -> str:
    """Escape markdown control characters in operator-authored text."""
    return _MD_ESCAPE_RE.sub(r"\\\1", text)


def _is_pid_alive(pid: int) -> bool:
    """Check whether a process is still running (signal 0 probe)."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        # Cannot determine — treat as alive to be safe.
        return True


# ---------------------------------------------------------------------------
# Stale directory cleanup
# ---------------------------------------------------------------------------


def cleanup_stale_launches(root_dir: Path, agent_id: str) -> int:
    """Delete stale copilot-home directories for *agent_id*.

    Only deletes directories whose PID (extracted from the directory name)
    is no longer active. Preserves directories belonging to concurrent
    launches of the same agent.

    Returns the number of directories deleted.
    """
    copilot_home_root = root_dir / _COPILOT_HOME_ROOT
    if not copilot_home_root.is_dir():
        return 0

    prefix = f"{agent_id}-"
    deleted = 0

    for entry in copilot_home_root.iterdir():
        if not entry.is_dir() or not entry.name.startswith(prefix):
            continue

        pid_match = _LAUNCH_TOKEN_PID_RE.search(entry.name)
        if pid_match is None:
            continue

        pid = int(pid_match.group(1))
        if _is_pid_alive(pid):
            continue

        try:
            _rmtree(entry)
            deleted += 1
        except OSError as exc:
            logger.warning("Failed to delete stale launch dir %s: %s", entry, exc)

    return deleted


def _rmtree(p: Path) -> None:
    """Remove a directory tree (shutil.rmtree workalike without import)."""
    import shutil
    shutil.rmtree(p)


# ---------------------------------------------------------------------------
# Env variable resolution
# ---------------------------------------------------------------------------


def resolve_headers(
    server: dict[str, Any],
) -> dict[str, str] | None:
    """Resolve ``${ENV_VAR}`` references in a server's headers.

    Returns the resolved headers dict, or ``None`` if any required env
    variable is missing (fail-closed per server). Logs an actionable
    warning for each missing variable.
    """
    raw_headers = server.get("headers")
    if not raw_headers:
        return {}

    resolved: dict[str, str] = {}
    for key, value in raw_headers.items():
        m = _ENV_VAR_REF.match(value)
        if m:
            var_name = m.group(1)
            env_val = os.environ.get(var_name)
            if env_val is None:
                print(
                    f"[external-mcp] Server '{server.get('id', '?')}' excluded: "
                    f"env variable ${var_name} is not set. "
                    f"Set it in your environment or .env file.",
                    file=sys.stderr,
                )
                return None
            resolved[key] = env_val
        else:
            resolved[key] = value

    return resolved


# ---------------------------------------------------------------------------
# Connectivity preflight (advisory only — never blocks launch)
# ---------------------------------------------------------------------------

_PREFLIGHT_TIMEOUT_S = 3.0


def preflight_check_servers(
    servers: list[dict[str, Any]],
) -> list[str]:
    """Attempt a TCP connect to each server's URL in parallel.

    Returns a list of warning strings for unreachable servers.
    Warnings are also printed to stderr. Unreachable servers are
    **not** excluded — the preflight is advisory only.
    """
    import socket
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from urllib.parse import urlparse

    def _probe(server: dict[str, Any]) -> str | None:
        url = server.get("url", "")
        server_id = server.get("id", "?")
        parsed = urlparse(url)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)

        if not host:
            return f"[external-mcp] Preflight: server '{server_id}' has no host in URL '{url}'"

        try:
            sock = socket.create_connection((host, port), timeout=_PREFLIGHT_TIMEOUT_S)
            sock.close()
            return None
        except (OSError, socket.timeout) as exc:
            return (
                f"[external-mcp] Preflight warning: server '{server_id}' "
                f"at {host}:{port} is unreachable ({exc}). "
                f"The server will still be included in mcp-config.json — "
                f"the agent will attempt to connect at runtime."
            )

    warnings: list[str] = []

    with ThreadPoolExecutor(max_workers=len(servers) or 1) as pool:
        futures = {pool.submit(_probe, s): s for s in servers}
        for future in as_completed(futures):
            msg = future.result()
            if msg:
                print(msg, file=sys.stderr)
                warnings.append(msg)

    return warnings


# ---------------------------------------------------------------------------
# mcp-config.json rendering
# ---------------------------------------------------------------------------


def render_mcp_config(
    launch_dir: Path,
    servers: list[dict[str, Any]],
    resolved_headers: list[dict[str, str]],
) -> Path:
    """Write ``mcp-config.json`` to *launch_dir*.

    Returns the path to the written file.
    """
    mcp_servers: dict[str, Any] = {}

    for server, headers in zip(servers, resolved_headers):
        server_id = server["id"]
        entry: dict[str, Any] = {
            "type": server["transport"],
            "url": server["url"],
        }
        if headers:
            entry["headers"] = headers
        mcp_servers[server_id] = entry

    config = {"mcpServers": mcp_servers}

    config_path = launch_dir / "mcp-config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return config_path


# ---------------------------------------------------------------------------
# Capability summary rendering
# ---------------------------------------------------------------------------


def render_capability_summary(
    launch_dir: Path,
    servers: list[dict[str, Any]],
) -> Path:
    """Generate the MCP capability summary markdown.

    Returns the path to the written file.
    """
    lines: list[str] = [
        "# External MCP Servers Available for This Session",
        "",
        "At session start, inspect your available tool list for the MCP tools",
        "associated with the servers below.",
        "",
        "For the covered domains, you MUST attempt the relevant MCP tools before",
        "falling back to manual alternatives such as local grep, guesswork, or",
        "hardcoded assumptions.",
        "",
        "If the expected MCP tools are absent, unavailable, or return insufficient",
        "results, say so briefly and then continue with manual fallback methods.",
    ]

    for server in servers:
        lines.append("")
        lines.append(f"## {_escape_md(server['display_name'])}")
        lines.append("")
        lines.append(f"**Why this is configured:** {_escape_md(server['purpose'])}")

        preferred_for = server.get("preferred_for")
        if preferred_for:
            cues = "; ".join(_escape_md(c) for c in preferred_for)
            lines.append("")
            lines.append(f"**Try this MCP first for:** {cues}")

        fallback_desc = server.get("fallback_description")
        if fallback_desc:
            lines.append("")
            lines.append(f"**What it provides:** {_escape_md(fallback_desc)}")

        lines.append("")
        lines.append(
            "When this MCP is authoritative for the covered domain, "
            "do not guess before checking it."
        )
        lines.append("")
        lines.append("---")

    lines.append("")
    lines.append("If no external MCP tools are listed above, proceed normally without them.")
    lines.append("")

    summary_path = launch_dir / "mcp-capability-summary.md"
    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return summary_path


# ---------------------------------------------------------------------------
# Launch context orchestration
# ---------------------------------------------------------------------------


class LaunchContext:
    """Result of preparing external MCP launch context."""

    def __init__(
        self,
        *,
        status: str,
        reason: str,
        injection_enabled: bool,
        copilot_home: str | None = None,
        config_file_path: str | None = None,
        context_file: str | None = None,
        selected_servers: list[dict[str, Any]] | None = None,
        excluded_servers: list[str] | None = None,
    ) -> None:
        self.status = status
        self.reason = reason
        self.injection_enabled = injection_enabled
        self.copilot_home = copilot_home
        self.config_file_path = config_file_path
        self.configFilePath = config_file_path
        self.context_file = context_file
        self.selected_servers = selected_servers or []
        self.excluded_servers = excluded_servers or []

    def env_exports(self) -> dict[str, str]:
        """Return environment variable exports for the subprocess."""
        exports: dict[str, str] = {
            "EXTERNAL_MCP_CONTEXT_STATUS": self.status,
            "EXTERNAL_MCP_CONTEXT_REASON": self.reason,
            "EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED": (
                "true" if self.injection_enabled else "false"
            ),
        }
        if self.context_file:
            exports["EXTERNAL_MCP_CONTEXT_FILE"] = self.context_file
        return exports


def _generate_launch_token(agent_id: str) -> str:
    """Generate a unique launch token: <agent-id>-<epoch-ms>-<pid>."""
    epoch_ms = int(time.time() * 1000)
    pid = os.getpid()
    return f"{agent_id}-{epoch_ms}-{pid}"


def prepare_launch_context(
    root_dir: str | Path,
    agent_id: str,
    servers: list[dict[str, Any]],
) -> LaunchContext:
    """Orchestrate external MCP launch context preparation.

    1. Cleanup stale directories for this agent.
    2. If no servers, return not-applicable.
    3. Resolve env vars in headers (fail-closed per server).
    4. If no servers survive resolution, return unavailable.
    5. Create per-launch directory, render mcp-config.json and
       capability summary.
    6. Return launch context with env exports.

    *servers* should already be filtered for the agent (enabled +
    agent_scope matched).
    """
    root = Path(root_dir)

    # Step 1: cleanup stale directories.
    cleanup_stale_launches(root, agent_id)

    # Step 2: no servers selected → not-applicable.
    if not servers:
        return LaunchContext(
            status="not-applicable",
            reason="no external MCP servers apply to this agent",
            injection_enabled=False,
        )

    # Step 3: resolve headers, exclude servers with missing env vars.
    surviving: list[dict[str, Any]] = []
    surviving_headers: list[dict[str, str]] = []
    excluded: list[str] = []

    for server in servers:
        headers = resolve_headers(server)
        if headers is None:
            excluded.append(server.get("id", "?"))
            continue
        surviving.append(server)
        surviving_headers.append(headers)

    # Step 4: all servers excluded → unavailable.
    if not surviving:
        return LaunchContext(
            status="unavailable",
            reason="no applicable external MCP server could be rendered",
            injection_enabled=False,
            excluded_servers=excluded,
        )

    # Step 4.5: advisory connectivity preflight (never blocks).
    preflight_check_servers(surviving)

    # Step 5: create per-launch directory and render.
    copilot_home_root = root / _COPILOT_HOME_ROOT
    copilot_home_root.mkdir(parents=True, exist_ok=True)

    # Generate a unique launch directory. Retry with increasing delay
    # until we get a path that does not already exist, then create it
    # with exist_ok=False to guarantee exclusivity.
    max_attempts = 5
    for attempt in range(max_attempts):
        token = _generate_launch_token(agent_id)
        launch_dir = copilot_home_root / token
        try:
            launch_dir.mkdir(parents=True, exist_ok=False)
            break
        except FileExistsError:
            if attempt == max_attempts - 1:
                raise RuntimeError(
                    f"Failed to create unique launch directory after {max_attempts} attempts: {launch_dir}"
                )
            time.sleep(0.002 * (attempt + 1))

    config_path = render_mcp_config(launch_dir, surviving, surviving_headers)
    summary_path = render_capability_summary(launch_dir, surviving)

    # Step 6: determine status.
    if excluded:
        status = "degraded"
        reason = (
            f"{len(surviving)} of {len(servers)} servers rendered; "
            f"excluded: {', '.join(excluded)}"
        )
    else:
        status = "available"
        reason = f"{len(surviving)} external MCP server(s) injected"

    return LaunchContext(
        status=status,
        reason=reason,
        injection_enabled=True,
        copilot_home=str(launch_dir),
        config_file_path=str(config_path),
        context_file=str(summary_path),
        selected_servers=surviving,
        excluded_servers=excluded,
    )
