# TaskSail

TaskSail is a Unix-based, UI-driven agentic workbench for spec-driven development. You use the desktop app to turn a request into a bounded task spec, then TaskSail coordinates an automated agentic loop for planning, implementation, verification, queue state, guardrails, MCP services, and local memory on your machine. The loop is designed to anchor agent work and make successful outcomes more repeatable.

The current product documentation starts at [TaskSail docs](docs/README.md).

## Start Here

- New operators: [Getting Started](docs/getting-started/00-what-is-tasksail.md)
- Engineers: [Technical Reference](docs/technical/architecture/overview.md)
- Desktop contributors: [Desktop shell README](src/frontend/desktop/README.md)

## Requirements

TaskSail currently targets Unix-based development systems such as Linux and macOS. Windows is not a supported runtime target today.

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

The only shipped CLI provider today is GitHub Copilot CLI. It runs behind TaskSail's CLI-provider abstraction, with Copilot-specific launch, model, MCP, and planner behavior compartmentalized for future provider adapters.

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
