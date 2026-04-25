# WSL Smoke Procedure

## Prerequisites

- Windows 11 with WSL2 enabled
- Docker Desktop with WSL2 backend
- The repo cloned somewhere on the Windows filesystem (NOT inside the WSL distribution)

## Steps

1. From a PowerShell or cmd in the repo directory: `pnpm run setup`
2. `pnpm run validate`
3. `pnpm run test:smoke`
4. Create a placeholder context pack at `C:\Users\you\smoke-pack` containing a minimal `pack.json`
5. `pnpm run plan-dropbox-task -- --title smoke --summary smoke`
6. Bind the smoke task to the `C:\Users\you\smoke-pack` directory via the desktop app
7. Activate the task; confirm bootstrap-task-mcp runs without error
8. `docker ps` shows the per-task `repo-context-mcp` container
9. `docker exec <container> ls /mnt/context-pack` lists the pack contents
10. `curl http://localhost:<allocated-port>/health` returns 200 OK

## Failure modes

- If step 9 shows an empty directory: `ACTIVE_CONTEXT_PACK_HOST_DIR` did not propagate; check the env passed to bootstrap
- If step 8 shows no container: bootstrap-task-mcp failed; check the platform logs
- If step 10 fails: port allocator drift; run `pnpm run queue-status` and inspect

## Validation to run

- `grep -c "ACTIVE_CONTEXT_PACK_HOST_DIR" docs/wsl-smoke.md` should be >= 1.
- `wc -l docs/wsl-smoke.md` should be <= 60.
- `pnpm run test:contracts`
