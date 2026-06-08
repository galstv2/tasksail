# Platform Config Module

`platform-config` seeds, loads, saves, validates, and resolves runtime configuration. It owns checked-in defaults, runtime copy paths, temporary environment overrides, container engine host selection, provider selection, task concurrency, retention settings, and local external MCP enablement.

The checked-in default runtime is direct. Runtime resolution first checks the temporary runtime override, then runtime platform state, then the checked-in default config.

## Sources of truth

- [platform default config](../../../config/platform.default.json)
- [platform config load](../../../src/backend/platform/platform-config/load.ts)
- [platform config resolve](../../../src/backend/platform/platform-config/resolve.ts)
- [platform config get](../../../src/backend/platform/platform-config/get.ts)
