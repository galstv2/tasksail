# Shared MCP Container Migration

TaskSail now starts one shared `repo-context-mcp` container for the repository instead of a per-task MCP container fleet. New startups sweep the old TaskSail allocation file once and best-effort stop only compose projects recorded in that file. If a workstation still has old containers or port conflicts, use this manual recovery sequence.

## Manual recovery

1. Stop the TaskSail app and any running TaskSail backend process.
2. Stop old TaskSail-recorded compose projects. For each `composeProjectName` in `.platform-state/runtime/port-allocations.json`, run:

   ```bash
   docker compose -p <composeProjectName> down
   ```

   If this repo uses Podman, run the same command with `podman compose`. Do not scan for or stop arbitrary containers; only stop projects listed in the TaskSail allocation record.
3. Delete the old allocation file:

   ```bash
   rm .platform-state/runtime/port-allocations.json
   ```

4. Restart TaskSail. The shared MCP bootstrap will recreate only the shared `repo-context-mcp` runtime state it needs.

If a compose down command fails, record the project name and stderr before restarting. Startup recovery logs the same project names so leftover containers can be diagnosed without blocking shared MCP bootstrap.
