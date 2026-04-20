import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AgentProfile, CopilotArgs } from './types.js';
import type { ExternalMcpLaunchContext } from './pythonHelpers.js';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import { resolveActiveModel, toRegistryId } from './metadata.js';
import { resolvePaths } from '../core/index.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';

/**
 * Build the environment variables object for an agent invocation process.
 * Merges process.env with agent-specific overrides.
 */
export function buildAgentEnvironment(
  profile: AgentProfile,
  contextPackDir?: string,
  repoRoot?: string,
  options?: {
    skipHandoffEnvVars?: boolean;
    /**
     * §6.3 per-task MCP endpoint override. When provided, overrides
     * REPO_CONTEXT_MCP_URL and REPO_CONTEXT_MCP_PORT so the agent targets
     * this task's per-project compose container instead of the shell default.
     */
    mcp?: { port: number };
  },
  taskId?: string,
): Record<string, string> {
  const env: Record<string, string> = {};

  const activeModel = resolveActiveModel(profile.id, profile);
  env['COPILOT_MODEL'] = activeModel;
  env['RUN_ROLE_AGENT_ACTIVE_MODEL'] = activeModel;

  env['COPILOT_AGENT_ID'] = toRegistryId(profile.id);

  if (options?.mcp) {
    env['REPO_CONTEXT_MCP_URL'] = `http://localhost:${options.mcp.port}/sse`;
    env['REPO_CONTEXT_MCP_PORT'] = String(options.mcp.port);
  }

  if (profile.wallClockTimeoutS !== undefined) {
    env['COPILOT_WALL_CLOCK_TIMEOUT_S'] = String(profile.wallClockTimeoutS);
  }

  if (profile.idleTimeoutS !== undefined) {
    env['COPILOT_IDLE_TIMEOUT_S'] = String(profile.idleTimeoutS);
  }

  if (profile.interactive) {
    env['COPILOT_DISABLE_IDLE_TIMEOUT'] = 'true';
  }

  if (contextPackDir) {
    env['ACTIVE_CONTEXT_PACK_DIR'] = contextPackDir;
  }

  if (repoRoot) {
    const paths = resolvePaths({ repoRoot, taskId });
    if (!options?.skipHandoffEnvVars) {
      env['COPILOT_HANDOFFS_DIR'] = paths.handoffs;
      env['COPILOT_IMPL_STEPS_DIR'] = paths.implementationSteps;
    }
    env['TASKSAIL_TASK_ID'] = taskId ?? '';
    env['COPILOT_PLATFORM_REPO_ROOT'] = repoRoot;

    // §4.15 Branch-name surfacing: inject TASKSAIL_TASK_BRANCHES so Ron can
    // copy the branch names into ## Task branches in final-summary.md.
    // Reads .task.json.contextPackBinding.repoBindings[].worktreeBranch.
    // Windows env-block ceiling: if the serialized JSON exceeds 8192 bytes,
    // spill to a file and inject TASKSAIL_TASK_BRANCHES_FILE instead.
    // §B1 Worktree CWD surfacing: inject TASKSAIL_TASK_WORKTREES alongside, so
    // Dalton/Ron can resolve originalRoot → worktreeRoot for git commands and
    // path references. Same encoding + spill rule as TASKSAIL_TASK_BRANCHES.
    if (taskId) {
      const taskSidecar = readTaskJsonSafe(taskId, repoRoot);
      if (taskSidecar && taskSidecar.contextPackBinding.repoBindings.length > 0) {
        const branches = taskSidecar.contextPackBinding.repoBindings.map((rb) => ({
          originalRoot: rb.originalRoot,
          branch: rb.worktreeBranch,
        }));
        const worktrees = taskSidecar.contextPackBinding.repoBindings.map((rb) => ({
          originalRoot: rb.originalRoot,
          worktreeRoot: rb.worktreeRoot,
        }));
        emitTaskListEnv({
          env,
          repoRoot,
          taskId,
          envVarName: 'TASKSAIL_TASK_BRANCHES',
          spillFileName: 'task-branches.json',
          payload: branches,
        });
        emitTaskListEnv({
          env,
          repoRoot,
          taskId,
          envVarName: 'TASKSAIL_TASK_WORKTREES',
          spillFileName: 'task-worktrees.json',
          payload: worktrees,
        });
      }
    }
  }

  const missing = validateAgentEnvironment(env);
  if (missing.length > 0) {
    throw new Error(`Agent environment missing required keys: ${missing.join(', ')}`);
  }

  return env;
}

