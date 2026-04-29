"""
External MCP registry bridge and runtime materialization.

- loader: validates registry via TypeScript, filters servers for agent
- renderer: materializes per-launch CLI home directories with resolved MCP server data
  and capability summary
"""

from .loader import load_validated_external_mcp, select_servers_for_agent
from .renderer import (
    LaunchContext,
    cleanup_stale_launches,
    preflight_check_servers,
    prepare_launch_context,
    render_capability_summary,
    resolve_headers,
    resolve_mcp_servers,
)

__all__ = [
    "load_validated_external_mcp",
    "select_servers_for_agent",
    "cleanup_stale_launches",
    "resolve_headers",
    "resolve_mcp_servers",
    "render_capability_summary",
    "preflight_check_servers",
    "prepare_launch_context",
    "LaunchContext",
]
