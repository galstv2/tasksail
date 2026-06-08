# Environment Variables

TaskSail environment variables are grouped by ownership. Operator docs should explain the category before encouraging anyone to set a variable.

## Operator-Set Setup And Runtime

Common operator-set values include repo-context MCP host/port/auth settings, QMD path overrides, logging level, internal mirror settings, and temporary platform-config overrides. Setup generates the repo-context auth token when it creates `.env`.

## Platform Config Overrides

`CONTAINER_RUNTIME`, `CONTAINER_ENGINE_HOST`, `CONTAINER_ENGINE_WSL_DISTRO`, `TASKSAIL_MAX_PARALLEL_TASKS`, and `TASKSAIL_CLI_PROVIDER` are temporary process overrides for source-owned platform config. The runtime config file and checked-in default remain the durable sources.

## MCP And QMD

`REPO_CONTEXT_MCP_REQUIRE_GET_AUTH` gates selected content GET routes. `ACTIVE_CONTEXT_PACK_DIR` is normally set through activation/UI state. QMD defaults come from repo-context config and may be overridden for advanced service operation.

## Enterprise Mirrors

Package-manager-native variables must be exported before the first install. After `.env` exists, setup can read TaskSail mirror aliases and generate local helper config. Credential-bearing PyPI URLs remain shell-exported and should not be persisted.

## Internal And Test Variables

Task-scoped, provider-scoped, logging, Vitest, slow-test, and orchestrator bypass variables are internal or test/CI-only unless a source owner explicitly documents operator use.

See the environment matrix in the execution inventory for the full classification table.

## Sources of truth

- [environment example](../../../.env.example)
- [enterprise mirrors](../../../src/backend/platform/setup/enterpriseMirrors.ts)
- [platform config getter](../../../src/backend/platform/platform-config/get.ts)
- [repo-context config](../../../src/backend/mcp/repo_context_mcp/config.py)