/**
 * Serialize a per-task list payload into either an env var (≤8192 bytes) or a
 * spill file referenced by `<envVarName>_FILE`. The 8192-byte ceiling defends
 * against the Windows env-block size limit when many bindings or long paths
 * push the JSON past what `CreateProcess` will accept.
 */
function emitTaskListEnv(args: {
  env: Record<string, string>;
  repoRoot: string;
  taskId: string;
  envVarName: string;
  spillFileName: string;
  payload: unknown;
}): void {
  const serialized = JSON.stringify(args.payload);
  const byteLen = Buffer.byteLength(serialized, 'utf8');
  if (byteLen <= 8192) {
    args.env[args.envVarName] = serialized;
    return;
  }
  const taskRuntimeDir = path.join(
    args.repoRoot, '.platform-state', 'runtime', 'tasks', args.taskId,
  );
  mkdirSync(taskRuntimeDir, { recursive: true });
  const spillPath = path.join(taskRuntimeDir, args.spillFileName);
  writeFileSync(spillPath, serialized, 'utf-8');
  args.env[`${args.envVarName}_FILE`] = spillPath;
}

function autonomyLabel(profileId: AgentProfile['autonomyProfile']): string {
  return profileId === 'repo-executor' ? 'Repo Executor' : 'Artifact Author';
}

function autonomyDescription(profileId: AgentProfile['autonomyProfile']): string {
  return profileId === 'repo-executor'
    ? 'High-autonomy repo-local execution profile for implementation and test work with explicit deny rules for destructive commands.'
    : 'Repo-local artifact authoring profile with autonomous read, search, and write operations but without broad shell auto-approval.';
}

function deriveExternalMcpCopilotHome(
  externalMcpContext?: ExternalMcpLaunchContext,
): string | null {
  return externalMcpContext?.configFilePath
    ? path.dirname(externalMcpContext.configFilePath)
    : null;
}

