# Python Backend Services

Python backend services support context-estate discovery, pack IO, schema validation, repo-context MCP, QMD seeding/indexing, archive filing, workspace context sync, reinforcement, and role-agent helper behavior.

## Service Areas

- `context_estate` discovers and bootstraps context-pack repository estates.
- `pack` and `pack_schemas` validate, canonicalize, preflight, and write pack data.
- `repo_context_mcp` serves HTTP/CLI context, QMD, archive, conventions, correction, carry-forward, and lineage services.
- `workspace_context_sync` synchronizes workspace selections and Deep Focus data.
- `reinforcement` stores and renders feedback and learning context.
- `scripts/python/lib/role_agent` provides helper commands used during agent launches.

Use the service map inventory for entrypoint-to-destination coverage.

## Sources of truth

- [context estate package](../../../src/backend/mcp/context_estate/__init__.py)
- [repo-context MCP services](../../../src/backend/mcp/repo_context_mcp/services/__init__.py)
- [workspace context sync CLI](../../../src/backend/mcp/workspace_context_sync/cli.py)
- [reinforcement package](../../../src/backend/mcp/reinforcement/__init__.py)
