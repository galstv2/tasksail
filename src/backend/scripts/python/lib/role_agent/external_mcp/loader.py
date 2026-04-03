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


def _run_cli(root: Path, subcommand: str) -> dict[str, Any]:
    """Run the TypeScript CLI with the given subcommand and return parsed JSON."""
    cli_path = root / _CLI_SCRIPT

    if not cli_path.exists():
        raise ExternalMcpLoadError([{
            "field": "(bridge)",
            "message": f"CLI script not found: {cli_path}",
            "fix": "Ensure the platform TypeScript is built.",
        }])

    tsx = _find_tsx(root)

    cmd: list[str]
    if tsx == "npx":
        cmd = ["npx", "tsx", str(cli_path), subcommand, "--root", str(root)]
    else:
        cmd = [tsx, str(cli_path), subcommand, "--root", str(root)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(root),
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


def select_servers_for_agent(
    servers: list[dict[str, Any]],
    agent_id: str,
) -> list[dict[str, Any]]:
    """
    Filter external servers to those that are enabled and whose
    agent_scope includes the given agent ID.
    """
    return [
        s for s in servers
        if s.get("enabled", False)
        and agent_id in s.get("agent_scope", {}).get("agent_ids", [])
    ]
