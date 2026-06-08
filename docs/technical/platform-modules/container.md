# Container Module

`container` owns service bootstrap, healthcheck, seed, direct runtime process handling, and compose-bound runtime commands. The checked-in platform default is direct local execution. Docker and Podman are optional compose runtimes selected through platform config or a temporary runtime override.

`bootstrap` is the safe service startup path for the default runtime. `up` requires a compose-bound runtime and fails when the selected runtime is direct.

## Runtime Selection

Runtime resolution is platform-config-owned. Direct runtime starts the repo-context MCP as a local process. Compose runtimes use the matching Docker or Podman compose files and generated bootstrap environment.

## Sources of truth

- [container CLI](../../../src/backend/platform/container/cli.ts)
- [runtime factory](../../../src/backend/platform/container/runtime.ts)
- [direct runtime](../../../src/backend/platform/container/directRuntime.ts)
- [platform runtime resolver](../../../src/backend/platform/platform-config/resolve.ts)
