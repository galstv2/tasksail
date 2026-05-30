import type { AgentId, AutonomyProfile } from '../core/index.js';

export interface AutonomyIntent {
  model: string;
  reasoningEffort?: string;
  autonomyProfile: AutonomyProfile;
  allowedDirs: string[];
  disallowTempDir: boolean;
}

/** URL-based resolved MCP server (http/sse). */
interface ResolvedUrlMcpServer {
  id: string;
  transport: 'http' | 'sse';
  url: string;
  headers: Record<string, string>;
  /** Optional tool allowlist; emitted only when present. */
  tools?: string[];
}

/** Local (stdio) resolved MCP server, launched as a child process by the CLI. */
interface ResolvedLocalMcpServer {
  id: string;
  transport: 'local';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  /** Required, non-empty tool allowlist (never '*'). */
  tools: string[];
}

export type ResolvedMcpServer = ResolvedUrlMcpServer | ResolvedLocalMcpServer;

export type TerminationReason =
  | 'exited'
  | 'wall-clock-timeout'
  | 'idle-timeout'
  | 'aborted'
  | 'spawn-error';

export interface RunSummary {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  terminationReason: TerminationReason;
  signalCode: NodeJS.Signals | null;
}

export interface AgentConfigPaths {
  root: string;
  instructions: string;
  globalInstructions?: string | null;
  prompts: string;
  profiles: string;
  registry: string;
}

export interface ProviderAgentProfile {
  id: AgentId;
  registryId: string;
  displayName: string;
  role: string;
  requiredModel: string;
  autonomyProfile: AutonomyProfile;
  workflowOrder: number;
  allowedDirs?: string[];
  interactive?: boolean;
  idleTimeoutS?: number;
  wallClockTimeoutS?: number;
  instructionPath?: string;
  agentProfilePath?: string;
  denyRules?: string[];
  promptPath?: string;
}

export type ProviderPromptKind =
  | 'plan-task'
  | 'start-task'
  | 'execute-task'
  | 'continue-task'
  | 'execute-task-retry'
  | 'retrospective-task'
  | 'realignment-task';

export interface AgentLaunchContext {
  repoRoot: string;
  requestedCwd: string;
  focusedRepoRoot?: string;
}

export interface PromptMaterializationOptions {
  prompt: string;
  promptPath: string | null;
  promptSource: 'file' | 'override';
  profile: ProviderAgentProfile;
  launchContext: AgentLaunchContext;
  includeGlobalInstructions: boolean;
}

export interface PromptMaterializationResult {
  effectivePrompt: string;
  inlineAgentContext: boolean;
}

export interface ResolvedToolPolicy {
  allowAllTools: boolean;
  noAskUser: boolean;
  allowTools: string[];
  denyTools: string[];
}

export interface BuildArgsResult {
  args: string[];
  launchCwd: string;
  inlineAgentContext: boolean;
  resolvedToolPolicy: ResolvedToolPolicy;
}

export interface BuildArgsOptions {
  launchContext: AgentLaunchContext;
  launchExtensions?: AgentLaunchExtensionDirs;
}

export interface GenericAgentEnv {
  model: string;
  agentId: string;
  launchExtensions?: AgentLaunchExtensionDirs;
  wallClockTimeoutS?: number;
  idleTimeoutS?: number;
  disableIdleTimeout?: boolean;
  handoffsDir?: string;
  implStepsDir?: string;
  platformRepoRoot: string;
  targetReposJson?: string;
  primaryFocusPath?: string;
  primaryFocusTargetKind?: 'file' | 'directory';
  primaryFocusTargetsJson?: string;
  writableRootsJson?: string;
  readonlyContextRootsJson?: string;
  testTargetPath?: string;
  testTargetKind?: 'file' | 'directory';
  contextPackPaths?: string;
  contextPackSearchRoots?: string;
}

export type PreparedMcpLaunchStatus =
  | 'available'
  | 'degraded'
  | 'unavailable'
  | 'malformed'
  | 'not-applicable';

export interface PreparedMcpLaunch {
  status: PreparedMcpLaunchStatus;
  reason: string;
  injectionEnabled: boolean;
  envExports: Record<string, string>;
  launchDir?: string;
  contextFile?: string;
  resolvedServers: ResolvedMcpServer[];
  selectedServerIds: string[];
  excludedServerIds: string[];
}

export interface AgentProfileParseResult {
  frontmatter: Record<string, string>;
  name?: string;
  description?: string;
  model?: string;
  body: string;
  errors: string[];
}

export interface PlannerParseContext {
  currentTurnId: string | null;
  currentSessionId?: string | null;
}

export interface PlannerUsage {
  premiumRequests?: number;
  totalApiDurationMs?: number;
  sessionDurationMs?: number;
  codeChanges?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesModified?: string[];
  };
}

export type PlannerBrokerStatus = 'idle' | 'running' | 'completed' | 'failed';

