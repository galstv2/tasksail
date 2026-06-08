# TaskSail

TaskSail is a local, operator-controlled workbench for running AI coding agents through a disciplined engineering workflow. You describe the work, keep control from the desktop app, and TaskSail coordinates planning, implementation, verification, queue state, guardrails, MCP services, and local memory on your machine.

The current product documentation starts at [TaskSail docs](docs/README.md).

## Start Here

- New operators: [Getting Started](docs/getting-started/00-what-is-tasksail.md)
- Engineers: [Technical Reference](docs/technical/architecture/overview.md)
- Desktop contributors: [Desktop shell README](src/frontend/desktop/README.md)

## Requirements

TaskSail is developed against Node.js 24, pnpm, Python 3.12+, Git, and the local desktop package. The checked-in runtime default is direct local execution; Docker and Podman are optional compose runtimes.

Use the Getting Started path for the full setup sequence and first-task walkthrough.

## Local Commands

```bash
pnpm install
pnpm run setup
pnpm run validate
cd src/frontend/desktop
npm install
npm run dev
```

The shipped CLI provider is GitHub Copilot behind the provider abstraction. Configure provider access locally before launching agent work.

## License

TaskSail is licensed under the MIT License. See [LICENSE](LICENSE).

## Repository Shape

```text
src/backend/platform/     TypeScript platform control plane
src/backend/mcp/          Python MCP and QMD services
src/frontend/desktop/     Electron and React desktop app
AgentWorkSpace/           Local queue, task, and template workspace
docs/                     Getting Started and technical reference
```

TaskSail runtime state stays local to the checkout and generated platform state. Do not commit secrets, generated runtime state, or local package artifacts.
