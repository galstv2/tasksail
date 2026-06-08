# Agent Setup Assistant

Use this page when an AI assistant is helping install or run TaskSail. The assistant should keep the operator in control and only suggest local, repository-owned commands.

## Assistant Boundaries

- Do not ask the operator for secrets in chat.
- Do not invent cloud setup steps.
- Do not change package manifests, lockfiles, platform defaults, or runtime state while helping with setup.
- Do not recommend unsupported package scripts.
- Do not bypass the desktop context-pack flow for normal first-task setup.

## First Questions To Answer

- Which operating system is the operator using?
- Are Git, Node.js 24, pnpm 9+, and Python 3.12+ installed?
- Does the operator need internal npm, PyPI, Electron, Docker, or Podman mirrors?
- Does the operator have GitHub Copilot CLI access configured locally?

## Safe Command Sequence

From the repository root:

```bash
pnpm install
pnpm run setup
pnpm run validate
```

Then start the desktop app:

```bash
cd src/frontend/desktop
npm install
npm run dev
```

## Verification

If setup or app startup reports service trouble:

```bash
npx tsx src/backend/platform/container/cli.ts bootstrap
npx tsx src/backend/platform/container/cli.ts healthcheck
```

If the queue appears inconsistent:

```bash
pnpm run queue-status
pnpm run repair -- --auto-fix
```

## Handoff Back To The Operator

When setup is healthy, tell the operator to use the desktop app to create or select a context pack, preview and apply it, draft a task in the planner, and watch the task board and terminal feed.
