# Troubleshooting

## Unsupported Host

TaskSail currently supports Unix-based systems such as Linux and macOS. Windows hosts are unsupported today; do not treat Windows setup failures as normal prerequisite issues.

## Setup Cannot Find Python

Install Python 3.12 or newer, then rerun:

```bash
pnpm run setup
```

If your machine has multiple Python versions, set one of the supported Python override variables in your shell before setup.

## Services Are Not Healthy

Run:

```bash
npx tsx src/backend/platform/container/cli.ts bootstrap
npx tsx src/backend/platform/container/cli.ts healthcheck
```

The default runtime is direct local execution. Docker and Podman are optional and only needed when your platform config selects a compose runtime.

## Desktop Does Not Launch

From the desktop package:

```bash
cd src/frontend/desktop
npm install
npm run dev
```

If the install fails in a firewalled environment, confirm your shell exports the package-manager mirror variables before dependency installation.

## Planner Is Locked

Select or create a context pack first. TaskSail requires an active context pack before broad agent execution.

## Queue Looks Stuck

Check status:

```bash
pnpm run queue-status
```

If status reports an interrupted publish or inconsistent queue state, run:

```bash
pnpm run repair -- --auto-fix
```

## A Setup Assistant Is Helping You

Share [Agent Setup Assistant](agent-setup-assistant.md) with the assistant. It keeps setup guidance bounded to local commands and avoids invented provider, cloud, or runtime steps.
