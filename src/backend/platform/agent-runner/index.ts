// Types
export type {
  AgentProfile,
  RunRoleAgentOptions,
  PipelineOptions,
  CopilotArgs,
  RegistryJson,
  RegistryAgentEntry,
  AgentRunResult,
  ContextStatus,
  ResolvedContext,
  PipelineReceipt,
} from './types.js';

// Metadata
export {
  loadAgentRegistry,
  resolveAgentProfile,
  resolveActiveModel,
  findRegistryEntry,
  toRegistryId,
  fromRegistryId,
} from './metadata.js';

// Autonomy
export {
  resolveAutonomyProfile,
  buildCopilotArgs,
  formatCopilotCommand,
} from './autonomy.js';

// Conventions
export {
  roleRequiresConventions,
  resolveConventionsContext,
} from './conventions.js';

// Corrections
export {
  roleRequiresCorrections,
  resolveCorrectionsContext,
} from './corrections.js';

// Reinforcement
export {
  roleRequiresReinforcement,
  resolveReinforcementContext,
} from './reinforcement.js';

// Guardrails
export {
  guardrailReceiptPath,
  writeGuardrailReceipt,
  runRuntimePolicyCheck,
} from './guardrails.js';

// Process lifecycle
export {
  launchCopilot,
  waitForCopilot,
  gracefulKill,
  cleanupProcesses,
} from './processLifecycle.js';

// Environment
export { buildAgentEnvironment } from './environment.js';

// Capsule
export { createDaltonCapsule, cleanupDaltonCapsule } from './capsule.js';
export type { DaltonCapsulePaths } from './capsule.js';

// Pipeline
export {
  detectWorkflowPath,
  detectParallelOk,
  getAgentOrder,
  runPipelineSequence,
} from './pipeline/sequencer.js';

// Artifact completion
export {
  checkAgentArtifactCompletion,
  buildAgentArtifactRemediationPrompt,
} from './artifactCompletion.js';

// Runtime facts
export {
  computeRuntimeWorkflowFacts,
  writeRuntimeWorkflowFacts,
  readRuntimeWorkflowFacts,
} from './runtimeFacts.js';

export { prewarmPipelineContext } from './pipeline/contextPrewarm.js';
export {
  getCachedExternalMcpRegistry,
  prewarmExternalMcpRegistry,
} from './pipeline/externalMcpRegistryCache.js';
export {
  buildMcpContextBlock,
  buildMcpContextBlockFromServers,
  appendMcpContextBlock,
} from './pipeline/mcpPromptContext.js';
export type { McpPromptContextOptions } from './pipeline/mcpPromptContext.js';

export {
  remediationHasBlockingFindings,
  remediationClearQaFindings,
  remediationRunQaLoop,
} from './pipeline/remediation.js';

// Python helpers
export {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
} from './pythonHelpers.js';

// Role agent entrypoint
export { runRoleAgent } from './roleAgent.js';

// Reinforcement write operations
export {
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
} from './reinforcementWrite.js';

export type {
  SubmitReinforcementFeedbackOptions,
  ReinforcementFeedbackResult,
  UpdateGlobalRealignmentDocOptions,
  UpdateGlobalRealignmentDocFieldOptions,
  UpdateGlobalRealignmentDocStdinOptions,
  UpdateGlobalRealignmentDocBulkOptions,
  RealignmentDocResult,
} from './reinforcementWrite.js';

// CLI
export { main as cli } from './cli.js';
