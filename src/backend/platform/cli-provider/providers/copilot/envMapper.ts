import type { GenericAgentEnv, ProviderRuntimeManifestEnvVar } from '../../types.js';

export const COPILOT_CONTROLLED_ENV_KEYS = [
  'COPILOT_MODEL',
  'COPILOT_AGENT_ID',
  'COPILOT_PLATFORM_REPO_ROOT',
  'COPILOT_WALL_CLOCK_TIMEOUT_S',
  'COPILOT_IDLE_TIMEOUT_S',
  'COPILOT_DISABLE_IDLE_TIMEOUT',
  'COPILOT_HANDOFFS_DIR',
  'COPILOT_IMPL_STEPS_DIR',
  'COPILOT_TARGET_REPOS_JSON',
  'COPILOT_PRIMARY_FOCUS_PATH',
  'COPILOT_PRIMARY_FOCUS_TARGET_KIND',
  'COPILOT_PRIMARY_FOCUS_TARGETS_JSON',
  'COPILOT_WRITABLE_ROOTS_JSON',
  'COPILOT_READONLY_CONTEXT_ROOTS_JSON',
  'COPILOT_TEST_TARGET_PATH',
  'COPILOT_TEST_TARGET_KIND',
  'COPILOT_CONTEXT_PACK_PATHS',
  'COPILOT_CONTEXT_PACK_SEARCH_ROOTS',
] as const;

export const COPILOT_RUNTIME_MANIFEST_ENV_VARS: readonly ProviderRuntimeManifestEnvVar[] = [
  { name: 'COPILOT_PLATFORM_REPO_ROOT', kind: 'path', description: 'TaskSail platform repository root for workflow artifacts and platform-owned runtime files.' },
  { name: 'COPILOT_HANDOFFS_DIR', kind: 'path', description: 'Concrete per-task handoffs directory for workflow markdown artifacts.' },
  { name: 'COPILOT_IMPL_STEPS_DIR', kind: 'path', description: 'Concrete per-task ImplementationSteps directory for slice files.' },
  { name: 'COPILOT_TARGET_REPOS_JSON', kind: 'json', description: 'JSON array of task-visible repository roots for this launch.' },
  { name: 'COPILOT_PRIMARY_FOCUS_PATH', kind: 'path', description: 'Primary focus path relative to the focused repository when present.' },
  { name: 'COPILOT_PRIMARY_FOCUS_TARGET_KIND', kind: 'scalar', description: 'Primary focus target kind when a focused path is present.' },
  { name: 'COPILOT_PRIMARY_FOCUS_TARGETS_JSON', kind: 'json', description: 'JSON array of Deep Focus primary targets for this launch.' },
  { name: 'COPILOT_WRITABLE_ROOTS_JSON', kind: 'json', description: 'JSON array of path-scoped writable roots for this launch.' },
  { name: 'COPILOT_READONLY_CONTEXT_ROOTS_JSON', kind: 'json', description: 'JSON array of read-only context roots for this launch.' },
  { name: 'COPILOT_TEST_TARGET_PATH', kind: 'path', description: 'Concrete test target path when a test target is selected.' },
  { name: 'COPILOT_TEST_TARGET_KIND', kind: 'scalar', description: 'Selected test target kind when present.' },
];

function setOptional(env: Record<string, string>, key: string, value: string | number | boolean | undefined): void {
  if (value !== undefined) {
    env[key] = String(value);
  }
}

export function buildCopilotEnv(generic: GenericAgentEnv): Record<string, string> {
  const env: Record<string, string> = {
    COPILOT_MODEL: generic.model,
    COPILOT_AGENT_ID: generic.agentId,
    COPILOT_PLATFORM_REPO_ROOT: generic.platformRepoRoot,
  };

  setOptional(env, 'COPILOT_WALL_CLOCK_TIMEOUT_S', generic.wallClockTimeoutS);
  setOptional(env, 'COPILOT_IDLE_TIMEOUT_S', generic.idleTimeoutS);
  if (generic.disableIdleTimeout) {
    env['COPILOT_DISABLE_IDLE_TIMEOUT'] = 'true';
  }

  setOptional(env, 'COPILOT_HANDOFFS_DIR', generic.handoffsDir);
  setOptional(env, 'COPILOT_IMPL_STEPS_DIR', generic.implStepsDir);
  setOptional(env, 'COPILOT_TARGET_REPOS_JSON', generic.targetReposJson);
  setOptional(env, 'COPILOT_PRIMARY_FOCUS_PATH', generic.primaryFocusPath);
  setOptional(env, 'COPILOT_PRIMARY_FOCUS_TARGET_KIND', generic.primaryFocusTargetKind);
  setOptional(env, 'COPILOT_PRIMARY_FOCUS_TARGETS_JSON', generic.primaryFocusTargetsJson);
  setOptional(env, 'COPILOT_WRITABLE_ROOTS_JSON', generic.writableRootsJson);
  setOptional(env, 'COPILOT_READONLY_CONTEXT_ROOTS_JSON', generic.readonlyContextRootsJson);
  setOptional(env, 'COPILOT_TEST_TARGET_PATH', generic.testTargetPath);
  setOptional(env, 'COPILOT_TEST_TARGET_KIND', generic.testTargetKind);
  setOptional(env, 'COPILOT_CONTEXT_PACK_PATHS', generic.contextPackPaths);
  setOptional(env, 'COPILOT_CONTEXT_PACK_SEARCH_ROOTS', generic.contextPackSearchRoots);

  return env;
}
