# First Run

Run these commands from a fresh checkout.

```bash
pnpm install
pnpm run setup
pnpm run validate
```

Setup creates local environment files, secures the repo-context MCP token, seeds platform config, creates queue directories, configures git hooks, seeds MCP registry data, and starts the local services needed by the default runtime.

If setup reports a Python problem, install Python 3.12 or newer and rerun setup.

## Start The Desktop App

Install and launch the desktop package:

```bash
cd src/frontend/desktop
npm install
npm run dev
```

The desktop `dev` command bootstraps platform services before starting the Vite desktop shell.

## Check Services Manually

These commands are useful when setup or desktop startup reports service trouble:

```bash
npx tsx src/backend/platform/container/cli.ts bootstrap
npx tsx src/backend/platform/container/cli.ts healthcheck
```

Continue with [Create Your First Task](03-create-your-first-task.md).
