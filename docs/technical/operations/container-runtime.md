# Container Runtime

The checked-in runtime default is direct local execution. Direct runtime starts the repo-context MCP as a local process and requires a compatible Python interpreter. Python 3.12 is preferred, and Python 3.12+ is compatible. Docker and Podman remain optional compose runtimes for environments that need containerized services.

## Resolution Order

Runtime selection resolves from a temporary runtime override, then runtime platform state, then the checked-in default config. Container engine host selection follows the same platform-config ownership model.

## Commands

Use bootstrap and healthcheck for default service startup checks:

```bash
npx tsx src/backend/platform/container/cli.ts bootstrap
npx tsx src/backend/platform/container/cli.ts healthcheck
```

The `up` command is compose-runtime-only. It fails closed when the selected runtime is direct.

## Windows Notes

Windows host topology is represented through platform detection and container engine host config. ReFS Copy-on-Write is auto-detected when available; there is no environment variable to force it.

## Sources of truth

- [platform default config](../../../config/platform.default.json)
- [runtime resolver](../../../src/backend/platform/platform-config/resolve.ts)
- [container CLI](../../../src/backend/platform/container/cli.ts)
- [setup Python check](../../../src/backend/platform/setup/setup.ts)
