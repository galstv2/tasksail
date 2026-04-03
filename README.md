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
- **Docker Desktop** installed and running ([download here](https://www.docker.com/products/docker-desktop/))
- **Python 3.11+** installed ([download here](https://www.python.org/downloads/))
- **GitHub Copilot CLI** access for your GitHub account

## Quick start

### 1. Set up the project

```bash
# Clone the repo
git clone https://github.com/galstv2/tasksail.git
cd tasksail

# Install dependencies and configure everything
pnpm run setup
```

This installs packages, creates your local config file (`.env`), and sets up git hooks.

### 2. Start the background services

```bash
docker compose -f docker/compose/docker-compose.yml up -d --build
```

This starts the support services that agents use during their work.

### 3. Launch the desktop app

```bash
cd src/frontend/desktop
npm install
npm run dev
```

This opens the TaskSail desktop app where you can create tasks and watch agents work.

### 4. Create your first task

In the desktop app:
1. Connect a **context pack** (this tells TaskSail which codebase to work on)
2. Create a new task describing what you want done
3. Watch the agents plan, code, test, and deliver

## Project structure

| Folder | What's inside |
|---|---|
| `src/frontend/desktop/` | The desktop app (React + Electron) |
| `src/backend/platform/` | The engine that runs and coordinates agents |
| `src/backend/mcp/` | Background services for repo indexing and memory |
| `.github/agents/` | Agent profiles (who they are, what they can do) |
| `.github/copilot/` | Agent instructions (how they should behave) |
| `AgentWorkSpace/` | Where task artifacts live during a run |
| `docker/` | Service containers |
| `docs/` | Detailed documentation |

## Useful commands

| Command | What it does |
|---|---|
| `pnpm run setup` | First-time setup |
| `pnpm run validate` | Check that everything is configured correctly |
| `pnpm run test` | Run all backend tests |
| `pnpm run local-checks` | Full validation (run before committing) |
| `pnpm run queue-status` | Show current task queue state |
| `pnpm run watch-dropbox` | Start the task intake watcher |
| `pnpm run complete-pending-item` | Archive a completed task and advance the queue |

### Desktop app commands

```bash
cd src/frontend/desktop
npm run dev            # Start in development mode
npm run build          # Production build
npm test               # Run frontend tests
npm run package:mac    # Package for macOS
npm run package:win    # Package for Windows
npm run package:linux  # Package for Linux
```

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

**Task stuck in the queue?**
Make sure `pnpm run watch-dropbox` is running.

**Agents not starting?**
Check that Docker is running and services are healthy:
```bash
tsx src/backend/platform/container/cli.ts healthcheck
```

**Tests failing?**
Run the full validation to see what's wrong:
```bash
pnpm run local-checks
```

## More documentation

- [Getting started guide](docs/getting-started/onboarding.md)
- [How the workflow operates](docs/workflow/operating-model.md)
- [Platform architecture](docs/architecture/platform-spec.md)
- [Context pack model](docs/architecture/context-pack-model.md)
- [Full docs index](docs/README.md)

## License

MIT License. See [LICENSE](LICENSE).
