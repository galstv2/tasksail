// Test-only synthetic CLI provider. Proves a NON-Copilot provider can implement
// the full CliProvider interface and plug in with zero shared-code edits. It uses
// a distinct binary/flags/paths/format and REUSES the provider-neutral workflow
// contract (role IDs + registry field keys). Lives under __tests__ so the
// provider-boundary scan and the test runner both ignore it as production code.
import type { AgentId } from '../../core/index.js';
import {
  PLANNER_ROLE_ID,
  PRODUCT_MANAGER_ROLE_ID,
  SOFTWARE_ENGINEER_ROLE_ID,
  QA_ROLE_ID,
  REQUIRED_REGISTRY_FIELDS,
} from '../workflowContract.js';
import type {
  AgentConfigPaths,
  AgentProfileParseResult,
  AutonomyIntent,
  BuildArgsOptions,
  BuildArgsResult,
  CliProvider,
  GenericAgentEnv,
  PluginMetadataSummary,
  ProviderAgentProfile,
  ProviderPromptKind,
  ProviderRuntimeManifestEnvVar,
  PromptMaterializationOptions,
  PromptMaterializationResult,
  ResolvedMcpServer,
  RoleKind,
} from '../types.js';

export const STUB_PROVIDER_ID = 'stub-test-provider';

const RUNTIME_TO_PROVIDER: Record<string, string> = {
  lily: PLANNER_ROLE_ID,
  alice: PRODUCT_MANAGER_ROLE_ID,
  dalton: SOFTWARE_ENGINEER_ROLE_ID,
  'dalton-verify': SOFTWARE_ENGINEER_ROLE_ID,
  ron: QA_ROLE_ID,
};

const PROVIDER_TO_RUNTIME: Record<string, AgentId> = {
  [PLANNER_ROLE_ID]: 'lily' as AgentId,
  [PRODUCT_MANAGER_ROLE_ID]: 'alice' as AgentId,
  [SOFTWARE_ENGINEER_ROLE_ID]: 'dalton' as AgentId,
  [QA_ROLE_ID]: 'ron' as AgentId,
};

const ROLE_KINDS: Record<string, RoleKind> = {
  [PLANNER_ROLE_ID]: 'planner',
  [PRODUCT_MANAGER_ROLE_ID]: 'pm',
  [SOFTWARE_ENGINEER_ROLE_ID]: 'builder',
  [QA_ROLE_ID]: 'qa',
};

export const stubProvider: CliProvider = {
  id: STUB_PROVIDER_ID,
  cliDisplayName: () => 'Stub CLI',
  resolveCommand: () => 'stub-cli',
  buildArgs: (profile: ProviderAgentProfile, _intent: AutonomyIntent, options: BuildArgsOptions): BuildArgsResult => ({
    args: ['--role', profile.registryId],
    launchCwd: options.launchContext.requestedCwd,
    inlineAgentContext: false,
    resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] },
  }),
  buildEnv: (generic: GenericAgentEnv): Record<string, string> => ({
    STUB_MODEL: generic.model,
    STUB_REPO_ROOT: generic.platformRepoRoot,
  }),
  formatCommand: (args: string[]): string => ['stub-cli', ...args].join(' '),
  homeDirName: () => 'stub-home',
  platformRepoRootEnvVar: () => 'STUB_REPO_ROOT',
  agentConfigPaths: (): AgentConfigPaths => ({
    root: '.stub',
    instructions: '.stub/instructions',
    globalInstructions: '.stub/instructions/global.md',
    prompts: '.stub/prompts',
    profiles: '.stub/agents',
    registry: '.stub/agents/registry.json',
  }),
  instructionPathForRole: (agentId: string): string => `.stub/instructions/${agentId}.md`,
  resolvePromptPath: (kind: ProviderPromptKind): string => `.stub/prompts/${kind}.md`,
  materializePrompt: (options: PromptMaterializationOptions): PromptMaterializationResult => ({
    effectivePrompt: options.prompt,
    inlineAgentContext: false,
  }),
  parseAgentProfile: (text: string): AgentProfileParseResult => ({
    frontmatter: {},
    body: text,
    errors: [],
  }),
  requiredDirs: () => ['.stub', '.stub/agents'],
  requiredFiles: () => ['.stub/agents/registry.json'],
  requiredEnvKeys: () => [],
  controlledEnvKeys: () => ['STUB_MODEL', 'STUB_REPO_ROOT'],
  promptPathEnvVars: () => ({ handoffsDir: 'STUB_HANDOFFS_DIR', implStepsDir: 'STUB_IMPL_STEPS_DIR' }),
  contextPackEnvVars: () => ({ paths: 'STUB_CONTEXT_PACK_PATHS', searchRoots: 'STUB_CONTEXT_PACK_SEARCH_ROOTS' }),
  skillDirsEnvKey: () => 'STUB_SKILL_DIRS',
  modelCatalogPaths: () => ({
    default: 'config/stub-model-catalog.default.json',
    runtime: '.platform-state/stub-model-catalog.json',
  }),
  requiredRegistryFields: () => REQUIRED_REGISTRY_FIELDS,
  inspectPluginMetadata: async (runtimePath: string): Promise<PluginMetadataSummary> => ({
    manifestPath: runtimePath,
    name: 'stub-plugin',
    skillPathCount: 0,
    declaredComponentClasses: [],
  }),
  mcpConfigArgs: (configFilePath: string): string[] => ['--stub-mcp-config', configFilePath],
  renderMcpConfig: (launchDir: string, _servers: ResolvedMcpServer[]): string => `${launchDir}/stub-mcp.json`,
  plannerAgentId: (): string | null => PLANNER_ROLE_ID,
  roleKindForAgent: (agentId: string): RoleKind | null => ROLE_KINDS[agentId] ?? null,
  runtimeToProviderAgentId: (agentId: string): string => RUNTIME_TO_PROVIDER[agentId] ?? agentId,
  providerToRuntimeAgentId: (agentId: string): AgentId | undefined => PROVIDER_TO_RUNTIME[agentId],
  runtimeManifestEnvVars: (): readonly ProviderRuntimeManifestEnvVar[] => [],
};
