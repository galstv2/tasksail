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
7. Add the smoke pack parent directory to `repo_context_mcp_external_mount_roots` and activate the task
8. `docker ps` shows one shared `repo-context-mcp` container
9. `docker exec repo-context-mcp ls /context-pack-roots/0` lists the pack contents
10. `curl http://localhost:8811/health` returns 200 OK

## Failure modes

- If step 9 shows an empty directory: confirm the configured external mount root is absolute and accessible to the container engine
- If step 8 shows no container: shared MCP bootstrap failed; check the platform logs
- If step 10 fails: confirm `.platform-state/platform.json` has the expected `mcp_port`

## Validation to run

- `grep -c "X-TaskSail-Context-Pack-Dir" src/backend/platform/agent-runner/roleAgent.ts` should be >= 1.
- `wc -l docs/wsl-smoke.md` should be <= 60.
- `pnpm run test:contracts`
