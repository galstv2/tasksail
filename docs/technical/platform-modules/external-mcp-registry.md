# External MCP Registry Module

`external-mcp-registry` owns operator-configured third-party MCP server definitions and per-agent assignments. It is separate from the internal MCP registry, which tracks platform-owned services.

External servers can use HTTP, SSE, or local transports. URL server headers and local server environment values support literal values or whole-value environment references. Local servers require explicit enablement and a tool allowlist.

## Sources of truth

- [external MCP types](../../../src/backend/platform/external-mcp-registry/types.ts)
- [external MCP loader](../../../src/backend/platform/external-mcp-registry/load.ts)
- [external MCP assignments](../../../src/backend/platform/external-mcp-registry/assignments.ts)
- [external MCP CLI](../../../src/backend/platform/external-mcp-registry/cli.ts)