export function buildAutonomyEnvironment(
  profile: AgentProfile,
  autonomyArgs: CopilotArgs,
  cwd: string,
  repoRoot: string,
  focused?: FocusedRepoResult,
  contextPackDir?: string,
  externalMcpContext?: ExternalMcpLaunchContext,
): Record<string, string> {
  const boundaryKind = contextPackDir ? 'active-context-pack' : 'repo-root';
  const workingDirectory = cwd === repoRoot ? '.' : cwd;
  const workingDirectoryKind = cwd === repoRoot ? 'platform-repo-root' : 'focused-repo-root';
  const boundaryContext = {
    mode: boundaryKind,
    source: contextPackDir ? 'active-context-pack-manifest' : 'repo-root-default',
    repo_root: '.',
    active_context_pack_required: profile.autonomyProfile === 'repo-executor',
    active_context_pack_dir: contextPackDir ?? null,
    active_context_pack_id: null,
    scope_mode: focused ? 'focused' : null,
    selected_repo_ids: focused?.selectedRepoIds ?? [],
    selected_focus_ids: focused?.selectedFocusIds ?? [],
    // For Dalton's selected-primary path this is the activated reference repo
    // set; for broader focused-repo resolution it is the workspace-visible
    // manifest-declared repo set. Write authority remains separate either way.
    target_folders: focused?.visibleRepoRoots ?? [],
    allowed_roots: autonomyArgs.allowedDirs,
    // Launch CWD is tracked independently from focused targeting metadata so
    // repo-root Dalton launches still preserve focused repo/focus-path context.
    working_directory: workingDirectory,
    working_directory_kind: workingDirectoryKind,
    focused_targeting: focused
      ? {
          primary_repo_root: focused.primaryRepoRoot,
          primary_repo_id: focused.primaryRepoId,
          visible_repo_roots: focused.visibleRepoRoots,
          primary_focus_relative_path: focused.primaryFocusRelativePath ?? null,
          deep_focus_enabled: focused.deepFocusEnabled ?? false,
          primary_focus_target_kind: focused.primaryFocusTargetKind ?? null,
          test_target: focused.testTarget
            ? {
                path: focused.testTarget.path,
                kind: focused.testTarget.kind,
              }
            : null,
          support_targets: focused.supportTargets ?? [],
          warnings: focused.warnings ?? [],
        }
      : null,
    warnings: focused?.warnings ?? [],
    resolution_status: contextPackDir ? 'resolved' : 'missing-active-context-pack',
    context_pack_boundary_enforced: Boolean(contextPackDir),
  };
  const externalMcpMetadata =
    externalMcpContext && externalMcpContext.status !== 'not-applicable'
      ? {
          status: externalMcpContext.status,
          reason: externalMcpContext.reason,
          injectionEnabled: externalMcpContext.injectionEnabled,
          selectedServerIds: externalMcpContext.selectedServerIds,
          excludedServerIds: externalMcpContext.excludedServerIds,
          contextFile: externalMcpContext.envExports['EXTERNAL_MCP_CONTEXT_FILE'] ?? null,
          copilotHome: deriveExternalMcpCopilotHome(externalMcpContext),
        }
      : undefined;
  const payload = {
    profile_id: profile.autonomyProfile,
    label: autonomyLabel(profile.autonomyProfile),
    description: autonomyDescription(profile.autonomyProfile),
    boundary_kind: boundaryKind,
    tool_policy: {
      allow_all_tools: autonomyArgs.additionalFlags.includes('--allow-all-tools'),
      no_ask_user: autonomyArgs.additionalFlags.includes('--no-ask-user'),
      allow_tools: autonomyArgs.allowTools,
      deny_tools: autonomyArgs.denyTools,
    },
    boundary_context: boundaryContext,
    ...(externalMcpMetadata ? { external_mcp_context: externalMcpMetadata } : {}),
  };

  return {
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_ID: payload.profile_id,
    RUN_ROLE_AGENT_AUTONOMY_LABEL: payload.label,
    RUN_ROLE_AGENT_AUTONOMY_DESCRIPTION: payload.description,
    RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND: payload.boundary_kind,
    RUN_ROLE_AGENT_AUTONOMY_ALLOW_ALL_TOOLS: String(payload.tool_policy.allow_all_tools),
    RUN_ROLE_AGENT_AUTONOMY_NO_ASK_USER: String(payload.tool_policy.no_ask_user),
    RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON: JSON.stringify(payload.tool_policy.allow_tools),
    RUN_ROLE_AGENT_AUTONOMY_DENY_TOOLS_JSON: JSON.stringify(payload.tool_policy.deny_tools),
    RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON: JSON.stringify(boundaryContext.allowed_roots),
    RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR: boundaryContext.working_directory,
    RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS: boundaryContext.resolution_status,
    RUN_ROLE_AGENT_AUTONOMY_DISALLOW_TEMP_DIR: String(boundaryContext.context_pack_boundary_enforced),
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: JSON.stringify(payload),
    // Advisory targeting metadata for focused repo/focus-path context. This is
    // intentionally separate from RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR because
    // Dalton now launches from the platform repo root.
    ...(focused?.visibleRepoRoots?.length ? { COPILOT_TARGET_REPOS_JSON: JSON.stringify(focused.visibleRepoRoots) } : {}),
    ...(focused?.primaryFocusRelativePath
      ? { COPILOT_PRIMARY_FOCUS_PATH: focused.primaryFocusRelativePath }
      : {}),
    ...(focused?.primaryFocusTargetKind
      ? { COPILOT_PRIMARY_FOCUS_TARGET_KIND: focused.primaryFocusTargetKind }
      : {}),
    ...(focused?.testTarget
      ? {
          COPILOT_TEST_TARGET_PATH: focused.testTarget.path,
          COPILOT_TEST_TARGET_KIND: focused.testTarget.kind,
        }
      : {}),
  };
}

/** Required environment keys for an agent invocation. */
const REQUIRED_AGENT_ENV_KEYS = ['COPILOT_MODEL', 'COPILOT_AGENT_ID'] as const;

/**
 * Validate that required keys are present and non-empty in the agent environment.
 * Returns the list of missing or empty keys.
 */
function validateAgentEnvironment(env: Record<string, string>): string[] {
  return REQUIRED_AGENT_ENV_KEYS.filter((key) => !env[key]);
}
