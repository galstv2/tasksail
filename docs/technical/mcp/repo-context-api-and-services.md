# Repo-Context API And Services

Repo-context services cover live QMD seeding, context-pack conventions, behavior corrections, carry-forward summaries, task lineage, archive summaries, retrospective memory, cache invalidation, and index generation.

## CLI Services

The Python transport CLI defaults to serving HTTP. It also supports seed, conventions, corrections, carry-forward, and lineage commands. Seed exits successfully for success and completed-with-blocked-repos, fails for failed seed runs, and uses a distinct conflict exit when another reseed is already in progress.

## HTTP Services

The HTTP transport dispatches POST endpoints for seed, carry-forward, lineage, retrospective, and cache invalidation. GET endpoints expose selected read paths such as conventions and status data.

## QMD Outputs

Live seeding reads the repo-sources manifest and seed plan, writes repository summaries and records, updates seed state, writes reports, and builds QMD indexes. Archive services read task archive records and retrospective records with bounded scans to avoid unbounded filesystem walks.

## Sources of truth

- [transport CLI parser](../../../src/backend/mcp/repo_context_mcp/transport/cli.py)
- [seeding service](../../../src/backend/mcp/repo_context_mcp/services/seeding_service.py)
- [archive service](../../../src/backend/mcp/repo_context_mcp/services/archive_service.py)
- [QMD index service](../../../src/backend/mcp/repo_context_mcp/services/qmd_index_service.py)
