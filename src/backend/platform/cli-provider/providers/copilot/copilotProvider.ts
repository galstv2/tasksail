import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isWindowsPlatform } from '../../../core/index.js';
import type { AgentId } from '../../../core/index.js';
import type {
  AgentConfigPaths,
  CliProvider,
  PlannerChunkParser,
  PlannerLaunchOptions,
  PlannerLaunchSpec,
  ResolvedMcpServer,
  RoleKind,
} from '../../types.js';
import { buildCopilotEnv, COPILOT_CONTROLLED_ENV_KEYS, COPILOT_RUNTIME_MANIFEST_ENV_VARS } from './envMapper.js';
import { buildCopilotArgs, formatCopilotCommand, mcpConfigArgs } from './flagBuilder.js';
import { materializeCopilotPrompt, resolveCopilotPromptPath } from './promptComposer.js';
import { parseChatagentProfile } from './profileParser.js';
import { buildCopilotPlannerLaunchSpec, COPILOT_PLANNER_AGENT_ID, CopilotPlannerParser } from './plannerAdapter.js';
import { getCopilotReasoningEffortCapabilities } from './reasoningEffortCapabilities.js';
import { readCopilotPluginManifestSummary } from './launchExtensions.js';
import { REQUIRED_REGISTRY_FIELDS } from '../../workflowContract.js';

/**
 * Project a resolved MCP server into a Copilot CLI mcp-config.json entry.
 * Local (stdio) servers emit { type:'local', command, args, env, cwd?, tools };
 * url servers keep { type, url, headers } and emit tools only when present
 * (preserving existing behavior for url servers without an allowlist).
 */
function renderMcpServerEntry(server: ResolvedMcpServer): Record<string, unknown> {
  if (server.transport === 'local') {
    const entry: Record<string, unknown> = {
      type: 'local',
      command: server.command,
      args: server.args,
      env: server.env,
      tools: server.tools,
    };
    if (server.cwd !== undefined) {
      entry.cwd = server.cwd;
    }
    return entry;
  }
  const entry: Record<string, unknown> = {
    type: server.transport,
    url: server.url,
    headers: server.headers,
  };
  if (server.tools !== undefined) {
    entry.tools = server.tools;
  }
  return entry;
}

const AGENT_CONFIG_PATHS: AgentConfigPaths = {
  root: '.github/copilot',
  instructions: '.github/copilot/instructions',
  globalInstructions: '.github/copilot/instructions/global.instructions.md',
  prompts: '.github/copilot/prompts',
  profiles: '.github/agents',
  registry: '.github/agents/registry.json',
};

const COPILOT_ROLE_KINDS: Record<string, RoleKind> = {
  [COPILOT_PLANNER_AGENT_ID]: 'planner',
  'product-manager': 'pm',
  'software-engineer': 'builder',
  'software-engineer-verify': 'verifier',
  qa: 'qa',
};

// Canonical TaskSail runtime-nickname -> Copilot provider-agent-ID map. This is the
// single source of the nickname mapping; it is intentionally separate from
// COPILOT_ROLE_KINDS (keyed on provider-agent IDs -> RoleKind, not identity).
const COPILOT_RUNTIME_TO_PROVIDER_AGENT_ID: Record<AgentId, string> = {
  lily: COPILOT_PLANNER_AGENT_ID,
  alice: 'product-manager',
  dalton: 'software-engineer',
  'dalton-verify': 'software-engineer-verify',
  ron: 'qa',
};

const COPILOT_PROVIDER_TO_RUNTIME_AGENT_ID: Record<string, AgentId> = Object.fromEntries(
  Object.entries(COPILOT_RUNTIME_TO_PROVIDER_AGENT_ID).map(
    ([runtime, providerAgentId]) => [providerAgentId, runtime as AgentId],
  ),
);

