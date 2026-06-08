# QMD Storage And Memory

QMD is TaskSail's local memory and archive layer. It stores context-pack manifests, bootstrap answers, seed plans, repository summaries, artifact records, task archives, retrospective records, conventions summaries, correction memos, seed-state, and indexes.

## Storage Model

Context-pack QMD is scoped under the active pack. Task archives and retrospective history are written as Markdown plus sidecar JSON records so services can render human-readable summaries and build machine-readable indexes.

Manifest validation supports the current manifest schemas through Python schema modules. Live seeding uses a dry-run plan when available, writes seed reports, updates pack seed-state, and uses reseed markers to prevent overlapping reseeds.

## Known Source Seam

Current source references disagree on the context-pack conventions filename. The conventions service writes one filename, while the QMD index service indexes a different filename. Docs should preserve that as an unresolved source seam until code is reconciled.

## Sources of truth

- [pack schemas](../../../src/backend/mcp/pack_schemas/__init__.py)
- [seeding service](../../../src/backend/mcp/repo_context_mcp/services/seeding_service.py)
- [QMD index service](../../../src/backend/mcp/repo_context_mcp/services/qmd_index_service.py)
- [conventions service](../../../src/backend/mcp/repo_context_mcp/services/conventions_service.py)
