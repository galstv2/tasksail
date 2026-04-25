# Cross-OS Setup

## Supported topologies

| Host OS | Container engine | Context pack location | Notes |
|---|---|---|---|
| macOS | Docker Desktop or Podman Desktop | macOS filesystem | Repo and context pack can live anywhere on the host filesystem. |
| Linux | Native Docker or Podman | Linux filesystem | Repo and context pack should stay on the native Linux filesystem. |
| Windows | Docker Desktop or Podman Desktop | Windows filesystem | TaskSail runs Win32 by default; opt into a WSL-hosted engine via `container_engine_host: "wsl"`. |

## macOS

- Install Docker Desktop or Podman Desktop
- `pnpm run setup`
- Repo can live anywhere on the macOS filesystem
- Context pack can live anywhere on the macOS filesystem

## Linux (native)

- Install Docker or Podman natively
- `pnpm run setup`
- Repo and context pack on the Linux filesystem

## Windows

- Default topology: TaskSail and the container CLI both run as native Win32 processes — no `wsl.exe` wrapping unless you opt in
- Install Docker Desktop or Podman Desktop; both manage their own internal Linux backends (Docker Desktop's WSL2 distro, Podman Desktop's Podman machine) transparently to TaskSail
- `pnpm run setup`
- Repo and context pack on the Windows filesystem (for example, `C:\Users\you\projects\TaskSail`)
- To run the engine inside a named WSL distro instead, set `container_engine_host: "wsl"` and `container_engine_wsl_distro` in `.platform-state/platform.json` (see CONTAINER_ENGINE_HOST below)

## CONTAINER_RUNTIME

- Persistent operator choice lives in `.platform-state/platform.json`
- `CONTAINER_RUNTIME` env var is a temporary session override (debug/CI only)
- `container_runtime` selects Docker vs Podman only; it does not select where the engine is hosted

## CONTAINER_ENGINE_HOST

- Persistent engine-host topology lives in `.platform-state/platform.json` as `container_engine_host`
- Values: `auto`, `native`, `desktop-linux`, `wsl`
- Windows 11 + Docker Desktop / Podman Desktop uses `desktop-linux` or `auto`; the CLI talks to Desktop's Linux engine through its normal context/machine
- Windows-native TaskSail controlling Docker/Podman installed inside a named WSL distro uses `wsl` plus `container_engine_wsl_distro`

## Out-of-tree context packs

- When a context pack lives outside the repo, the bootstrap layer sets `ACTIVE_CONTEXT_PACK_HOST_DIR` automatically and bind-mounts the pack at `/mnt/context-pack` inside the container
- Operators do not normally set `ACTIVE_CONTEXT_PACK_DIR` or `ACTIVE_CONTEXT_PACK_HOST_DIR` by hand; both are populated by the queue's task binding

## Performance notes

- On Windows: keeping the repo on the native NTFS filesystem is fastest. Place the repo inside a WSL distribution only for WSL-shell development.
- On WSL dev mode: `/mnt/c/...` is 3-5x slower than `/home/...`. Prefer the native Linux filesystem for repo storage.

## Known limitations

- Windows directory junctions that resolve unexpectedly via `realpathSync` are unsupported for context-pack internals
- Docker Desktop 4.x+ with WSL2 backend is the supported floor on Windows
