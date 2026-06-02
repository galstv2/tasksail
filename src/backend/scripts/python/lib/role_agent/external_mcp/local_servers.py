"""Local (stdio) external MCP server support.

Local servers are command-launched child processes for the active CLI provider.
They are gated behind an operator opt-in flag that is off by default and
fail-closed. This module is extracted from ``renderer.py`` to keep that module
under the 500-line limit and to host the ``${ENV_VAR}`` resolver shared by
header and env resolution.

This module is intentionally self-contained: it does not import from
``renderer`` so the import graph stays one-directional (``renderer`` imports
this module).
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from typing import Any

logger = logging.getLogger(__name__)

# Whole-value ${ENV_VAR} reference, shared by header and local-env resolution.
_ENV_VAR_REF = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")

LOCAL_TRANSPORT = "local"

# Opt-in flag handed off from the TypeScript launch path.
_OPT_IN_ENV_VAR = "TASKSAIL_LOCAL_MCP_ENABLED"
_OPT_IN_TRUE_VALUES = {"1", "true"}


def is_local_server(server: dict[str, Any]) -> bool:
    """Return True when *server* declares the local (stdio) transport."""
    return server.get("transport") == LOCAL_TRANSPORT


def local_mcp_enabled() -> bool:
    """Read the operator opt-in flag, fail-closed.

    Local servers are permitted only when ``TASKSAIL_LOCAL_MCP_ENABLED`` is
    explicitly ``1`` or ``true`` (case-insensitive). Absence, any other value,
    or a read error is treated as disabled.
    """
    try:
        value = os.environ.get(_OPT_IN_ENV_VAR, "")
    except Exception:  # pragma: no cover - os.environ access does not fail
        return False
    return value.strip().lower() in _OPT_IN_TRUE_VALUES


def resolve_env_ref_map(
    raw_map: dict[str, Any] | None,
    server_id: str,
) -> dict[str, str] | None:
    """Resolve ``${ENV_VAR}`` references in a string->string map.

    Each value is either a literal string or a whole-value ``${ENV_VAR}``
    reference. Returns the resolved map, or ``None`` if a referenced variable
    is missing (fail-closed). Logs ``external_mcp.server.excluded_missing_env``
    with the variable *name* (never its value) on a miss.

    Shared by header resolution and local-env resolution so there is a single
    secret-reference mechanism.
    """
    if not raw_map:
        return {}

    resolved: dict[str, str] = {}
    for key, value in raw_map.items():
        match = _ENV_VAR_REF.match(value) if isinstance(value, str) else None
        if match:
            var_name = match.group(1)
            env_val = os.environ.get(var_name)  # process-global; not per-task
            if env_val is None:
                logger.warning(
                    "external_mcp.server.excluded_missing_env",
                    extra={"server_id": str(server_id), "env_var": var_name},
                )
                return None
            resolved[key] = env_val
        else:
            resolved[key] = value

    return resolved


def command_available(command: str) -> bool:
    """Return True when *command* resolves on PATH via ``shutil.which``."""
    if not command:
        return False
    return shutil.which(command) is not None


def project_local_server(
    server: dict[str, Any],
    resolved_env: dict[str, str],
) -> dict[str, Any]:
    """Project a local server into its provider-agnostic resolved record.

    Shape: ``{id, transport:'local', command, args, env, tools}`` plus ``cwd``
    when set. No ``url`` or ``headers``.
    """
    record: dict[str, Any] = {
        "id": str(server.get("id", "?")),
        "transport": LOCAL_TRANSPORT,
        "command": server.get("command", ""),
        "args": list(server.get("args", []) or []),
        "env": resolved_env,
        "tools": list(server.get("tools", []) or []),
    }
    cwd = server.get("cwd")
    if cwd:
        record["cwd"] = cwd
    return record
