# Setup Module

`setup` owns first-run repository bootstrap. It creates local env files, secures the repo-context MCP token, applies enterprise mirror config, seeds platform config, configures git hooks, creates queue directories, seeds MCP registry state, seeds Deep Focus ignore config, and starts services unless skipped.

Direct runtime setup requires a compatible Python interpreter. Python 3.12 is preferred, and Python 3.12+ is accepted by the resolver.

## Sources of truth

- [setup CLI](../../../src/backend/platform/setup/cli.ts)
- [setup implementation](../../../src/backend/platform/setup/setup.ts)
- [enterprise mirrors](../../../src/backend/platform/setup/enterpriseMirrors.ts)
- [Python resolver](../../../src/backend/platform/core/pythonResolver.ts)
