import type { AgentId, AutonomyProfile } from '../core/index.js';
export type { AutonomyIntent } from '../cli-provider/index.js';

/** Registry-backed agent profile resolved from the active provider registry. */
export interface AgentProfile {
  id: AgentId;
  /** Registry agent_id (e.g. "software-engineer"). */
  registryId: string;
  displayName: string;
  role: string;
  requiredModel: string;
  autonomyProfile: AutonomyProfile;
  allowedDirs?: string[];
  denyRules?: string[];
  instructionPath?: string;
  agentProfilePath?: string;
  wallClockTimeoutS?: number;
  workflowOrder: number;
  interactive?: boolean;
  idleTimeoutS?: number;
}

/** Options for the runRoleAgent entrypoint. */
export interface RunRoleAgentOptions {
  agentId: AgentId;
  taskId: string;
  repoRoot?: string;
  contextPackDir?: string;
  dryRun?: boolean;
  promptOverride?: string;
  /** Verification-only TaskSail runtime directory allowlist override. */
  verificationTempAllowedDir?: string;
  wallClockBudget?: number;
  idleTimeout?: number;
  skipWorkflowValidation?: boolean;
  /** If set, verify agentId matches this expected role before proceeding. */
  expectRole?: string;
  abortSignal?: AbortSignal;
  /** Optional phase label for the terminal UI (e.g. "Verification"). */
  launchPhase?: string;
}

/** Options for the pipeline auto-sequencer. */
export interface PipelineOptions {
  taskId: string;
  startAt?: AgentId;
  stopAfter?: AgentId;
  autoAdvance?: boolean;
  skipResetOnFailure?: boolean;
  repoRoot?: string;
}

/** Raw registry JSON shape as found in the active provider registry. */
export interface RegistryJson {
  schema_version: number;
  default_wall_clock_timeout_s: number;
  parallel_wall_clock_timeout_s: number;
  agents: RegistryAgentEntry[];
}

/** A single agent entry in the registry JSON. */
export interface RegistryAgentEntry {
  agent_id: string;
  role_name: string;
  human_name: string;
  instruction_path: string;
  agent_profile_path: string;
  autonomy_profile: string;
  required_model: string;
  pre_task?: boolean;
  interactive?: boolean;
  idle_timeout_s?: number;
  allowed_dirs?: string[];
  wall_clock_timeout_s?: number;
  workflow_order: number;
  deny_rules?: string[];
}

/** Result from launching an agent CLI process. */
export interface AgentRunResult {
  exitCode: number;
  agentId: AgentId;
  durationMs: number;
  mcpLaunch?: AgentMcpLaunchStatus;
}

/** Context resolution status. */
export type ContextStatus =
  | 'available'
  | 'not-applicable'
  | 'unavailable'
  | 'malformed';

/** Resolved context overlay (conventions, corrections, reinforcement). */
export interface ResolvedContext {
  status: ContextStatus;
  reason: string;
  injectionEnabled: boolean;
  contextFile?: string;
}

/** Pipeline timing receipt written after a pipeline run completes. */
export interface PipelineReceipt {
  status: 'completed' | 'failed' | 'killed' | 'closeout-failed';
  workflowPath: 'standard';
  totalSeconds: number;
  prewarmSeconds: number;
  agentTimings: Record<string, number>;
  failureReason?: string;
  /** Present iff status === 'closeout-failed'. */
  closeoutError?: string;
  externalMcp?: PipelineExternalMcpReceipt;
}

export interface AgentMcpLaunchStatus {
  status: string;
  reason: string;
  injectionEnabled: boolean;
  selectedServerIds: string[];
  excludedServerIds: string[];
}

export interface ExternalMcpRegistryHealth {
  status: 'available' | 'degraded';
  reason: string;
  serverCount: number;
}

export interface PipelineExternalMcpReceipt {
  registry: ExternalMcpRegistryHealth;
  agents: Partial<Record<AgentId | 'dalton-verify' | 'ron-retrospective', AgentMcpLaunchStatus>>;
}
