"""
External MCP registry loader.

Calls the TypeScript validator via tsx and reads validated output.
Does NOT reimplement schema validation.
"""
from __future__ import annotations

import json
import logging
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Path to the CLI entry point relative to repo root.
_CLI_SCRIPT = "src/backend/platform/external-mcp-registry/cli.ts"

# Repo root that contains this package, used to locate the CLI script and tsx
# regardless of the data --root passed to a command. In production the data root
# IS this repo; in tests the data root is an isolated workspace while the CLI
# code still resolves from the real checkout.
_PACKAGE_REPO_ROOT = Path(__file__).resolve().parents[7]


class ExternalMcpLoadError(Exception):
    """Raised when the external MCP registry cannot be loaded."""

    def __init__(self, errors: list[dict[str, str]]) -> None:
        self.errors = errors
        messages = "; ".join(e.get("message", "unknown") for e in errors)
        super().__init__(f"External MCP registry validation failed: {messages}")


def _find_tsx(root_dir: Path) -> str:
    """Resolve the tsx binary path, cross-platform."""
    bin_dir = root_dir / "node_modules" / ".bin"
    if platform.system() == "Windows":
        tsx_cmd = bin_dir / "tsx.cmd"
        if tsx_cmd.exists():
            return str(tsx_cmd)
    else:
        tsx_bin = bin_dir / "tsx"
        if tsx_bin.exists():
            return str(tsx_bin)
    # Fall back to npx, verifying it exists on PATH.
    # Return the literal "npx" so _run_cli() can prepend "tsx" as an argument.
    if shutil.which("npx") is None:
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": "Neither tsx nor npx found. Is Node.js installed?",
            "fix": "Run 'pnpm install' to install dependencies, or ensure npx is on PATH.",
        }])
    return "npx"


def _run_cli(
    code_root: Path,
    subcommand: str,
    data_root: Path | None = None,
    extra_args: list[str] | None = None,
) -> dict[str, Any]:
    """Run the TypeScript CLI and return parsed JSON.

    ``code_root`` locates the CLI script and the tsx binary; ``data_root``
    (defaulting to ``code_root``) is passed as ``--root`` so the CLI reads
    registry/assignment state from there.
    """
    cli_path = code_root / _CLI_SCRIPT

    if not cli_path.exists():
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": f"CLI script not found: {cli_path}",
            "fix": "Ensure the platform TypeScript is built.",
        }])

    tsx = _find_tsx(code_root)
    root_arg = str(data_root if data_root is not None else code_root)

    cmd: list[str]
    if tsx == "npx":
        cmd = ["npx", "tsx", str(cli_path), subcommand, "--root", root_arg]
    else:
        cmd = [tsx, str(cli_path), subcommand, "--root", root_arg]
    if extra_args:
        cmd.extend(extra_args)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(code_root),
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": "TypeScript CLI timed out after 30 seconds.",
            "fix": "Check that tsx is installed and the TypeScript code compiles.",
        }])
    except FileNotFoundError:
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": "tsx binary not found. Is Node.js installed?",
            "fix": "Run 'pnpm install' to install dependencies.",
        }])

    stdout = result.stdout.strip()
    if not stdout:
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": f"TypeScript CLI produced no output. stderr: {result.stderr.strip()}",
            "fix": "Check cli.ts for errors.",
        }])

    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": f"Invalid JSON from CLI: {exc}",
            "fix": "Check cli.ts for output corruption.",
        }])


_RUNTIME_REGISTRY_REL = ".platform-state/mcp-registry-external.json"


def load_validated_external_mcp(root_dir: str | Path) -> dict[str, Any]:
    """
    Load and validate the external MCP registry.

    Prefers the TypeScript CLI via tsx (full schema validation). Falls
    back to direct JSON read of the runtime registry file when the CLI
    script is not available (e.g. in test workspaces without Node.js).

    Returns the validated registry document as a dict with keys:
      - schema_version: int
      - external_servers: list[dict]

    Raises ExternalMcpLoadError on validation failure.
    """
    root = Path(root_dir).resolve()
    cli_path = root / _CLI_SCRIPT

    # If the CLI script is available, use the full tsx-based validator.
    if cli_path.exists():
        result = _run_cli(root, "seed")
        action = result.get("action")

        if action in ("created", "up-to-date"):
            return result["registry"]

        errors = result.get("errors", [{"field": "(seed)", "message": "Seeding/validation failed", "fix": "Check registry file."}])
        raise ExternalMcpLoadError(errors)

    # Fallback: read the runtime registry file directly (no tsx).
    # Used in test workspaces or environments without Node.js.
    runtime_path = root / _RUNTIME_REGISTRY_REL
    try:
        data = json.loads(runtime_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ExternalMcpLoadError([{
            "field": "(file)",
            "message": f"Runtime registry not found and CLI unavailable: {runtime_path}",
            "fix": "Run 'pnpm run setup' to seed the registry.",
        }])
    except (json.JSONDecodeError, OSError) as exc:
        raise ExternalMcpLoadError([{
            "field": "(file)",
            "message": f"Failed to read runtime registry: {exc}",
            "fix": "Check the registry file for corruption.",
        }])

    if not isinstance(data, dict) or "external_servers" not in data:
        raise ExternalMcpLoadError([{
            "field": "(file)",
            "message": "Runtime registry has invalid structure.",
            "fix": "Delete and re-seed the registry.",
        }])

    return data


def resolve_assigned_servers_for_agent(
    root_dir: str | Path,
    agent_id: str,
) -> list[dict[str, Any]]:
    """
    Resolve the enabled external MCP servers assigned to an agent.

    Delegates entirely to the TypeScript selection boundary
    (cli.ts select-for-agent), which reads the durable assignment store and
    never consults a server's stale agent_scope field. The agent ID may be a
    runtime nickname (e.g. ``dalton``) or a provider registry ID; the TypeScript
    helper performs the mapping. Returns the raw registry records for the
    assigned, enabled servers, ready for ``prepare_launch_context``.
    """
    data_root = Path(root_dir).resolve()
    result = _run_cli(
        _PACKAGE_REPO_ROOT,
        "select-for-agent",
        data_root=data_root,
        extra_args=["--agent-id", agent_id],
    )
    # The TS selection boundary only emits warnings on fail-closed error
    # conditions (invalid JSON, bad schema_version, unknown agent/server IDs,
    # registry load failure); the success path always returns an empty list.
    # Surface them as a load failure so the launch path reports status
    # "malformed" instead of masquerading as an ordinary "no assignment".
    warnings = result.get("warnings", [])
    if warnings:
        messages = warnings if isinstance(warnings, list) else [str(warnings)]
        raise ExternalMcpLoadError([
            {
                "field": "(assignments)",
                "message": str(message),
                "fix": "Repair the assignment store at "
                ".platform-state/external-mcp-agent-assignments.json.",
            }
            for message in messages
        ])
    servers = result.get("servers", [])
    return servers if isinstance(servers, list) else []
