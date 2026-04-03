# Security Retrospective

## Scope

This document records the security hardening completed during the current security audit and implementation session for the localhost-only `tasksail` repository.

The working threat model for this session was:

- the platform runs only on localhost
- malicious local processes are in scope
- untrusted browser tabs and extensions are in scope
- security controls still need to enforce local trust boundaries even without internet exposure

## Summary of Security Updates

This session delivered four main hardening passes:

1. local HTTP and backend hardening for `repo-context-mcp`
2. Electron runtime hardening
3. DB MCP documentation and runtime-contract alignment
4. non-HTTP path/symlink hardening plus tighter container write permissions

## 1. Local HTTP and Backend Hardening

### 1.1 Bound `repo-context-mcp` to loopback by default

Updated the backend config and container exposure so the service defaults to `127.0.0.1` instead of a broader host binding.

Files touched:

- `src/backend/mcp/repo_context_mcp/config.py`
- `docker/compose/docker-compose.yml`
- `.env.example`
- `README.md`
- `tests/test_repo_context_config.py`
- `tests/test_repo_context_packaging.py`

Security impact:

- reduces accidental exposure to the local network
- makes the localhost-only deployment assumption true by default instead of relying on operator discipline

### 1.2 Added auth for state-changing HTTP routes

Added token-based authorization for `repo-context-mcp` POST endpoints.

Files touched:

- `src/backend/mcp/repo_context_mcp/config.py`
- `src/backend/mcp/repo_context_mcp/app.py`
- `src/backend/mcp/repo_context_mcp/transport/http.py`
- `.env.example`
- `README.md`
- `tests/test_repo_context_http_transport.py`
- `tests/test_repo_context_request_id.py`

Security impact:

- blocks opportunistic local abuse from other local processes or browser-adjacent requests
- preserves a trust boundary even on localhost

### 1.3 Added request size limits to the local HTTP server

Added request size enforcement and `Content-Length` validation in the HTTP transport.

Files touched:

- `src/backend/mcp/repo_context_mcp/transport/http.py`
- `src/backend/mcp/repo_context_mcp/config.py`

Security impact:

- reduces trivial local denial-of-service pressure from oversized payloads
- keeps the service behavior bounded for malformed or abusive requests

### 1.4 Added HTTP input path confinement

Constrained HTTP inputs such as `context_pack_dir`, `manifest`, `plan_file`, `qmd_scope`, and `parent_qmd_scope` so they must resolve within approved roots.

Files touched:

- `src/backend/mcp/repo_context_mcp/utils.py`
- `src/backend/mcp/repo_context_mcp/transport/http.py`
- `src/backend/mcp/repo_context_mcp/app.py`
- `tests/test_repo_context_http_transport.py`

Security impact:

- prevents traversal and path-escape attacks through local API calls
- blocks symlink-assisted escape from the intended workspace or context-pack boundaries

### 1.5 Replaced unsafe shell `.env` sourcing

Reworked shell helpers so `.env` is parsed as data rather than executed as shell code.

Files touched:

- `src/backend/platform/queue/` (queue management module)
- `src/backend/platform/validation/` (validation module)

Security impact:

- removes shell-code execution risk from a crafted `.env`
- lowers the chance of arbitrary command execution during local setup or queue flows

### 1.6 Enforced Dropbox output routing

Added a guard so dropbox task creation writes only through the expected `AgentWorkSpace/dropbox/` boundary.

Files touched:

- `src/backend/platform/queue/createDropboxTask.ts`
- `tests/test_create_dropbox_task.py`

Security impact:

- reduces accidental or malicious writes to arbitrary paths
- preserves the intended queue handoff boundary

### 1.7 Reduced container privilege for `repo-context-mcp`

Changed the `repo-context-mcp` image to run as a non-root user.

Files touched:

- `docker/repo-context-mcp/Dockerfile`
- `tests/test_repo_context_packaging.py`

Security impact:

- narrows blast radius if the container process is abused
- removes unnecessary root execution from the local service container

## 2. Electron Runtime Hardening

### 2.1 Added runtime IPC request validation

Added validation for desktop action payloads at runtime rather than trusting renderer-provided objects.

Files touched:

- `src/frontend/desktop/src/shared/desktopContract.ts`
- `src/frontend/desktop/electron/main.ts`
- `src/frontend/desktop/electron/main.test.ts`

Security impact:

- prevents malformed or unexpected IPC messages from being processed blindly
- tightens the renderer-to-main trust boundary

### 2.2 Enabled Electron renderer sandboxing

Enabled `sandbox: true` in the Electron `BrowserWindow` configuration.

Files touched:

- `src/frontend/desktop/electron/main.ts`
- `src/frontend/desktop/electron/main.test.ts`

Security impact:

- reduces renderer privileges
- limits the damage of compromised renderer content or browser-adjacent interactions

### 2.3 Restricted development server URLs to local loopback HTTP origins

Added validation so `VITE_DEV_SERVER_URL` must be an explicit loopback `http://` address.

Files touched:

- `src/frontend/desktop/electron/main.ts`
- `src/frontend/desktop/electron/main.test.ts`

Security impact:

- blocks loading arbitrary remote content into the desktop shell during development
- prevents a relaxed local dev setting from becoming a code-loading path

## 3. `.mcp/` Directory and Overlay Machinery Removed