export const copilotProvider: CliProvider = {
  id: 'copilot',

  cliDisplayName(): string {
    return 'Copilot CLI';
  },

  resolveCommand(): string {
    return isWindowsPlatform() ? 'copilot.cmd' : 'copilot';
  },

  buildArgs: buildCopilotArgs,

  buildEnv: buildCopilotEnv,

  formatCommand: formatCopilotCommand,

  homeDirName(): string {
    return 'copilot-home';
  },

  platformRepoRootEnvVar(): string {
    return 'COPILOT_PLATFORM_REPO_ROOT';
  },

  agentConfigPaths(): AgentConfigPaths {
    return { ...AGENT_CONFIG_PATHS };
  },

  instructionPathForRole(agentId: string): string {
    return `.github/copilot/instructions/${agentId}.instructions.md`;
  },

  resolvePromptPath(kind) {
    return resolveCopilotPromptPath(kind, AGENT_CONFIG_PATHS);
  },

  materializePrompt(options) {
    return materializeCopilotPrompt(options, AGENT_CONFIG_PATHS);
  },

  parseAgentProfile: parseChatagentProfile,

  requiredDirs(): string[] {
    return ['.github/agents', '.github/copilot'];
  },

  requiredFiles(): string[] {
    // Copilot loads role instructions from the provider-owned instructions tree
    // and per-agent profiles from `.github/agents`. Those directories are
    // already enforced, and there is no top-level runtime file contract here.
    return [];
  },

  requiredEnvKeys(): string[] {
    return ['COPILOT_MODEL', 'COPILOT_AGENT_ID'];
  },

  controlledEnvKeys(): string[] {
    return [...COPILOT_CONTROLLED_ENV_KEYS];
  },

  promptPathEnvVars(): { handoffsDir: string; implStepsDir: string } {
    return { handoffsDir: 'COPILOT_HANDOFFS_DIR', implStepsDir: 'COPILOT_IMPL_STEPS_DIR' };
  },

  contextPackEnvVars(): { paths: string; searchRoots: string } {
    return {
      paths: 'COPILOT_CONTEXT_PACK_PATHS',
      searchRoots: 'COPILOT_CONTEXT_PACK_SEARCH_ROOTS',
    };
  },

  skillDirsEnvKey(): string {
    return 'COPILOT_SKILLS_DIRS';
  },

  modelCatalogPaths(): { default: string; runtime: string } {
    return {
      default: 'config/agent-model-catalog.default.json',
      runtime: '.platform-state/agent-model-catalog.json',
    };
  },

  requiredRegistryFields(): readonly string[] {
    return REQUIRED_REGISTRY_FIELDS;
  },

  inspectPluginMetadata(runtimePath: string) {
    return readCopilotPluginManifestSummary(runtimePath);
  },

  mcpConfigArgs,

  renderMcpConfig(launchDir: string, servers: ResolvedMcpServer[]): string {
    // mcp-config.json embeds resolved Bearer tokens / env secrets.
    // Restrict the launch dir (0o700) and file (0o600) so a second local OS
    // user cannot read them. Owner-only bits are not reduced by typical umasks.
    mkdirSync(launchDir, { recursive: true, mode: 0o700 });
    const configPath = path.join(launchDir, 'mcp-config.json');
    const mcpServers = Object.fromEntries(
      servers.map((server) => [server.id, renderMcpServerEntry(server)]),
    );
    writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    return configPath;
  },

  plannerAgentId(): string {
    return COPILOT_PLANNER_AGENT_ID;
  },

  roleKindForAgent(agentId: string): RoleKind | null {
    return COPILOT_ROLE_KINDS[agentId] ?? null;
  },

  runtimeToProviderAgentId(agentId: string): string {
    return COPILOT_RUNTIME_TO_PROVIDER_AGENT_ID[agentId as AgentId] ?? agentId;
  },

  providerToRuntimeAgentId(agentId: string): AgentId | undefined {
    return COPILOT_PROVIDER_TO_RUNTIME_AGENT_ID[agentId];
  },

  runtimeManifestEnvVars() {
    return COPILOT_RUNTIME_MANIFEST_ENV_VARS;
  },

  createPlannerParser(): PlannerChunkParser {
    return new CopilotPlannerParser();
  },

  buildPlannerLaunchSpec(options: PlannerLaunchOptions): PlannerLaunchSpec {
    return buildCopilotPlannerLaunchSpec(options);
  },

  reasoningEffortCapabilities(repoRoot: string) {
    // Pass the resolved command (copilot.cmd on Windows) so the probe runs the
    // same binary the provider launches. Avoids a circular import by sending the
    // command string rather than the provider.
    return getCopilotReasoningEffortCapabilities(repoRoot, this.resolveCommand());
  },
};