export type PlannerNormalizedEvent =
  | {
      type: 'planner.turn.started';
      brokerStatus: PlannerBrokerStatus;
      turnId: string | null;
      rawType: string | null;
      timestamp?: string;
    }
  | {
      type: 'planner.turn.message';
      brokerStatus: PlannerBrokerStatus;
      turnId: string | null;
      rawType: string | null;
      timestamp?: string;
      content: string;
      messageKind: 'delta' | 'final';
    }
  | {
      type: 'planner.turn.completed';
      brokerStatus: PlannerBrokerStatus;
      turnId: string | null;
      rawType: string | null;
      timestamp?: string;
      exitCode: number;
      usage: PlannerUsage | null;
    }
  | {
      type: 'planner.turn.failed';
      brokerStatus: PlannerBrokerStatus;
      turnId: string | null;
      rawType: string | null;
      timestamp?: string;
      error: string;
      exitCode: number | null;
    }
  | {
      type: 'planner.session.updated';
      brokerStatus: PlannerBrokerStatus;
      turnId: string | null;
      rawType: string | null;
      timestamp?: string;
      cliSessionId: string;
    };

export interface PlannerEventParseResult {
  kind: 'event' | 'parse-error';
  classification: 'renderable' | 'session-continuity' | 'ignored' | 'unknown';
  rawType: string | null;
  rawEvent: Record<string, unknown> | null;
  events: PlannerNormalizedEvent[];
  error?: { code: string; message: string; line: string };
}

export type AgentLaunchExtensionDirs = {
  pluginDirs: readonly string[];
  skillDirs: readonly string[];
};

// Compatibility alias for the Lily planner launch path. Type-identical to
// AgentLaunchExtensionDirs so existing planner consumers compile unchanged.
export type PlannerLaunchExtensionDirs = AgentLaunchExtensionDirs;

export interface PlannerLaunchOptions {
  model: string;
  reasoningEffort?: string;
  resumeSessionId?: string | null;
  plannerSessionId?: string | null;
  prompt?: string;
  promptMode: 'interactive' | 'one-shot';
  allowedRoots?: string[];
  contextPackBoundaryEnforced: boolean;
  workingDirectory?: string;
  additionalEnv?: Record<string, string>;
  /**
   * Structured focus and path metadata, identical to the shape passed to
   * provider.buildEnv for role agents. The planner launch-spec implementation
   * owns model and agentId.
   */
  focusEnv?: Omit<GenericAgentEnv, 'model' | 'agentId'>;
  lilyPersonalityId?: PlannerLilyPersonalityId;
  launchExtensions?: PlannerLaunchExtensionDirs;
}

export type PlannerLilyPersonalityId = 'balanced' | 'clinical';

export interface PlannerLaunchSpec {
  agentId: string;
  args: string[];
  launchCwd: string;
  env?: Record<string, string>;
}

export interface ProviderRuntimeManifestEnvVar {
  name: string;
  kind: 'path' | 'json' | 'file' | 'scalar';
  description: string;
}

export interface ProviderReasoningEffortCapabilities {
  providerId: string;
  cliVersion: string | null;
  effortChoices: string[];
  source: 'cache' | 'probe' | 'unavailable';
  stale: boolean;
  error?: string;
  errorCode?: 'probe-failed' | 'effort-flag-missing' | 'choices-unparseable';
}

export interface PlannerChunkParser {
  parseChunk(chunk: string): PlannerEventParseResult[];
  flush(): PlannerEventParseResult[];
}

export type RoleKind = 'planner' | 'pm' | 'builder' | 'verifier' | 'qa';

export interface CliProvider {
  readonly id: string;
  resolveCommand(): string;
  buildArgs(profile: ProviderAgentProfile, intent: AutonomyIntent, options: BuildArgsOptions): BuildArgsResult;
  buildEnv(generic: GenericAgentEnv): Record<string, string>;
  formatCommand(args: string[]): string;
  homeDirName(): string;
  agentConfigPaths(): AgentConfigPaths;
  resolvePromptPath(kind: ProviderPromptKind): string;
  materializePrompt(options: PromptMaterializationOptions): PromptMaterializationResult;
  parseAgentProfile(text: string): AgentProfileParseResult;
  requiredDirs(): string[];
  requiredFiles(): string[];
  requiredEnvKeys(): string[];
  controlledEnvKeys(): string[];
  promptPathEnvVars(): { handoffsDir: string; implStepsDir: string };
  contextPackEnvVars(): { paths: string; searchRoots: string };
  mcpConfigArgs(configFilePath: string): string[];
  renderMcpConfig(launchDir: string, servers: ResolvedMcpServer[]): string;
  plannerAgentId(): string | null;
  roleKindForAgent(agentId: string): RoleKind | null;
  runtimeManifestEnvVars(): readonly ProviderRuntimeManifestEnvVar[];
  createPlannerParser?(): PlannerChunkParser | null;
  buildPlannerLaunchSpec?(options: PlannerLaunchOptions): PlannerLaunchSpec | null;
  reasoningEffortCapabilities?(repoRoot: string): Promise<ProviderReasoningEffortCapabilities>;
}
