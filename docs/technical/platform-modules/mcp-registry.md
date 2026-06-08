# MCP Registry Module

`mcp-registry` owns platform-managed internal MCP service registry data. It seeds runtime registry state, validates service definitions, and exposes health metadata consumed by container bootstrap and healthcheck.

Do not use this module to describe operator-configured third-party MCP servers; those belong to the external MCP registry.

## Sources of truth

- [MCP registry index](../../../src/backend/platform/mcp-registry/index.ts)
- [MCP registry load](../../../src/backend/platform/mcp-registry/load.ts)
- [MCP registry seed](../../../src/backend/platform/mcp-registry/seed.ts)
- [health specs](../../../src/backend/platform/mcp-registry/healthSpecs.ts)
