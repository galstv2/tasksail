import type { ProviderRuntimeManifestEnvVar } from '../cli-provider/index.js';

export type AgentRuntimePathManifestValueKind = 'path' | 'json' | 'file' | 'scalar';

export interface AgentRuntimePathManifestEntry {
  name: string;
  value: string;
  kind: AgentRuntimePathManifestValueKind;
  description: string;
}

export interface AgentRuntimePathManifest {
  agentId: string;
  launchPhase?: string;
  agentCwd: string;
  entries: AgentRuntimePathManifestEntry[];
}

// Many of these names also appear in launchEnv.ts::TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS.
// When adding a new TASKSAIL_*, ACTIVE_CONTEXT_PACK_*, RUN_ROLE_AGENT_AUTONOMY_*,
// EXTERNAL_MCP_*, CONTEXT_PACK_*, or REPO_CONTEXT_MCP_* env key, audit both lists —
// they cannot share a source because manifest descriptors carry kind/description metadata
// and intentionally exclude secret-bearing keys like RUN_ROLE_AGENT_ACTIVE_MODEL.
const PLATFORM_RUNTIME_MANIFEST_ENV_VARS: readonly ProviderRuntimeManifestEnvVar[] = [
  { name: 'ACTIVE_CONTEXT_PACK_DIR', kind: 'path', description: 'Active context pack directory visible to this launch.' },
  { name: 'ACTIVE_CONTEXT_PACK_HOST_DIR', kind: 'path', description: 'Host path for the active context pack when container paths are used.' },
  { name: 'TASKSAIL_TASK_ID', kind: 'scalar', description: 'Current TaskSail task identifier for this launch.' },
  { name: 'TASKSAIL_TASK_BRANCHES', kind: 'json', description: 'Inline JSON branch metadata for task repo bindings.' },
  { name: 'TASKSAIL_TASK_BRANCHES_FILE', kind: 'file', description: 'File containing branch metadata when the inline value is too large.' },
  { name: 'TASKSAIL_TASK_WORKTREES', kind: 'json', description: 'Inline JSON worktree metadata for task repo bindings.' },
  { name: 'TASKSAIL_TASK_WORKTREES_FILE', kind: 'file', description: 'File containing worktree metadata when the inline value is too large.' },
  { name: 'TASKSAIL_REALIGNMENT_STAGING_PATH', kind: 'path', description: 'Standalone realignment markdown staging file path.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON', kind: 'json', description: 'Structured launch autonomy profile and boundary metadata.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON', kind: 'json', description: 'JSON array of allowed directories for this launch.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR', kind: 'path', description: 'Working directory advertised by the autonomy boundary.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS', kind: 'scalar', description: 'Autonomy boundary status for this launch.' },
  { name: 'CONTEXT_PACK_CONVENTIONS_STATUS', kind: 'scalar', description: 'Context-pack conventions availability status.' },
  { name: 'CONTEXT_PACK_CONVENTIONS_CONTEXT_FILE', kind: 'file', description: 'File containing context-pack conventions when available.' },
  { name: 'CONTEXT_PACK_CORRECTIONS_STATUS', kind: 'scalar', description: 'Context-pack corrections availability status.' },
  { name: 'CONTEXT_PACK_CORRECTIONS_CONTEXT_FILE', kind: 'file', description: 'File containing context-pack corrections when available.' },
  { name: 'EXTERNAL_MCP_CONTEXT_STATUS', kind: 'scalar', description: 'External MCP context availability status.' },
  { name: 'EXTERNAL_MCP_CONTEXT_FILE', kind: 'file', description: 'File containing launch-scoped external MCP context.' },
  { name: 'REPO_CONTEXT_MCP_URL', kind: 'scalar', description: 'Repo context MCP endpoint URL for this launch.' },
  { name: 'REPO_CONTEXT_MCP_PORT', kind: 'scalar', description: 'Repo context MCP port for this launch.' },
];

export function buildAgentRuntimePathManifest(args: {
  agentId: string;
  launchPhase?: string;
  agentCwd: string;
  env: Record<string, string>;
  providerEnvVars: readonly ProviderRuntimeManifestEnvVar[];
}): AgentRuntimePathManifest {
  const descriptors = [...PLATFORM_RUNTIME_MANIFEST_ENV_VARS, ...args.providerEnvVars];
  return {
    agentId: args.agentId,
    ...(args.launchPhase !== undefined ? { launchPhase: args.launchPhase } : {}),
    agentCwd: args.agentCwd,
    entries: descriptors.flatMap((descriptor) => {
      const value = args.env[descriptor.name];
      if (value === undefined) {
        return [];
      }
      return [{
        name: descriptor.name,
        value,
        kind: descriptor.kind,
        description: descriptor.description,
      }];
    }),
  };
}

export function renderAgentRuntimePathManifestForPrompt(
  manifest: AgentRuntimePathManifest,
): string {
  const lines = [
    '## Runtime Path Manifest',
    '',
    `Agent launch CWD: ${manifest.agentCwd}`,
    'Do not write $NAME or $NAME/... as a literal filesystem path; resolve the variable through this manifest first.',
    'If a value is JSON, parse it before using paths or branch metadata.',
    'If a _FILE value is present, read that file for the payload instead of guessing the inline value.',
    'Omitted variables are unavailable for this launch.',
    '',
  ];
  for (const entry of manifest.entries) {
    lines.push(`- ${entry.name} (${entry.kind}): ${entry.value} -- ${entry.description}`);
  }
  return lines.join('\n');
}

export function prependRuntimePathManifestToPrompt(args: {
  prompt: string;
  manifest: AgentRuntimePathManifest;
}): string {
  return `${renderAgentRuntimePathManifestForPrompt(args.manifest)}\n\n${args.prompt.trim()}`;
}
