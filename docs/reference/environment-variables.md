# Environment Variables Reference

The complete list of environment variables TaskSail reads. `.env.example` is the
seed file `pnpm run setup` copies to `.env`; this page is the full reference,
including variables that are not in `.env.example`.

Almost every variable is **optional** — leave it unset to get the documented
default. Only `REPO_CONTEXT_MCP_AUTH_TOKEN` typically needs a value for normal
local use.

## How TaskSail reads configuration

- **`process.env` wins over repo `.env`.** Where a variable can come from both,
  a value exported in your shell overrides the same key in `.env`.
- **Repo `.env` is not auto-loaded into the process environment.** TaskSail
  reads `.env` explicitly at specific points (setup, container bootstrap,
  context-pack activation). Code that reads `process.env` directly — interpreter
  overrides, session overrides — only sees a value if it is actually exported in
  your shell, not merely written to `.env`.
- **Persistent vs. override.** Container and parallelism settings have a
  persistent home in `.platform-state/platform.json`. The matching env vars are
  *temporary session overrides* for debugging/CI.

### Scope legend

| Scope | Meaning |
|---|---|
| **first-install** | Must be exported in your shell *before* `pnpm install` / `pip install` — TaskSail's own code is not running yet. |
| **steady-state** | Read after `.env` exists (by `pnpm run setup`, bootstrap, or a service at startup). May live in `.env`. |
| **runtime** | Read live from the process environment by the platform, agents, or services. Set in `.env` or as a session override depending on the reader (see notes). |
| **test/CI** | Affects test runs only. |

🔒 = carries a secret/token. Never commit a real value; keep it in your shell or a secret store.

---

## General

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `PROJECT_NAME` | Project name for Docker Compose / shell identification. Not read by runtime code. | `tasksail` | steady-state |
| `APP_ENV` | Deployment environment label (e.g. `development`, `production`). Not read by runtime code. | `development` | steady-state |

## Logging

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `LOG_LEVEL` | Minimum log severity (backend, Python, and Electron loggers). | `info` | steady-state |
| `LOG_FORMAT` | Log serialization: `json` or `text`. | `json` | steady-state |
| `LOG_DIR` | Override the log output directory. | `<repoRoot>/.platform-state/logs` | steady-state |
| `LOG_RENDERER_FORWARD_LEVEL` | Min severity for renderer→main log forwarding (Electron). | falls back to `LOG_LEVEL` | steady-state |
| `TASKSAIL_LOG_MAX_BYTES` | Max log file size before rotation (bytes). | `52428800` (50 MiB) | steady-state |
| `TASKSAIL_LOG_RETENTION_DAYS` | Days to retain `.jsonl` logs before pruning. | `30` | steady-state |
| `TASKSAIL_LOG_PROGRESS` | Progress-line mode: `off`, `plain`, or `color`. Auto-detected from TTY/CI when unset. | auto | runtime |
| `TASKSAIL_LOG_PROGRESS_FORCE` | Set to `1` to force progress lines even in CI. | unset | runtime |
| `NO_COLOR` | Any non-empty value disables ANSI color in progress output. | unset | runtime |

Structured logs are written to global level files under `.platform-state/logs`
and agent-scoped copies under `logs/agent/<taskId>/<agentId>.jsonl` when a
record has both task and agent context. Those agent shard records are fanout
copies for agent-local debugging, not duplicate events to remove. With
`LOG_LEVEL=debug`, debug records use the existing physical `logs/info`
directory with `"level":"debug"`; TaskSail does not currently create a
physical `logs/debug` directory. Default info logs are intended for operator
milestones and actionable outcomes, while debug logs retain lower-level
diagnostics. Task terminal history is separate from structured logs and remains
under `.platform-state/runtime/tasks/<taskId>/terminal-events.json`.

## Container runtime

The persistent choice lives in `.platform-state/platform.json`; these env vars
are session overrides (see [`cross-os-setup.md`](../cross-os-setup.md)).

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `CONTAINER_RUNTIME` | Backend: `docker`, `podman`, or `direct`. | platform.json (`direct`) | runtime |
| `CONTAINER_ENGINE_HOST` | Engine host topology: `auto`, `native`, `desktop-linux`, or `wsl`. | platform.json (`auto`) | steady-state |
| `CONTAINER_ENGINE_WSL_DISTRO` | WSL distro name; required when host topology is `wsl`, forbidden otherwise. | platform.json (`null`) | steady-state |

