# Architecture Overview

TaskSail is a local control plane around agentic engineering work. The backend TypeScript platform owns queue state, runtime config, provider launch, workflow policy, validation, and desktop-facing contracts. Python services own repo-context MCP, QMD indexing, context-estate discovery, archive filing, workspace sync, and reinforcement support. The Electron and React desktop shell is the operator surface; it does not own workflow legality or queue mutation rules.

The platform is intentionally source-owned. Mutable facts such as provider registry entries, model catalog options, runtime defaults, task concurrency, and MCP service shape are described here as ownership boundaries and linked to their source files.

## Runtime Shape

- Setup seeds local environment, platform config, MCP registry state, queue directories, and git hooks.
- The checked-in default runtime is direct local execution; Docker and Podman remain optional compose runtimes.
- The active CLI provider resolves from platform config or a temporary environment override.
- Context packs bound agent work to selected repositories and focus targets before broad execution is allowed.
- Queue activation materializes task worktrees, launches the pipeline, tracks terminal/progress events, and requires closeout artifacts before advancement.

## Documentation Boundary

Getting Started explains how to install, run, and create a first task. The technical pages explain the code seams that own the behavior. Technical pages should link source files rather than copy long mutable values.

## Sources of truth

- [platform config default](../../../config/platform.default.json)
- [setup CLI](../../../src/backend/platform/setup/cli.ts)
- [container runtime resolver](../../../src/backend/platform/platform-config/resolve.ts)
- [desktop shell package](../../../src/frontend/desktop/package.json)
