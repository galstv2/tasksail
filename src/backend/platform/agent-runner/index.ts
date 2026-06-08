export type {
  AgentProfile,
  RunRoleAgentOptions,
  PipelineOptions,
  AutonomyIntent,
  RegistryJson,
  RegistryAgentEntry,
  AgentRunResult,
  ContextStatus,
  ResolvedContext,
  PipelineReceipt,
} from './types.js';

export {
  loadAgentRegistry,
  resolveAgentProfile,
  resolveActiveModel,
  findRegistryEntry,
  toRegistryId,
  fromRegistryId,
} from './metadata.js';

export {
  resolveAutonomyProfile,
  buildAgentArgs,
  formatAgentCommand,
} from './autonomy.js';

export {
  roleRequiresConventions,
  resolveConventionsContext,
} from './conventions.js';

export {
  roleRequiresCorrections,
  resolveCorrectionsContext,
} from './corrections.js';

export {
  roleRequiresReinforcement,
  resolveReinforcementContext,
} from './reinforcement.js';
export { buildReinforcementOverlay } from './reinforcementOverlay.js';

export {
  guardrailReceiptPath,
  writeGuardrailReceipt,
  runRuntimePolicyCheck,
} from './guardrails.js';

export {
  launchAgent,
  waitForAgent,
  gracefulKill,
  cleanupProcesses,
} from './processLifecycle.js';

export { buildAgentEnvironment } from './environment.js';

export { createDaltonCapsule, cleanupDaltonCapsule } from './capsule.js';
export type { DaltonCapsulePaths } from './capsule.js';

export {
  detectWorkflowPath,
  detectParallelOk,
  getAgentOrder,
  runPipelineSequence,
} from './pipeline/sequencer.js';

export {
  checkAgentArtifactCompletion,
  checkAgentArtifactCompletionDetails,
  buildAgentArtifactRemediationPrompt,
} from './artifactCompletion.js';
export type {
  AgentArtifactCompletionDetails,
  AgentArtifactCompletionOptions,
} from './artifactCompletion.js';

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

export {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
} from './pythonHelpers.js';

export { runRoleAgent } from './roleAgent.js';
export { runStandaloneRoleAgent } from './standaloneRoleAgent.js';
export type {
  StandaloneRoleAgentOptions,
  StandaloneRoleAgentResult,
} from './standaloneRoleAgent.js';

export {
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
  runRealignmentAnalysis,
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

export {
  startRealignmentAnalysisJob,
} from './realignmentPhase/supervisor.js';

export type {
  RealignmentJobStartResult,
} from './realignmentPhase/supervisor.js';

export type {
  RealignmentExecutionResult,
} from './realignmentPhase/driver.js';