## Repo Context MCP service

The internal MCP service that indexes repository context. Most defaults are fine
for local use.

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `REPO_CONTEXT_MCP_URL` | MCP endpoint URL injected into agent environments. | `http://localhost:8811/sse` (computed from `mcp_port` at runtime) | runtime |
| `REPO_CONTEXT_MCP_HOST` | Bind address for the service. | `127.0.0.1` | steady-state |
| `REPO_CONTEXT_MCP_PORT` | Service listen port. | `8811` | steady-state |
| 🔒 `REPO_CONTEXT_MCP_AUTH_TOKEN` | Shared secret required for POST routes; POST is disabled until set. | `""` (POST disabled) | steady-state |
| `REPO_CONTEXT_MCP_AUTH_HEADER` | Header name the server checks for the token. | `X-Repo-Context-Token` | steady-state |
| `REPO_CONTEXT_MCP_MAX_REQUEST_BYTES` | Max POST body size (bytes). | `65536` | steady-state |
| `REPO_CONTEXT_MCP_SOCKET_TIMEOUT` | Socket read/write timeout (seconds). | `30` | steady-state |
| `REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR` | Host path of the QMD data dir mounted into the container. | `../../../AgentWorkSpace/qmd` | steady-state |
| `REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR` | Container path where the QMD data dir is mounted. | `/data/qmd` | steady-state |

## Context packs & QMD

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `ACTIVE_CONTEXT_PACK_DIR` | Path to the active context pack (authorizes pack-scoped writes). | none | steady-state |
| `CONTEXT_PACK_QMD_REPO_SOURCES_FILE` | QMD repo-sources manifest path, relative to the pack root. | `qmd/repo-sources.json` | steady-state |
| `CONTEXT_PACK_QMD_DRY_RUN_PLAN_FILE` | QMD dry-run seed plan path, relative to the pack root. | `qmd/bootstrap/seed-plan.json` | steady-state |
| `QMD_GLOBAL_RETROSPECTIVE_ROOT` | Global QMD retrospective directory. | `AgentWorkSpace/qmd/global/retrospectives` | steady-state |
| `QMD_MAX_FILES_PER_REPO` | Max files indexed per repo during a seed run. | `200` | steady-state |

## Enterprise mirrors / internal registries

