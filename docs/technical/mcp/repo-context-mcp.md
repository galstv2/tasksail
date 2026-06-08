# Repo-Context MCP

Repo-context MCP is the platform-owned service that exposes repository context, QMD services, archive summaries, conventions, corrections, carry-forward, lineage, and seed operations to agents and platform callers.

## Auth And Route Classes

POST routes require a configured token. If the token is missing, POST routes return unavailable instead of accepting requests. Token auth accepts the configured header and also accepts bearer authorization.

Selected content GET routes can require the same token when `REPO_CONTEXT_MCP_REQUIRE_GET_AUTH` is enabled. Health, status, capabilities, and SSE routes are separate route classes.

The HTTP transport also rejects foreign Host and Origin values unless they are loopback, the configured bind host, or explicitly allowed.

## Runtime Config

The service reads host, port, auth header, token, request byte limit, log level, socket timeout, default manifest path, default seed-plan path, global retrospective root, and max files per repo from environment-backed config.

## Sources of truth

- [repo-context config](../../../src/backend/mcp/repo_context_mcp/config.py)
- [HTTP transport](../../../src/backend/mcp/repo_context_mcp/transport/http.py)
- [transport CLI](../../../src/backend/mcp/repo_context_mcp/transport/cli.py)
- [container bootstrap](../../../src/backend/platform/container/cli.ts)
