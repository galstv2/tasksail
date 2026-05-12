import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isWindowsPlatform } from '../../../core/index.js';
import type {
  AgentConfigPaths,
  CliProvider,
  PlannerChunkParser,
  PlannerLaunchOptions,
  PlannerLaunchSpec,
  ResolvedMcpServer,
  RoleKind,
} from '../../types.js';
import { buildCopilotEnv, COPILOT_CONTROLLED_ENV_KEYS } from './envMapper.js';
import { buildCopilotArgs, formatCopilotCommand, mcpConfigArgs } from './flagBuilder.js';
import { materializeCopilotPrompt, resolveCopilotPromptPath } from './promptComposer.js';
import { parseChatagentProfile } from './profileParser.js';
import { buildCopilotPlannerLaunchSpec, COPILOT_PLANNER_AGENT_ID, CopilotPlannerParser } from './plannerAdapter.js';

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

export const copilotProvider: CliProvider = {
  id: 'copilot',

  resolveCommand(): string {
    return isWindowsPlatform() ? 'copilot.cmd' : 'copilot';
  },

  buildArgs: buildCopilotArgs,

  buildEnv: buildCopilotEnv,

  formatCommand: formatCopilotCommand,

  homeDirName(): string {
    return 'copilot-home';
  },

  agentConfigPaths(): AgentConfigPaths {
    return { ...AGENT_CONFIG_PATHS };
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
    // The Copilot CLI's `--agent` mode reads role instructions from
    // `.github/copilot/instructions/*.instructions.md` and per-agent profiles
    // from `.github/agents/`, both of which are already enforced via
    // requiredDirs() and AGENT_CONFIG_PATHS. There is no top-level file the
    // Copilot CLI auto-loads at runtime, so the provider has no required
    // file-presence contract beyond the directory tree.
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

  mcpConfigArgs,

  renderMcpConfig(launchDir: string, servers: ResolvedMcpServer[]): string {
    mkdirSync(launchDir, { recursive: true });
    const configPath = path.join(launchDir, 'mcp-config.json');
    const mcpServers = Object.fromEntries(
      servers.map((server) => [
        server.id,
        {
          type: server.transport,
          url: server.url,
          headers: server.headers,
        },
      ]),
    );
    writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), 'utf-8');
    return configPath;
  },

  plannerAgentId(): string {
    return COPILOT_PLANNER_AGENT_ID;
  },

  roleKindForAgent(agentId: string): RoleKind | null {
    return COPILOT_ROLE_KINDS[agentId] ?? null;
  },

  createPlannerParser(): PlannerChunkParser {
    return new CopilotPlannerParser();
  },

  buildPlannerLaunchSpec(options: PlannerLaunchOptions): PlannerLaunchSpec {
    return buildCopilotPlannerLaunchSpec(options);
  },
};
