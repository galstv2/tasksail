# Header Env And Per-Launch Injection

MCP auth and launch data cross process boundaries through narrow environment and header contracts.

## Repo-Context Headers

Repo-context MCP uses a configured auth header for token auth and accepts bearer authorization as a fallback. Task and context-pack request scope can be carried in headers or request bodies depending on route class.

## External MCP Launch Injection

External MCP selection is prepared before an agent launches. The helper resolves operator-configured servers, excludes entries with missing environment references, and returns provider-ready config data. The agent runner merges internal repo-context MCP with external selections and writes provider-specific MCP config into an owner-only per-launch directory.

Local external MCP is controlled by the `external_mcp_local_enabled` platform-config setting and the internal `TASKSAIL_LOCAL_MCP_ENABLED` per-launch helper variable. That helper flag is not exported into the launched agent's environment.

## Sources of truth

- [repo-context config constants](../../../src/backend/mcp/repo_context_mcp/config.py)
- [agent session MCP merge](../../../src/backend/platform/agent-runner/agentSession.ts)
- [agent runner Python helpers](../../../src/backend/platform/agent-runner/pythonHelpers.ts)
- [external local MCP helper](../../../src/backend/scripts/python/lib/role_agent/external_mcp/local_servers.py)
