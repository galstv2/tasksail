// Keep this launcher-side scrub list aligned with the prompt-visible Runtime
// Path Manifest when a value should reach the agent. Model choice, internal
// bypass flags, and scalar autonomy descriptors stay launcher-only because the
// manifest exposes the structured autonomy profile instead.
const TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS = [
  'ACTIVE_CONTEXT_PACK_DIR',
  'ACTIVE_CONTEXT_PACK_HOST_DIR',
  'TASKSAIL_TASK_ID',
  'TASKSAIL_TASK_BRANCHES',
  'TASKSAIL_TASK_BRANCHES_FILE',
  'TASKSAIL_TASK_WORKTREES',
  'TASKSAIL_TASK_WORKTREES_FILE',
  'TASKSAIL_SLICE_ARTIFACT_FORMAT',
  'RUN_ROLE_AGENT_ACTIVE_MODEL',
  'RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS',
  'RUN_ROLE_AGENT_ORCHESTRATOR_ID',
  'RUN_ROLE_AGENT_AUTONOMY_PROFILE_ID',
  'RUN_ROLE_AGENT_AUTONOMY_LABEL',
  'RUN_ROLE_AGENT_AUTONOMY_DESCRIPTION',
  'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOW_ALL_TOOLS',
  'RUN_ROLE_AGENT_AUTONOMY_NO_ASK_USER',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_DENY_TOOLS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR',
  'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS',
  'RUN_ROLE_AGENT_AUTONOMY_DISALLOW_TEMP_DIR',
  'RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON',
  'REPO_CONTEXT_MCP_URL',
  'REPO_CONTEXT_MCP_PORT',
  'EXTERNAL_MCP_CONTEXT_STATUS',
  'EXTERNAL_MCP_CONTEXT_REASON',
  'EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED',
  'EXTERNAL_MCP_CONTEXT_FILE',
] as const;

export function buildTaskLaunchBaseEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  providerControlledEnvKeys: readonly string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  const controlledEnvKeys = new Set<string>([
    ...TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS,
    ...providerControlledEnvKeys,
  ]);

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined || controlledEnvKeys.has(key)) {
      continue;
    }
    env[key] = value;
  }

  return env;
}