The `.mcp/` directory contained declarative metadata JSON files for MCP servers and a `registry.json`. No code read these files — they were aspirational documentation masquerading as configuration. The bundled `db-mcp` service was a placeholder local HTTP stub never wired to any real database. The overlay system in `context-pack/` (`OverlayName`, `OVERLAY_REGISTRY`, `applyMcpOverlays`) read `mcp/*.env` files from context packs and merged them into `.env`, but this machinery was unused in practice and conflated env var syncing with MCP servers. All of it has been removed — the `.mcp/` directory, overlay types, overlay implementation, overlay CLI commands, and all documentation references. The actual MCP service code (`src/backend/mcp/`, Docker Compose `repo-context-mcp` service, port 8811) is unaffected.

## 4. Non-HTTP Path and Symlink Hardening

This pass extended the earlier HTTP-only path protections to CLI, service, indexing, and archive flows.

### 4.1 Hardened seeding service path resolution

Added constrained resolution inside the seeding service for:

- `context_pack_dir`
- `manifest`
- `plan_file`
- `qmd_scope_root`
- generated index output locations
- canonical and bootstrap note targets

Files touched:

- `src/backend/mcp/repo_context_mcp/services/seeding_service.py`
- `tests/test_live_qmd_seeding.py`

Security impact:

- closes path-escape gaps when the service is called outside HTTP transport
- prevents seeding outputs from being redirected outside the intended context-pack

### 4.2 Hardened archive and lineage service path resolution

Added constrained resolution for archive, lineage, retrospective, and parent-archive lookups.

Files touched:

- `src/backend/mcp/repo_context_mcp/services/archive_service.py`
- `tests/test_task_archive_service.py`
- `tests/test_task_archive_lineage.py`
- `tests/test_parent_archive_retrieval.py`

Security impact:

- prevents archive lookups from traversing outside the selected context-pack
- blocks symlink/path confusion in non-HTTP retrieval flows

### 4.3 Hardened QMD index service path resolution

Updated index-generation logic so scope and retrospective-root resolution remain confined.

Files touched:

- `src/backend/mcp/repo_context_mcp/services/qmd_index_service.py`
- `tests/test_qmd_index_service.py`

Security impact:

- prevents indexing flows from being pointed at out-of-scope data roots
- keeps generated index metadata anchored to the approved workspace/context-pack

### 4.4 Hardened task archive filing script

Updated the task archive filing script to constrain:

- `QMD_GLOBAL_RETROSPECTIVE_ROOT`
- `qmd_scope`
- parent archive lookup scope
- archive and retrospective write locations

Files touched:

- `src/backend/scripts/python/file-task-archive.py`
- `tests/test_task_archive_filing.py`

Security impact:

- blocks path traversal and symlink escapes during closeout filing
- ensures archive and retrospective records land only in approved storage trees

### 4.5 Added symlink escape regressions

Added explicit regression coverage for symlinked context packs and symlinked scope roots that attempt to escape the workspace or context-pack.

Files touched:

- `tests/test_live_qmd_seeding.py`
- `tests/test_task_archive_service.py`
- `tests/test_task_archive_filing.py`

Security impact:

- protects against regressions in the most likely local escape pattern
- verifies that `.resolve()`-based confinement remains effective

## 5. Container Write-Surface Tightening

### 5.1 Changed repo-context bind mounts from broad writable repo access to targeted writable overlays

Updated Compose so the `repo-context-mcp` container mounts:

- the repository root as read-only
- `AgentWorkSpace/qmd/` as writable
- `AgentWorkSpace/dropbox/` as writable

Files touched:

- `docker/compose/docker-compose.yml`
- `tests/test_repo_context_packaging.py`

Security impact:

- reduces the writable surface available to the container
- preserves write access only where the local service is expected to create or update artifacts
- lowers the impact of a compromised container process

### 5.2 Parameterized writable context-pack binds for external estates

Added Compose variables so operators can redirect the writable repo-context data
bind away from the repository `AgentWorkSpace/qmd/` tree when the active context pack lives in
an external directory.

Files touched:

- `docker/compose/docker-compose.yml`
- `.env.example`
- `README.md`
- `tests/test_repo_context_packaging.py`

Security impact:

- keeps the narrowed write surface while still supporting external context-pack
  locations
- avoids regressing to a broad `/workspace:rw` mount just to support
  non-repo context packs
- supports host-side absolute path workflows by allowing the operator to mount
  the external pack at the same absolute path inside the container

## Validation Performed

The following regression coverage was run during the session after the hardening work:

- focused security/path suite:
  - `tests.test_live_qmd_seeding`
  - `tests.test_task_archive_service`
  - `tests.test_task_archive_filing`
  - `tests.test_repo_context_packaging`
  - `tests.test_repo_context_cli`
- broader backend regression slice:
  - `tests.test_task_archive_lineage`
  - `tests.test_parent_archive_retrieval`
  - `tests.test_qmd_index_service`
  - `tests.test_repo_context_http_transport`
  - `tests.test_repo_context_app_helpers`
- earlier session validations also covered:
  - queue/runtime regressions
  - Electron tests
  - DB MCP config/documentation tests

All targeted validation passes completed successfully after the final fixes.

## Outcome

By the end of this session, the repository moved from a localhost-only but loosely trusted posture to a more explicit hostile-local posture with:

- loopback-only defaults
- local POST authorization
- bounded request sizes
- workspace/context-pack path confinement
- non-root container execution
- reduced container write scope
- safer shell configuration loading
- sandboxed and validated Electron runtime boundaries
- documentation aligned to actual runtime guarantees
- regression coverage for path and symlink escape cases