For air-gapped/firewalled setups routing npm, PyPI, and container base images
through an internal mirror. Full walkthrough (POSIX + PowerShell, two-phase
model): [`cross-os-setup.md`](../cross-os-setup.md#enterprise-mirrors-internal-registries).

**Two distinct phases.** Package managers do **not** read repo `.env` during the
first install, so the *native* variables must be exported in your shell before
`pnpm install` / `pip install`. After `.env` exists, `pnpm run setup` reads the
`TASKSAIL_*` aliases and writes the git-ignored helper files (`.npmrc`,
`src/frontend/desktop/.npmrc`, and credential-free `.platform-state/pip.conf`).
Credential-bearing PyPI URLs stay shell-exported through `PIP_INDEX_URL` and are
not persisted.

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `NPM_CONFIG_REGISTRY` | Native npm registry URL (also lowercase `npm_config_registry`). Wins over `TASKSAIL_NPM_REGISTRY`. | unset | first-install |
| `NPM_CONFIG_REPLACE_REGISTRY_HOST` | pnpm `replace-registry-host` (also lowercase variant). | `npmjs` auto-derived when a non-public registry is active | first-install |
| `PIP_INDEX_URL` | Native pip index URL. Wins over `TASKSAIL_PYPI_INDEX_URL`. | unset | first-install |
| `TASKSAIL_NPM_REGISTRY` | `.env` alias for the internal npm registry; used when `NPM_CONFIG_REGISTRY` is unset. | unset | steady-state |
| 🔒 `TASKSAIL_NPM_AUTH_TOKEN` | Internal npm registry token. Written to `.npmrc` only as a `${TASKSAIL_NPM_AUTH_TOKEN}` reference — never the raw value. | unset | steady-state |
| `TASKSAIL_PYPI_INDEX_URL` | `.env` alias for the internal PyPI index; used when `PIP_INDEX_URL` is unset. Writes `.platform-state/pip.conf` only for credential-free URLs (consulted by pip only when `PIP_CONFIG_FILE` points at it); credential-bearing URLs stay shell-exported through `PIP_INDEX_URL`. | unset | steady-state |
| `TASKSAIL_PYTHON_BASE_IMAGE` | Override the Docker/Podman repo-context build base image (applied via bootstrap + compose `build.args`). | `python:3.12-alpine` | steady-state |
| `TASKSAIL_ALPINE_BASE_IMAGE` | Override the app placeholder base image for direct `docker build` / `podman build` (no compose/bootstrap path). | `alpine:3.20` | steady-state |

> Precedence within each manager: `NPM_CONFIG_REGISTRY` → `npm_config_registry` → `TASKSAIL_NPM_REGISTRY`; `PIP_INDEX_URL` → `TASKSAIL_PYPI_INDEX_URL`. Private base-image registries still authenticate with `docker login` / `podman login` — TaskSail stores no registry credentials.

## Python interpreter resolution

Explicit interpreter overrides, highest priority first. Read from the **process
environment** (export them in your shell; writing them to `.env` alone has no
effect on interpreter discovery).

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `TASKSAIL_PYTHON_312_BIN` | Python 3.12 interpreter; wins over all other sources incl. the repo `.venv`. | unset | first-install |
| `TASKSAIL_PYTHON_BIN` | Interpreter override; checked after `TASKSAIL_PYTHON_312_BIN`. | unset | first-install |
| `PYTHON_BIN` | Lowest-priority interpreter override; checked before `.venv` / system discovery. | unset | first-install |
| `DESKTOP_REPO_CONTEXT_PYTHON_BIN` | Interpreter the Electron app uses for repo-context Python scripts. | `python` (Windows) / `python3` (POSIX) | steady-state |

## Parallelism, tests & CI

| Variable | Purpose | Default | Scope |
|---|---|---|---|
| `TASKSAIL_MAX_PARALLEL_TASKS` | Session override for `max_parallel_tasks`; must be a positive integer (fail-closed on invalid). | platform.json | runtime |
| `TASKSAIL_VITEST_MAX_WORKERS` | Cap on Vitest fork workers; invalid/≤0 falls back to default. | `4` (hard max `8`) | test/CI |
| `RUN_SLOW_TESTS` | Truthy enables slow/integration tests and lifts the `socket.bind` guard. | unset | test/CI |
| `TASKSAIL_DISABLE_PIPELINE_AUTOSTART` | Set to `true` to suppress automatic pipeline launch after task activation. | unset | runtime |

---

## Internal / automatic — do not set

These are populated by the platform, launcher, or harness. Operators should not
set them by hand; doing so can break task binding or runtime behavior.

| Variable | Set by | Purpose |
|---|---|---|
| `ACTIVE_CONTEXT_PACK_HOST_DIR` | bootstrap layer | Host path for out-of-tree context packs, forwarded to agent launches / compose env. |
| `TASKSAIL_CLI_HOME_DIR_NAME` | launcher | Per-task CLI home subdirectory name, derived from the active provider. |
| `TASKSAIL_REPO_ROOT` | bootstrap layer | Repo root injected into the DirectRuntime compose env. |
| `TASKSAIL_TASK_ID` | launcher | Active task ID used to locate the `.task.json` sidecar and bind the workspace. |
| `RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS` | pipeline sequencer | Internal-only gate permitting `--skip-workflow-check`; prevents operator misuse. |

Other harness-managed variables (e.g. `COPILOT_*`, `RUN_ROLE_AGENT_ORCHESTRATOR_ID`,
`REMEDIATION_LOOP_TRIGGERED`, and standard system vars like `PATH`/`CI`/`NODE_ENV`)
are also set automatically and are not operator configuration.
