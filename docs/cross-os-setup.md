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

- When a context pack lives outside the repo, add its absolute parent directory to `repo_context_mcp_external_mount_roots`; the shared MCP container bind-mounts configured roots at `/context-pack-roots/<index>`
- Operators do not normally set context-pack environment variables by hand; task launches pass the selected container-visible context pack path through the provider-rendered MCP headers

## Performance notes

- On Windows: keeping the repo on the native NTFS filesystem is fastest. Place the repo inside a WSL distribution only for WSL-shell development.
- On WSL dev mode: `/mnt/c/...` is 3-5x slower than `/home/...`. Prefer the native Linux filesystem for repo storage.

## Known limitations

- Windows directory junctions that resolve unexpectedly via `realpathSync` are unsupported for context-pack internals
- Docker Desktop 4.x+ with WSL2 backend is the supported floor on Windows

## Windows Copy-on-Write (ReFS / Dev Drive)

Full repo copies on Windows are slow and disk-heavy because NTFS lacks Copy-on-Write. The platform's task activation calls `materializeWorktreeDeps`, which clones the repo into `AgentWorkSpace/tasks/<id>/`. On Windows ReFS volumes, including Microsoft Dev Drive on Windows 11 22H2+, the platform performs an O(metadata) block clone instead. On NTFS, the platform falls back to the cross-platform Node `fs.promises.cp` current behavior.

### When the speedup applies

- Windows host
- Source repo and `AgentWorkSpace/tasks/` are on the same volume (which is the default — `AgentWorkSpace` lives inside the repo)
- The volume is formatted as ReFS
- The optional `@reflink/reflink` npm package installed successfully (it is a native add-on and may be blocked in some enterprise environments)

### Recommended setup: Dev Drive (Windows 11 22H2+)

- Settings → System → Storage → Advanced storage settings → Disks & volumes → Create dev drive
- Choose "Create new VHD" or use unallocated space; minimum 50 GB
- Format as ReFS (Dev Drive presets this); the Dev Drive flag is what unlocks performance optimizations and security defaults
- Move (or freshly clone) the TaskSail repo onto the Dev Drive
- Run `pnpm install` from the Dev Drive location

### Verifying CoW is active

- Run `fsutil fsinfo volumeinfo Z:` (replace Z: with your drive letter); confirm "File System Name : ReFS"
- After activating a task, compare wall-clock activation time before and after; CoW activations complete in well under one second regardless of repo size
- Optional operator note: `Get-FileIntegrity <path>` in PowerShell can inspect block-clone metadata on Windows hosts that provide that cmdlet

### If you cannot install @reflink/reflink

- The package is listed under `optionalDependencies`; `pnpm install` does not fail when the native add-on cannot build
- Without the package, task activation behaves exactly as it does today (full Node `fs.cp`). No errors, no degraded behavior beyond the speed cost.
- Enterprise operators can pin the absence by ensuring `pnpm install --ignore-scripts` is the install path used by their provisioning tooling

### Cross-volume note

- ReFS block cloning is intra-volume only. If you place `AgentWorkSpace/` on a different volume than the repo (via a symlink, junction, or environment override), the kernel returns `EXDEV` and the platform falls back to the copy path. Keep `AgentWorkSpace/` on the same volume as the repo to retain the speedup.
