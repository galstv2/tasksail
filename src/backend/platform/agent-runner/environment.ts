import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ExternalMcpLaunchContext } from './pythonHelpers.js';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import type { AgentProfile } from './types.js';
import { resolveActiveModel, toRegistryId } from './metadata.js';
import { resolvePaths } from '../core/index.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { AutonomyIntent, BuildArgsResult } from '../cli-provider/index.js';

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
    wallClockTimeoutS?: number;
    focused?: FocusedRepoResult;
    /**
     * Shared MCP endpoint resolved once by the launch path. When supplied,
     * the resolved URL/port are exported as backward-compat env vars
     * (`REPO_CONTEXT_MCP_URL`, `REPO_CONTEXT_MCP_PORT`). When omitted, the
     * env vars are not written so callers cannot silently advertise a stale
     * default — the authoritative scoping is the per-launch MCP config
     * headers rendered by the active provider.
     */
    mcp?: { port: number; url: string };
  },
  taskId?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  const effectiveRepoRoot = repoRoot ?? resolvePaths({ taskId: taskId ?? '' }).repoRoot;
  const provider = getActiveProvider(effectiveRepoRoot);

  const activeModel = resolveActiveModel(profile.id, profile);
  env['RUN_ROLE_AGENT_ACTIVE_MODEL'] = activeModel;

  if (options?.mcp) {
    env['REPO_CONTEXT_MCP_URL'] = options.mcp.url;
    env['REPO_CONTEXT_MCP_PORT'] = String(options.mcp.port);
  }

  if (contextPackDir) {
    env['ACTIVE_CONTEXT_PACK_DIR'] = contextPackDir;
  }

  const paths = resolvePaths({ repoRoot: effectiveRepoRoot, taskId: taskId ?? '' });
  const providerEnv = provider.buildEnv({
    model: activeModel,
    agentId: toRegistryId(profile.id),
    wallClockTimeoutS: options?.wallClockTimeoutS ?? profile.wallClockTimeoutS,
    idleTimeoutS: profile.idleTimeoutS,
    disableIdleTimeout: profile.interactive,
    ...(!options?.skipHandoffEnvVars
      ? {
          handoffsDir: paths.handoffs,
          implStepsDir: paths.implementationSteps,
        }
      : {}),
    platformRepoRoot: effectiveRepoRoot,
    ...(options?.focused?.visibleRepoRoots?.length
      ? { targetReposJson: JSON.stringify(options.focused.visibleRepoRoots) }
      : {}),
    ...(options?.focused?.primaryFocusRelativePath
      ? { primaryFocusPath: options.focused.primaryFocusRelativePath }
      : {}),
    ...(options?.focused?.primaryFocusTargetKind
      ? { primaryFocusTargetKind: options.focused.primaryFocusTargetKind }
      : {}),
    ...(options?.focused?.writableRoots !== undefined
      ? {
          writableRootsJson: JSON.stringify(options.focused.writableRoots),
          readonlyContextRootsJson: JSON.stringify(options.focused.readonlyContextRoots ?? []),
        }
      : {}),
    ...(options?.focused?.testTarget
      ? {
          testTargetPath: options.focused.testTarget.path,
          testTargetKind: options.focused.testTarget.kind,
        }
      : {}),
  });
  Object.assign(env, providerEnv);

  env['TASKSAIL_TASK_ID'] = taskId ?? '';

  if (effectiveRepoRoot) {

    // Surface branch names and worktree roots for QA closeout and SWE git
    // commands. Reads .task.json.contextPackBinding.repoBindings[]; injects
    // TASKSAIL_TASK_BRANCHES (originalRoot → branch) and TASKSAIL_TASK_WORKTREES
    // (originalRoot → worktreeRoot). If the serialized JSON exceeds the 8192-
    // byte Windows env-block ceiling, spills to <name>_FILE instead.
    if (taskId) {
      const taskSidecar = readTaskJsonSafe(taskId, effectiveRepoRoot);
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
          repoRoot: effectiveRepoRoot,
          taskId,
          envVarName: 'TASKSAIL_TASK_BRANCHES',
          spillFileName: 'task-branches.json',
          payload: branches,
        });
        emitTaskListEnv({
          env,
          repoRoot: effectiveRepoRoot,
          taskId,
          envVarName: 'TASKSAIL_TASK_WORKTREES',
          spillFileName: 'task-worktrees.json',
          payload: worktrees,
        });
      }
    }
  }

  const missing = validateAgentEnvironment(env, effectiveRepoRoot);
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

const AUTONOMY_LABELS: Record<AgentProfile['autonomyProfile'], string> = {
  'repo-executor': 'Repo Executor',
  'qa-executor': 'QA Executor',
  'artifact-author': 'Artifact Author',
};

const AUTONOMY_DESCRIPTIONS: Record<AgentProfile['autonomyProfile'], string> = {
  'repo-executor':
    'High-autonomy repo-local execution profile for implementation and test work with explicit deny rules for destructive commands.',
  'qa-executor':
    'High-autonomy repo-local QA review profile with shell access for inspecting repo state and explicit deny rules for destructive commands.',
  'artifact-author':
    'Repo-local artifact authoring profile with autonomous read, search, and write operations but without broad shell auto-approval.',
};

function autonomyLabel(profileId: AgentProfile['autonomyProfile']): string {
  return AUTONOMY_LABELS[profileId];
}

function autonomyDescription(profileId: AgentProfile['autonomyProfile']): string {
  return AUTONOMY_DESCRIPTIONS[profileId];
}

function deriveExternalMcpCliHome(
  externalMcpContext?: ExternalMcpLaunchContext,
): string | null {
  return externalMcpContext?.launchDir ?? null;
}

export function buildAutonomyEnvironment(
  profile: AgentProfile,
  intent: AutonomyIntent,
  argsResult: BuildArgsResult,
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
    writable_roots: focused?.writableRoots ?? [],
    readonly_context_roots: focused?.readonlyContextRoots ?? [],
    // For Dalton's selected-primary path this is the activated reference repo
    // set; for broader focused-repo resolution it is the workspace-visible
    // manifest-declared repo set. Write authority remains separate either way.
    target_folders: focused?.visibleRepoRoots ?? [],
    allowed_roots: intent.allowedDirs,
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
          writable_roots: focused.writableRoots ?? [],
          readonly_context_roots: focused.readonlyContextRoots ?? [],
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
          cliHome: deriveExternalMcpCliHome(externalMcpContext),
        }
      : undefined;
  const payload = {
    profile_id: profile.autonomyProfile,
    label: autonomyLabel(profile.autonomyProfile),
    description: autonomyDescription(profile.autonomyProfile),
    boundary_kind: boundaryKind,
    tool_policy: {
      allow_all_tools: argsResult.resolvedToolPolicy.allowAllTools,
      no_ask_user: argsResult.resolvedToolPolicy.noAskUser,
      allow_tools: argsResult.resolvedToolPolicy.allowTools,
      deny_tools: argsResult.resolvedToolPolicy.denyTools,
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
    RUN_ROLE_AGENT_AUTONOMY_DISALLOW_TEMP_DIR: String(intent.disallowTempDir),
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: JSON.stringify(payload),
    // Advisory targeting metadata for focused repo/focus-path context. This is
    // intentionally separate from RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR because
    // Dalton now launches from the platform repo root.
  };
}

/**
 * Validate that required keys are present and non-empty in the agent environment.
 * Returns the list of missing or empty keys.
 */
function validateAgentEnvironment(env: Record<string, string>, repoRoot: string): string[] {
  return getActiveProvider(repoRoot).requiredEnvKeys().filter((key) => !env[key]);
}
