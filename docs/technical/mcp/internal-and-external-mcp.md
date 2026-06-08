# Internal And External MCP

TaskSail has two MCP registry surfaces.

Internal MCP services are platform-managed. They are seeded by setup, tracked through the internal MCP registry, and used by runtime bootstrap and healthcheck. The repo-context MCP service is the primary internal service today.

External MCP servers are operator-configured third-party services. They live in a separate registry, can be assigned to agents, and are materialized into provider-specific launch config when selected for an agent.

## Boundary

- Internal MCP is owned by TaskSail platform code.
- External MCP is operator-configured and validated before launch.
- HTTP and SSE external servers use URL definitions and optional headers.
- Local external MCP servers use a command, args, env values, cwd, and a required tool allowlist.
- whole-value environment references are resolved before launch; missing values exclude affected external servers.
- Local external MCP requires platform config opt-in and per-launch helper enablement.

## Sources of truth

- [internal MCP registry](../../../src/backend/platform/mcp-registry/index.ts)
- [external MCP registry](../../../src/backend/platform/external-mcp-registry/types.ts)
- [external MCP assignments](../../../src/backend/platform/external-mcp-registry/assignments.ts)
- [agent MCP launch merge](../../../src/backend/platform/agent-runner/agentSession.ts)
