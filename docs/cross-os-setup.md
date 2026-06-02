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

## Container runtime matrix

| Runtime value | Supported on | Notes |
|---|---|---|
| `docker` (default) | macOS, Linux, Windows | Requires Docker Desktop (macOS/Windows) or native Docker (Linux). Uses the integrated `docker compose` subcommand. |
| `podman` | macOS, Linux, Windows | Requires Podman Desktop (macOS/Windows) or native Podman (Linux). Uses the integrated `podman compose` subcommand. |
| `direct` | macOS, Linux, Windows | Explicit operator override — starts the MCP as a local process without a container engine (no Docker/Podman needed). On Windows the daemon is terminated with `taskkill /T /F`. |

TaskSail uses the integrated `docker compose` / `podman compose` subcommands. Standalone `docker-compose` and `podman-compose` are not required and are not used.

## CONTAINER_RUNTIME

- Persistent operator choice lives in `.platform-state/platform.json`; the checked-in default is `docker`
- `CONTAINER_RUNTIME` env var is a temporary session override (debug/CI only)
- `container_runtime` selects the runtime; it does not select where the engine is hosted

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

## Enterprise mirrors / internal registries

Air-gapped, VPN-only, or firewalled environments can route npm, PyPI, and
container base images through an internal mirror (such as JFrog Artifactory).
Setting none of these variables leaves the public-registry defaults in place.

There are two distinct phases, and they read different variables:

1. **First install (before TaskSail code runs).** Package managers do not read
   the repo `.env` file, so export the package-manager-native variables in your
   shell before the first install — that is, before `pnpm install`, `npm ci`, or
   `pip install`.

   ```bash
   # macOS / Linux (POSIX shell)
   export NPM_CONFIG_REGISTRY="https://artifactory.example.internal/api/npm/npm-virtual/"
   export NPM_CONFIG_REPLACE_REGISTRY_HOST=npmjs
   export PIP_INDEX_URL="https://artifactory.example.internal/api/pypi/pypi-virtual/simple/"
   ```

   ```powershell
   # Windows (PowerShell)
   $env:NPM_CONFIG_REGISTRY = "https://artifactory.example.internal/api/npm/npm-virtual/"
   $env:NPM_CONFIG_REPLACE_REGISTRY_HOST = "npmjs"
   $env:PIP_INDEX_URL = "https://artifactory.example.internal/api/pypi/pypi-virtual/simple/"
   ```

2. **Steady state (after `.env` exists).** `pnpm run setup` reads the TaskSail
   alias variables — `TASKSAIL_NPM_REGISTRY`, `TASKSAIL_NPM_AUTH_TOKEN`,
   `TASKSAIL_PYPI_INDEX_URL` — from `process.env` and the repo `.env`
   (`process.env` wins) and writes the generated, git-ignored helper files
   `.npmrc`, `src/frontend/desktop/.npmrc`, and credential-free
   `.platform-state/pip.conf`. The npm auth token is only referenced as
   `${TASKSAIL_NPM_AUTH_TOKEN}`; TaskSail never writes the raw token.
   Credential-bearing PyPI URLs stay shell-exported through `PIP_INDEX_URL` and
   are not persisted. The PyPI helper config is only consulted by `pip` when
   `PIP_CONFIG_FILE` points at it.

### Docker / Podman base images

Override the build base images with `TASKSAIL_PYTHON_BASE_IMAGE` (default
`python:3.12-alpine`, applied through TaskSail bootstrap for the repo-context-mcp
image) and, for direct `docker build` / `podman build`,
`TASKSAIL_ALPINE_BASE_IMAGE` (default `alpine:3.20`). Private base-image
registries still authenticate with `docker login`, `podman login`, or your
engine's native configuration — TaskSail does not store registry credentials.

Do not hand-edit tracked lockfiles, tracked Dockerfiles, or the generated local
config files; configure the variables above instead.

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
