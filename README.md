# TaskSail

TaskSail is a local desktop application that manages a team of AI agents to do software engineering work for you. You describe what you want built or fixed, and TaskSail's agents plan, code, test, and review the work automatically.

## How it works

TaskSail runs entirely on your computer. When you give it a task:

1. **Lily** (Planning Agent) helps you clarify what needs to be done
2. **Alice** (Product Manager) breaks the task into clear, actionable steps
3. **Dalton** (Software Engineer) writes the code
4. **Ron** (QA) reviews the code, runs tests, and either approves or sends it back to Dalton for fixes

You watch the progress in a desktop app that shows what each agent is doing in real time.

## What you need before starting

- **A Mac, Windows, or Linux computer**
- **Git** installed ([download here](https://git-scm.com/downloads))
- **Node.js 20+** installed ([download here](https://nodejs.org/))
- **pnpm** installed (run `npm install -g pnpm` after installing Node.js)
- **Python 3.11+** installed ([download here](https://www.python.org/downloads/))
- **Docker Desktop** installed and running ([download here](https://www.docker.com/products/docker-desktop/))
- **GitHub Copilot CLI** access for your GitHub account

## Quick start

### 1. Clone and install

```bash
# Clone the repo
git clone https://github.com/galstv2/tasksail.git
cd tasksail

# Install backend (Node.js) dependencies
pnpm install

# Run platform setup (creates .env, sets up git hooks, queue directories, etc.)
pnpm run setup

# Create Python virtual environment and install dev tools
python3 -m venv .venv
source .venv/bin/activate        # On Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

# Install frontend (Electron/React) dependencies
cd src/frontend/desktop
npm install
cd ../../..
```

### 2. Verify everything works

```bash
# Build the backend
pnpm run build

# Run backend tests (should see all tests pass)
pnpm run test

# Build and test the frontend
cd src/frontend/desktop
npm run build
npm test
cd ../../..
```

### 3. Start the background services

```bash
docker compose -f docker/compose/docker-compose.yml up -d --build

# Check that services are healthy
npx tsx src/backend/platform/container/cli.ts healthcheck
```

### 4. Launch the desktop app

```bash
cd src/frontend/desktop
npm run dev
```

This opens the TaskSail desktop app.

### 5. Create your first task

In the desktop app:
1. Connect a **context pack** (this tells TaskSail which codebase to work on)
2. Create a new task describing what you want done
3. Watch the agents plan, code, test, and deliver

## Tech stack

| Layer | Technology | Third-party dependencies |
|---|---|---|
| Backend platform | TypeScript 5.8, Node.js | **None** — pure stdlib |
| Backend services | Python 3.13, http.server, SSE | **None** — pure stdlib |
| Frontend | React 18, TypeScript, Electron 35, Vite 6 | React only — no UI framework, no state library, plain CSS |
| Testing | Vitest (TS), pytest (Python) | Dev-only |
| Services | Docker Compose | Podman also supported (experimental) |

The platform is intentionally dependency-free at runtime to stay enterprise-safe.

## Project structure

```
tasksail/
  src/
    backend/
      platform/          # Agent orchestration engine (TypeScript)
      mcp/               # Background services for repo indexing (Python)
      scripts/           # Helper scripts
    frontend/
      desktop/           # Desktop app (React + Electron)
        electron/        #   Main process
        src/renderer/    #   React UI
  .github/
    agents/              # Agent profiles and roster
    copilot/             # Agent instructions and prompts
  AgentWorkSpace/        # Task artifacts (handoffs, slices, queue)
  docker/                # Docker Compose services
  docs/                  # Documentation
```

## Useful commands

### Platform (run from repo root)

| Command | What it does |
|---|---|
| `pnpm install` | Install backend Node.js dependencies |
| `pnpm run setup` | First-time setup (env, hooks, directories) |
| `pnpm run build` | Build backend TypeScript |
| `pnpm run test` | Run all backend tests |
| `pnpm run lint` | TypeScript type checking |
| `pnpm run validate` | Check repo structure is correct |
| `pnpm run local-checks` | Full validation gate (run before committing) |
| `pnpm run queue-status` | Show current task queue state |
| `pnpm run watch-dropbox` | Start the task intake watcher |
| `pnpm run complete-pending-item` | Archive a completed task and advance the queue |

### Desktop app (run from `src/frontend/desktop/`)

| Command | What it does |
|---|---|
| `npm install` | Install frontend dependencies |
| `npm run dev` | Start in development mode |
| `npm run build` | Production build |
| `npm test` | Run frontend tests |
| `npm run lint` | TypeScript type checking |
| `npm run package:mac` | Package for macOS |
| `npm run package:win` | Package for Windows |
| `npm run package:linux` | Package for Linux |

### Python (run from repo root with `.venv` activated)

| Command | What it does |
|---|---|
| `python3 -m venv .venv` | Create virtual environment |
| `source .venv/bin/activate` | Activate virtual environment |
| `pip install -r requirements-dev.txt` | Install Python dev tools |
| `pnpm run lint:python` | Run ruff linter on Python files |
| `pnpm run test:domain -- --domain <name>` | Test a specific Python domain |

## How tasks flow through the system

```
You create a task
    |
    v
Lily (Planning) -- helps clarify scope
    |
    v
Alice (Product Manager) -- breaks work into steps called "slices"
    |
    v
Dalton (Software Engineer) -- writes code for each slice
    |
    v
Ron (QA) -- reviews code and runs tests
    |
    +--> If issues found: Dalton fixes them, Ron re-reviews
    |
    v
Task complete -- archived to long-term memory
```

## Context packs

A **context pack** tells TaskSail about the codebase you want to work on. It includes:
- Which repositories to target
- Project-specific knowledge and conventions
- Memory from past tasks

You can work on any codebase -- a single repo, a monolith with many folders, or a multi-repo project. TaskSail adapts based on the context pack you activate.

## Troubleshooting

**`tsx: command not found` or `vite: command not found`?**
You need to install dependencies first:
```bash
# From repo root:
pnpm install

# From src/frontend/desktop/:
npm install
```

**Task stuck in the queue?**
Make sure `pnpm run watch-dropbox` is running.

**Agents not starting?**
Check that Docker is running and services are healthy:
```bash
npx tsx src/backend/platform/container/cli.ts healthcheck
```

**Tests failing?**
Run the full validation to see what's wrong:
```bash
pnpm run local-checks
```

**Python linting or tests failing?**
Make sure the virtual environment is active:
```bash
source .venv/bin/activate
```

## More documentation

- [Getting started guide](docs/getting-started/onboarding.md)
- [How the workflow operates](docs/workflow/operating-model.md)
- [Platform architecture](docs/architecture/platform-spec.md)
- [Context pack model](docs/architecture/context-pack-model.md)
- [Full docs index](docs/README.md)

## License

MIT License. See [LICENSE](LICENSE).
