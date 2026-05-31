import {
  createLogger,
  resolvePaths,
  readTextFile,
  writeTextFile,
  ensureDir,
  nowIsoCompact,
  getErrorMessage,
  newSpanId,
  STANDARD_AGENT_ORDER,
  emitTaskProgressEvent,
} from '../../core/index.js';
import type { AgentId } from '../../core/index.js';
import path from 'node:path';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { readTaskJsonSafe } from '../../queue/taskJson.js';
import type { PipelineOptions, PipelineReceipt } from '../types.js';
import { runRoleAgent } from '../roleAgent.js';
import { runRuntimePolicyCheck } from '../guardrails.js';
import { detectParallelOk } from '../artifactCompletion.js';
import {
  listSliceArtifactFiles,
  sliceIdFromFilename,
} from '../../workflow-policy/sliceArtifacts.js';
import type { SliceArtifactFormat } from '../../platform-config/types.js';
import { prewarmPipelineContext } from './contextPrewarm.js';
import { getCachedExternalMcpRegistry, getCachedExternalMcpRegistryHealth } from './externalMcpRegistryCache.js';
import { appendMcpContextBlock } from './mcpPromptContext.js';
import { formatRegularDaltonOverlaySections } from './regularDaltonOverlays.js';
import { remediationHasBlockingFindings, remediationRunQaLoop, remediationClearCloseoutArtifacts } from './remediation.js';
import { resolveVerificationDaltonPrompt } from './verificationPass.js';
import {
  captureSliceValidation,
  buildTestCapturePrompt,
  resolveTestCaptureCwd,
  type TestCaptureResult,
} from './testCapture.js';
import {
  buildCycleContextBundle,
  buildRetrospectivePrompt,
  shouldRunRetrospectivePhase,
} from './retrospectivePhase.js';
import { appendFocusBlock, type FocusScopePromptOptions } from './focusScopePrompt.js';
import { moveFailedItemToErrorItems } from '../../queue/errorItems.js';
import { completePendingItem } from '../../queue/completePendingItem.js';
import { runPolicyValidation } from '../../queue/policyValidation.js';
import { implementationStepsTemplatePath } from '../../queue/paths.js';
import {
  clearPipelineKill,
  pipelineKillSwitchExists,
  readPipelineKillRequest,
} from './runtimeControl.js';
import { resolveSelectedPrimaryRepoRoot } from '../../context-pack/focusedRepo.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';
import type { AgentMcpLaunchStatus } from '../types.js';
import { captureCodeDiff } from '../pythonHelpers.js';

export const CLOSEOUT_FAILURE_EXIT_CODE = 78;
const log = createLogger('platform/agent-runner/pipeline/sequencer');

const MISSING_MCP_LAUNCH_STATUS: AgentMcpLaunchStatus = {
  status: 'unknown',
  reason: 'launch completed without MCP summary',
  injectionEnabled: false,
  selectedServerIds: [],
  excludedServerIds: [],
};

interface PipelineLock {
  release: () => Promise<void>;
}

interface VerificationDiffStage {
  verificationRunId: string;
  verificationDiffDir: string;
  verificationDiffAbsolutePath: string;
}

interface RegularDaltonPromptContext {
  repoRoot?: string;
  contextPackDir?: string;
}

interface RuntimePolicyViolationSummary {
  severity?: string;
  rule_id?: string;
  artifact?: string;
  message?: string;
  remediation?: string;
}

interface RuntimePolicySummary {
  violations?: RuntimePolicyViolationSummary[];
  next_steps?: string[];
  guardrail?: {
    expected_agent_id?: string;
    requested_agent_id?: string;
  };
}


function resolveVerificationDiffStage(taskRuntime: string): VerificationDiffStage {
  const verificationRunId = nowIsoCompact();
  const verificationDiffDir = path.join(
    taskRuntime,
    'verification',
    verificationRunId,
  );
  return {
    verificationRunId,
    verificationDiffDir,
    verificationDiffAbsolutePath: path.join(verificationDiffDir, 'code-changes.diff'),
  };
}

function joinVerificationWarnings(...warnings: Array<string | undefined>): string | undefined {
  const messages = warnings
    .map((warning) => warning?.trim())
    .filter((warning): warning is string => Boolean(warning));
  return messages.length > 0 ? messages.join(' ') : undefined;
}

async function refreshVerificationQaDiffArtifact(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir: string;
  contextPackDir?: string;
  abortSignal?: AbortSignal;
  reason: 'pre-verification' | 'post-verification';
}): Promise<string | undefined> {
  const verificationLog = log.child({ taskId: options.taskId });
  const outputPath = path.join(options.handoffsDir, 'code-changes.diff');
  try {
    const result = await captureCodeDiff({
      outputPath,
      repoRoot: options.repoRoot,
      taskId: options.taskId,
      abortSignal: options.abortSignal,
    });
    const diagnostics: string[] = [];
    if (result.exitCode !== 0) {
      diagnostics.push(`diff generation exited with code ${result.exitCode}.`);
    }
    if (result.stderr.trim()) {
      diagnostics.push(result.stderr.trim());
    }
    if (diagnostics.length === 0) {
      return undefined;
    }
    const warning = `The orchestrator reported a ${options.reason} verification diff warning: ${diagnostics.join(' ')}`;
    verificationLog.warn('verification_diff.warning', { reason: options.reason, warning });
    return warning;
  } catch (error) {
    const warning = `The orchestrator could not refresh the ${options.reason} verification diff artifact: ${getErrorMessage(error)}`;
    verificationLog.warn('verification_diff.refresh.failed', { reason: options.reason, warning });
    return warning;
  }
}

async function cleanupVerificationDiffStage(
  verificationDiffStage: VerificationDiffStage,
  reason: 'stale-cleanup' | 'post-verification-cleanup',
): Promise<void> {
  try {
    await rm(verificationDiffStage.verificationDiffAbsolutePath, { force: true });
  } catch (error) {
    log.warn('verification_diff.cleanup_file.failed', { reason, path: verificationDiffStage.verificationDiffAbsolutePath, error: getErrorMessage(error) });
  }

  try {
    await rm(verificationDiffStage.verificationDiffDir, { recursive: true, force: true });
  } catch (error) {
    log.warn('verification_diff.cleanup_dir.failed', { reason, path: verificationDiffStage.verificationDiffDir, error: getErrorMessage(error) });
  }
}

async function stageVerificationDiffArtifact(options: {
  sharedDiffPath: string;
  verificationDiffStage: VerificationDiffStage;
}): Promise<{ staged: boolean; warning?: string }> {
  await cleanupVerificationDiffStage(options.verificationDiffStage, 'stale-cleanup');

  try {
    await mkdir(options.verificationDiffStage.verificationDiffDir, { recursive: true });
    await copyFile(
      options.sharedDiffPath,
      options.verificationDiffStage.verificationDiffAbsolutePath,
    );
    return { staged: true };
  } catch (error) {
    const warning =
      `The orchestrator could not stage the verification diff file at ${options.verificationDiffStage.verificationDiffAbsolutePath}: ` +
      `${getErrorMessage(error)}. Inspect the changed repo files manually.`;
    log.warn('verification_diff.stage.failed', { warning });
    return { staged: false, warning };
  }
}


function startKillSwitchMonitor(
  repoRoot: string,
  taskId: string,
  abortController: AbortController,
): () => void {
  const timer = setInterval(() => {
    if (pipelineKillSwitchExists(repoRoot, taskId) && !abortController.signal.aborted) {
      abortController.abort();
    }
  }, 250);
  return () => clearInterval(timer);
}

function ensurePipelineNotKilled(
  repoRoot: string,
  taskId: string,
  abortController: AbortController,
): void {
  if (pipelineKillSwitchExists(repoRoot, taskId) && !abortController.signal.aborted) {
    abortController.abort();
  }
  if (abortController.signal.aborted) {
    throw new Error('Pipeline kill requested.');
  }
}

function extractPolicyFailureDetails(
  policyResult: { stdout: string; stderr: string },
): string {
  const stderr = policyResult.stderr.trim();
  if (stderr) {
    return stderr;
  }
  return policyResult.stdout.trim();
}

export function buildFleetDaltonCleanupPrompt(
  cleanupContext: string,
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
): string {
  const sections = [
    'Your previous Dalton fleet run did not leave the workflow ready for QA.',
    '',
  ];
  appendFocusBlock(sections, focusScope);
  appendMcpContextBlock(sections, externalMcpRegistry, 'dalton');
  if (cleanupContext.trim()) {
    sections.push(cleanupContext.trim(), '');
  } else {
    sections.push(
      'Inspect the code and validation results, fix only what is still preventing QA handoff, and ensure all tests pass.',
      '',
    );
  }
  sections.push('Fix only what is still preventing QA handoff. Do not do broader cleanup or extra work.');
  sections.push('Ensure all tests pass.');
  return sections.join('\n');
}

function cleanupArtifactLabel(artifactPath: string): string {
  return artifactPath
    .replace(/^AgentWorkSpace\/tasks\/[^/]+\/handoffs\//, '')
    .replace(/^AgentWorkSpace\/tasks\/[^/]+\/ImplementationSteps\//, '');
}

function resolveCleanupArtifactAbsolutePath(
  artifactPath: string,
  repoRoot: string,
  handoffsDir: string,
  implStepsDir: string,
): string | undefined {
  const absoluteArtifact = path.resolve(repoRoot, artifactPath);
  const relToHandoffs = path.relative(handoffsDir, absoluteArtifact);
  if (!relToHandoffs.startsWith('..')) {
    return absoluteArtifact;
  }
  const relToImplSteps = path.relative(implStepsDir, absoluteArtifact);
  if (!relToImplSteps.startsWith('..')) {
    return absoluteArtifact;
  }
  return undefined;
}

async function buildInlineCleanupArtifactContext(options: {
  repoRoot: string;
  handoffsDir: string;
  implStepsDir: string;
  violations: RuntimePolicyViolationSummary[];
}): Promise<string> {
  const uniqueArtifacts = new Set(
    options.violations
      .map((violation) => violation.artifact?.trim())
      .filter((artifactPath): artifactPath is string => Boolean(artifactPath)),
  );

  if (uniqueArtifacts.size === 0) {
    return '';
  }

  const sections: string[] = ['## Inline Blocking Artifact Context', ''];
  let hasContext = false;
  for (const artifactPath of uniqueArtifacts) {
    const absolutePath = resolveCleanupArtifactAbsolutePath(
      artifactPath,
      options.repoRoot,
      options.handoffsDir,
      options.implStepsDir,
    );
    if (!absolutePath) {
      continue;
    }
    const content = await readTextFile(absolutePath);
    sections.push(`### ${cleanupArtifactLabel(artifactPath)}`);
    if (content?.trim()) {
      sections.push('', content.trim(), '');
    } else {
      sections.push('', 'Current artifact state: missing or empty.', '');
    }
    hasContext = true;
  }

  return hasContext ? sections.join('\n').trim() : '';
}

function tryParseRuntimePolicySummary(policyOutput: string): RuntimePolicySummary | undefined {
  const trimmed = policyOutput.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as RuntimePolicySummary;
  } catch {
    return undefined;
  }
}

export async function buildFleetDaltonCleanupContext(options: {
  repoRoot: string;
  handoffsDir: string;
  implStepsDir: string;
  policyResult: {
    stdout: string;
    stderr: string;
  };
}): Promise<string> {
  const policyDetails = extractPolicyFailureDetails(options.policyResult).trim();
  const parsedPolicy = tryParseRuntimePolicySummary(options.policyResult.stdout);

  if (!parsedPolicy) {
    return policyDetails ? `Blocking workflow-policy details: ${policyDetails}` : '';
  }

  const sections: string[] = [];
  const expectedAgentId = parsedPolicy.guardrail?.expected_agent_id?.trim();
  const requestedAgentId = parsedPolicy.guardrail?.requested_agent_id?.trim();
  if (expectedAgentId) {
    sections.push(
      `Workflow guardrail requires ${expectedAgentId}${requestedAgentId ? ` instead of ${requestedAgentId}` : ''}.`,
      '',
    );
  }

  const violations = parsedPolicy.violations ?? [];
  if (violations.length > 0) {
    sections.push('## Blocking Workflow Violations', '');
    for (const violation of violations) {
      const summaryPrefix = [
        violation.severity?.trim() ? `[${violation.severity.trim()}]` : undefined,
        violation.rule_id?.trim(),
      ].filter((part): part is string => Boolean(part)).join(' ');
      const artifactLabel = violation.artifact?.trim()
        ? cleanupArtifactLabel(violation.artifact.trim())
        : undefined;
      const summary = `${summaryPrefix || 'Policy violation'}${artifactLabel ? ` (${artifactLabel})` : ''}${violation.message?.trim() ? `: ${violation.message.trim()}` : ''}`;
      sections.push(`- ${summary}`);
      if (violation.remediation?.trim()) {
        sections.push(`  Required follow-up: ${violation.remediation.trim()}`);
      }
    }
    sections.push('');
  } else if (policyDetails) {
    sections.push(`Blocking workflow-policy details: ${policyDetails}`, '');
  }

  const nextSteps = (parsedPolicy.next_steps ?? [])
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
  if (nextSteps.length > 0) {
    sections.push('## Workflow Next Steps', '');
    sections.push(...nextSteps.map((step) => `- ${step}`));
    sections.push('');
  }

  const artifactContext = await buildInlineCleanupArtifactContext({
    repoRoot: options.repoRoot,
    handoffsDir: options.handoffsDir,
    implStepsDir: options.implStepsDir,
    violations,
  });
  if (artifactContext) {
    sections.push(artifactContext, '');
  }

  return sections.join('\n').trim();
}

export async function readImplSpec(handoffsDir: string): Promise<string | undefined> {
  return readTextFile(path.join(handoffsDir, 'implementation-spec.md'));
}

/**
 * Read active-format slices from implStepsDir and format them as prompt sections.
 * Used by fleet, simple, and remediation prompt builders.
 * Only slices matching the frozen format are injected; wrong-format slices are skipped.
 */
export async function formatSliceSections(
  implStepsDir: string,
  headingLevel: '##' | '###' = '##',
  format: SliceArtifactFormat = 'markdown',
): Promise<{ files: string[]; formatted: string }> {
  const sliceFiles = await listSliceArtifactFiles(implStepsDir, format);
  if (sliceFiles.length === 0) {
    return { files: [], formatted: '' };
  }
  const sliceContents = await Promise.all(sliceFiles.map((f) => readTextFile(f)));
  const parts: string[] = [];
  for (let i = 0; i < sliceFiles.length; i++) {
    const sliceId = sliceIdFromFilename(sliceFiles[i], format);
    parts.push(`${headingLevel} Slice: ${sliceId}`);
    parts.push('');
    if (sliceContents[i]?.trim()) {
      parts.push(sliceContents[i]!.trim());
    }
    parts.push('');
  }
  return { files: sliceFiles, formatted: parts.join('\n') };
}

// Invariant: implStepsDir, handoffsDir, and every sub-Dalton runRoleAgent call MUST be per-task (§4.12).
export async function buildFleetPrompt(
  implStepsDir: string,
  handoffsDir: string,
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
  regularDaltonContext?: RegularDaltonPromptContext,
  format: SliceArtifactFormat = 'markdown',
): Promise<string> {
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '##', format);
  if (sliceFiles.length === 0) {
    throw new Error('Fleet mode triggered but no slice files found in ImplementationSteps/');
  }

  const parts: string[] = [
    'You are running in fleet mode. Multiple implementation slices are available.',
    'You have full discretion on how to organize your work across subagents.',
    'Analyze the slices below, identify dependencies, and decide which slices can',
    'run in parallel vs. which must be sequential.',
    '',
  ];
  appendFocusBlock(parts, focusScope);
  appendMcpContextBlock(parts, externalMcpRegistry, 'dalton');

  const implSpec = await readImplSpec(handoffsDir);
  if (implSpec?.trim()) {
    parts.push('## Implementation Spec\n');
    parts.push(implSpec.trim());
    parts.push('');
  }

  const overlayBlock = await formatRegularDaltonOverlaySections(
    regularDaltonContext?.contextPackDir,
    regularDaltonContext?.repoRoot,
  );
  parts.push(`Total slices: ${sliceFiles.length}`);
  parts.push('Complete coverage of every listed slice is required. Coordinate or sequence the work, but do not exit until every slice is complete or every incomplete slice has a documented unavailable prerequisite with paths or commands checked.');
  parts.push('');
  parts.push(sliceBlock);

  if (overlayBlock) {
    parts.push('');
    parts.push(overlayBlock);
    parts.push('');
  }

  parts.push(
    'After implementation, ensure all tests pass before exiting.',
  );

  return parts.join('\n');
}

export async function buildSimpleDaltonPrompt(
  implStepsDir: string,
  handoffsDir: string,
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
  regularDaltonContext?: RegularDaltonPromptContext,
  format: SliceArtifactFormat = 'markdown',
): Promise<string> {
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '###', format);

  const implSpec = await readImplSpec(handoffsDir);

  const parts: string[] = [];
  appendFocusBlock(parts, focusScope);
  appendMcpContextBlock(parts, externalMcpRegistry, 'dalton');

  if (implSpec?.trim()) {
    parts.push('## Implementation Spec\n');
    parts.push(implSpec.trim());
    parts.push('');
  }

  const overlayBlock = await formatRegularDaltonOverlaySections(
    regularDaltonContext?.contextPackDir,
    regularDaltonContext?.repoRoot,
  );
  if (sliceFiles.length > 0) {
    parts.push(`## Implementation Slices (${sliceFiles.length} total)\n`);
    parts.push(`This Dalton launch owns all ${sliceFiles.length} listed slice${sliceFiles.length === 1 ? '' : 's'}. Slices are not future turns or optional follow-ups. Do not stop after the first slice. Complete every listed slice before final validation and exit. If a required source file, tool, or permission is unavailable after lookup and validation-debugging, identify the specific incomplete slice, document the paths or commands checked, and do not claim the overall task is complete.`);
    parts.push('');
    parts.push(sliceBlock);
  }

  if (overlayBlock) {
    parts.push('');
    parts.push(overlayBlock);
    parts.push('');
  }

  parts.push('Implement the changes described above. Before exiting, verify each listed slice is complete. For any incomplete slice, document the unavailable prerequisite and evidence, do not claim the overall task is complete, then ensure all runnable tests pass.');

  return parts.join('\n');
}

async function removeSliceTemplateIfPresent(
  implementationStepsDir: string,
): Promise<void> {
  await rm(implementationStepsTemplatePath(implementationStepsDir), { force: true });
}

async function writePipelineReceipt(
  taskRuntime: string,
  receipt: PipelineReceipt,
): Promise<void> {
  await ensureDir(taskRuntime);
  await writeTextFile(
    path.join(taskRuntime, 'pipeline-receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
}

export async function writePipelinePhase(
  taskRuntime: string,
  phase: string,
): Promise<void> {
  const phaseFile = path.join(taskRuntime, 'pipeline-phase.json');
  await writeTextFile(
    phaseFile,
    JSON.stringify({ phase, timestamp: nowIsoCompact() }) + '\n',
  );
}

/**
 * Run test capture with pipeline phase tracking.
 * Emits `test-capture-started`/`completed` when a CWD is available,
 * or `test-capture-skipped` when it is not.
 */
export async function runTestCaptureWithPhaseTracking(options: {
  taskRuntime: string;
  implementationStepsDir: string;
  captureCwd: string | null | undefined;
  abortSignal?: AbortSignal;
  pipelineTaskId?: string;
  repoRoot?: string;
  sliceFormat?: SliceArtifactFormat;
}): Promise<{ results: TestCaptureResult[]; skipped: boolean }> {
  const emitPipelinePhaseProgress = async (
    nextPhase: string,
    priorPhase: string | null = null,
  ): Promise<void> => {
    if (!options.pipelineTaskId) {
      return;
    }
    if (!options.repoRoot) {
      return;
    }
    await emitTaskProgressEvent({
      logger: log.child({ taskId: options.pipelineTaskId }),
      repoRoot: options.repoRoot,
      taskId: options.pipelineTaskId,
      event: { type: 'pipeline.phase', input: { phase: nextPhase, priorPhase } },
    });
  };
  const emitTestCaptureEvent = async (type: 'test_capture.started' | 'test_capture.completed' | 'test_capture.skipped'): Promise<void> => {
    if (!options.pipelineTaskId || !options.repoRoot) return;
    if (type === 'test_capture.started') {
      await emitTaskProgressEvent({ logger: log.child({ taskId: options.pipelineTaskId }), repoRoot: options.repoRoot, taskId: options.pipelineTaskId, event: { type: 'test_capture.started' } });
    } else if (type === 'test_capture.completed') {
      await emitTaskProgressEvent({ logger: log.child({ taskId: options.pipelineTaskId }), repoRoot: options.repoRoot, taskId: options.pipelineTaskId, event: { type: 'test_capture.completed' } });
    } else {
      await emitTaskProgressEvent({ logger: log.child({ taskId: options.pipelineTaskId }), repoRoot: options.repoRoot, taskId: options.pipelineTaskId, event: { type: 'test_capture.skipped' } });
    }
  };

  if (options.captureCwd) {
    await writePipelinePhase(options.taskRuntime, 'test-capture-started');
    await emitPipelinePhaseProgress('test-capture-started');
    await emitTestCaptureEvent('test_capture.started');
    const results = await captureSliceValidation(options.implementationStepsDir, options.captureCwd, options.abortSignal, options.sliceFormat);
    await writePipelinePhase(options.taskRuntime, 'test-capture-completed');
    await emitPipelinePhaseProgress('test-capture-completed', 'test-capture-started');
    await emitTestCaptureEvent('test_capture.completed');
    return { results, skipped: false };
  }
  await writePipelinePhase(options.taskRuntime, 'test-capture-skipped');
  await emitPipelinePhaseProgress('test-capture-skipped');
  await emitTestCaptureEvent('test_capture.skipped');
  return { results: [], skipped: true };
}

async function handlePipelineFailure(
  repoRoot: string,
  _contextPackDir: string | undefined,
  taskId: string,
): Promise<void> {
  try {
    await moveFailedItemToErrorItems({
      repoRoot,
      taskId,
    });
  } catch (err) {
    log.warn('error_items.move.failed', { taskId, error: getErrorMessage(err) });
  }
}

async function acquirePipelineLock(taskRuntime: string): Promise<PipelineLock> {
  const lockDir = path.join(taskRuntime, 'pipeline.lock');
  const ownerPath = path.join(lockDir, 'owner.json');
  await ensureDir(taskRuntime);

  try {
    await mkdir(lockDir);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      let ownerSummary = 'unknown owner';
      try {
        const ownerRaw = await readFile(ownerPath, 'utf-8');
        ownerSummary = ownerRaw.trim();
      } catch {
        // Keep the lock contention error deterministic even if the owner file is missing.
      }
      throw new Error(
        `Another pipeline run is already active. Lock: ${lockDir}. Owner: ${ownerSummary}`,
      );
    }
    throw err;
  }

  await writeTextFile(
    ownerPath,
    JSON.stringify({
      pid: process.pid,
      started_at: new Date().toISOString(),
    }, null, 2) + '\n',
  );

  return {
    release: async () => {
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

/**
 * Read the task-bound context pack dir from the per-task .task.json sidecar
 * (§3.2). When taskId is set, reads AgentWorkSpace/tasks/<taskId>/.task.json
 * via readTaskJsonSafe and derives the directory from contextPackPath.
 *
 * Returns undefined when no taskId is provided or when no context pack is configured.
 */
async function resolveTaskBoundContextPackDir(
  repoRoot: string,
  taskId?: string,
): Promise<string | undefined> {
  // Per-task path: read the .task.json sidecar (one of the two authorized safe callers).
  if (taskId) {
    const sidecar = readTaskJsonSafe(taskId, repoRoot);
    if (sidecar?.contextPackBinding.contextPackPath) {
      return path.dirname(sidecar.contextPackBinding.contextPackPath);
    }
    return undefined;
  }

  return undefined;
}

/** Fast path is retired, so workflow routing always resolves to standard. */
export async function detectWorkflowPath(
  _handoffsDir: string,
): Promise<'standard'> {
  return 'standard';
}

export { detectParallelOk } from '../artifactCompletion.js';

/**
 * Get the agent order for a given workflow path.
 */
export function getAgentOrder(): AgentId[] {
  return [...STANDARD_AGENT_ORDER];
}

function selectAgentOrder(options: PipelineOptions): AgentId[] {
  const fullOrder = getAgentOrder();
  const startIndex = options.startAt ? fullOrder.indexOf(options.startAt) : 0;
  const stopIndex = options.stopAfter ? fullOrder.indexOf(options.stopAfter) : fullOrder.length - 1;

  if (startIndex < 0) {
    throw new Error(`Unknown startAt agent: ${options.startAt}`);
  }
  if (stopIndex < 0) {
    throw new Error(`Unknown stopAfter agent: ${options.stopAfter}`);
  }
  if (startIndex > stopIndex) {
    throw new Error(
      `Pipeline stopAfter (${options.stopAfter}) cannot precede startAt (${options.startAt}).`,
    );
  }

  return fullOrder.slice(startIndex, stopIndex + 1);
}

async function runRetrospectivePhaseIfNeeded(options: {
  handoffsDir: string;
  repoRoot: string;
  contextPackDir?: string;
  currentTaskId: string;
  externalMcpRegistry?: ExternalMcpRegistry;
  abortSignal: AbortSignal;
  agentMcpStatuses: NonNullable<PipelineReceipt['externalMcp']>['agents'];
  agentTimings: Record<string, number>;
}): Promise<void> {
  if (!(await shouldRunRetrospectivePhase(options.handoffsDir))) {
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.skipped' } });
    return;
  }
  if (!options.contextPackDir) {
    log.warn('retrospective_phase.skipped', { reason: 'no-active-context-pack' });
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.skipped' } });
    return;
  }

  const bundle = await buildCycleContextBundle({
    repoRoot: options.repoRoot,
    contextPackDir: options.contextPackDir,
    handoffsDir: options.handoffsDir,
    currentTaskId: options.currentTaskId,
  });
  if (!bundle.some((entry) => !entry.isCurrentTask)) {
    log.warn('retrospective_phase.skipped', { reason: 'no-prior-cycle-context' });
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.skipped' } });
    return;
  }

  const retrospectivePrompt = await buildRetrospectivePrompt({
    repoRoot: options.repoRoot,
    bundle,
    externalMcpRegistry: options.externalMcpRegistry,
  });
  const retrospectiveStart = Date.now();
  await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.started' } });
  const retrospectiveResult = await runRoleAgent({
    agentId: 'ron',
    repoRoot: options.repoRoot,
    taskId: options.currentTaskId ?? '',
    spanId: newSpanId(),
    skipWorkflowValidation: true,
    contextPackDir: options.contextPackDir,
    abortSignal: options.abortSignal,
    promptOverride: retrospectivePrompt,
    launchPhase: 'Retrospective',
  }).catch(async (err) => {
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.failed' } });
    throw err;
  });
  await emitTaskProgressEvent({ logger: log.child({ taskId: options.currentTaskId }), repoRoot: options.repoRoot, taskId: options.currentTaskId, event: { type: 'retrospective.completed' } });
  options.agentMcpStatuses['ron-retrospective'] = retrospectiveResult.mcpLaunch ?? MISSING_MCP_LAUNCH_STATUS;
  options.agentTimings['ron-retrospective'] = Math.round((Date.now() - retrospectiveStart) / 1000);
}

/**
 * Run the full pipeline sequence: iterate agents in workflow order,
 * handle optional parallel daltons, and the QA remediation loop.
 */
export async function runPipelineSequence(
  options: PipelineOptions,
): Promise<PipelineReceipt> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const lock = await acquirePipelineLock(paths.taskRuntime);
  const pipelineStart = Date.now();
  const pipelineSpanId = newSpanId();
  const abortController = new AbortController();
  const pipelineTaskId = options.taskId ?? '';
  const pipelineLog = log.child({ taskId: pipelineTaskId, spanId: pipelineSpanId });
  const stopKillMonitor = startKillSwitchMonitor(paths.repoRoot, pipelineTaskId, abortController);
  let workflowPath: 'standard' = 'standard';
  let prewarmSeconds = 0;
  const agentTimings: Record<string, number> = {};
  const agentMcpStatuses: NonNullable<PipelineReceipt['externalMcp']>['agents'] = {};

  // Resolve the task-bound context pack before the try block so the catch
  // handler can pass it to handlePipelineFailure on error.
  const taskBoundContextPackDir = await resolveTaskBoundContextPackDir(
    paths.repoRoot,
    pipelineTaskId,
  );
  const effectiveContextPackDir = taskBoundContextPackDir ?? undefined;

  // Resolve the frozen slice format from the task sidecar once for all downstream callers.
  const frozenSliceFormat: SliceArtifactFormat =
    readTaskJsonSafe(pipelineTaskId, paths.repoRoot)?.sliceArtifactFormat ?? 'markdown';

  try {
    ensurePipelineNotKilled(paths.repoRoot, pipelineTaskId, abortController);
    workflowPath = await detectWorkflowPath(paths.handoffs);
    const agentOrder = selectAgentOrder(options);
    await emitTaskProgressEvent({
      logger: log.child({ taskId: pipelineTaskId }),
      repoRoot: paths.repoRoot,
      taskId: pipelineTaskId,
      event: { type: 'pipeline.agent_order.selected' },
    });

    const prewarmStart = Date.now();
    await prewarmPipelineContext(
      agentOrder,
      effectiveContextPackDir,
      paths.repoRoot,
    );
    prewarmSeconds = Math.round((Date.now() - prewarmStart) / 1000);
    const externalMcpRegistry = getCachedExternalMcpRegistry(paths.repoRoot);
    const externalMcpRegistryHealth = getCachedExternalMcpRegistryHealth(paths.repoRoot);
    pipelineLog.info('external_mcp_registry.status', { health: externalMcpRegistryHealth });

    const maxRemediationCycles = 3;

    let isFirstAgent = true;
    let skipNextEntryValidation = false;
    let testCaptureResults: TestCaptureResult[] = [];
    let testCaptureWarning: string | undefined;
    const selectedPrimary = effectiveContextPackDir
      ? await resolveSelectedPrimaryRepoRoot(effectiveContextPackDir, paths.repoRoot, { taskId: options.taskId })
      : undefined;
    const focusScope = toFocusScopePromptOptions(selectedPrimary);
    const testCaptureCwd = effectiveContextPackDir
      ? await resolveTestCaptureCwd({
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        contextPackDir: effectiveContextPackDir,
      })
      : paths.repoRoot;

    // Shared post-Dalton logic: optional verification pass then test capture.
    let daltonRemediationActive = false;
    const runPostDaltonPasses = async (): Promise<TestCaptureResult[]> => {
      if (!daltonRemediationActive) {
        const sharedVerificationDiffPath = path.join(paths.handoffs, 'code-changes.diff');
        const verificationDiffStage = resolveVerificationDiffStage(paths.taskRuntime);
        const diffGenerationWarning = await refreshVerificationQaDiffArtifact({
          repoRoot: paths.repoRoot,
          taskId: pipelineTaskId,
          handoffsDir: paths.handoffs,
          contextPackDir: effectiveContextPackDir,
          abortSignal: abortController.signal,
          reason: 'pre-verification',
        });
        const stagedVerificationDiff: { staged: boolean; warning?: string } = diffGenerationWarning
          ? { staged: false }
          : await stageVerificationDiffArtifact({
              sharedDiffPath: sharedVerificationDiffPath,
              verificationDiffStage,
            });
        if (diffGenerationWarning) {
          await cleanupVerificationDiffStage(verificationDiffStage, 'stale-cleanup');
        }

        let verificationRan = false;
        try {
          const verificationPrompt = await resolveVerificationDaltonPrompt(
            paths.handoffs,
            paths.implementationSteps,
            focusScope,
            externalMcpRegistry,
            stagedVerificationDiff.staged ? verificationDiffStage.verificationDiffAbsolutePath : undefined,
            joinVerificationWarnings(diffGenerationWarning, stagedVerificationDiff.warning),
            frozenSliceFormat,
          );
          if (verificationPrompt) {
            await emitTaskProgressEvent({
              logger: log.child({ taskId: pipelineTaskId }),
              repoRoot: paths.repoRoot,
              taskId: pipelineTaskId,
              event: { type: 'dalton_verification.launching' },
            });
            const verifyStart = Date.now();
            const verificationResult = await runRoleAgent({
              agentId: 'dalton-verify',
              repoRoot: paths.repoRoot,
              taskId: pipelineTaskId ?? '',
              spanId: newSpanId(),
              skipWorkflowValidation: true,
              contextPackDir: effectiveContextPackDir,
              verificationTempAllowedDir: stagedVerificationDiff.staged
                ? verificationDiffStage.verificationDiffDir
                : undefined,
              abortSignal: abortController.signal,
              promptOverride: verificationPrompt,
              launchPhase: 'Verification',
            });
            verificationRan = true;
            agentMcpStatuses['dalton-verify'] = verificationResult.mcpLaunch ?? MISSING_MCP_LAUNCH_STATUS;
            agentTimings['dalton-verify'] = Math.round((Date.now() - verifyStart) / 1000);
          }
        } finally {
          await cleanupVerificationDiffStage(
            verificationDiffStage,
            'post-verification-cleanup',
          );
        }

        if (verificationRan) {
          await refreshVerificationQaDiffArtifact({
            repoRoot: paths.repoRoot,
            taskId: pipelineTaskId,
            handoffsDir: paths.handoffs,
            contextPackDir: effectiveContextPackDir,
            abortSignal: abortController.signal,
            reason: 'post-verification',
          });
        }
      }
      const capture = await runTestCaptureWithPhaseTracking({
        repoRoot: paths.repoRoot,
        taskRuntime: paths.taskRuntime,
        implementationStepsDir: paths.implementationSteps,
        captureCwd: testCaptureCwd,
        abortSignal: abortController.signal,
        pipelineTaskId,
        sliceFormat: frozenSliceFormat,
      });
      if (capture.skipped) {
        log.warn('test_capture.skipped', { reason: 'target-repo-resolution-failed' });
        testCaptureWarning = 'Orchestrator could not resolve the target repo for test capture. Run the validation commands from the slices yourself.';
      }
      return capture.results;
    };

    for (let index = 0; index < agentOrder.length; index++) {
      ensurePipelineNotKilled(paths.repoRoot, pipelineTaskId, abortController);
      const agentId = agentOrder[index];
      const agentStart = Date.now();

      if (agentId === 'dalton') {
        daltonRemediationActive = false;
        await removeSliceTemplateIfPresent(paths.implementationSteps);
        daltonRemediationActive = await remediationHasBlockingFindings(paths.handoffs);
        const isComplex = daltonRemediationActive
          ? false
          : await detectParallelOk(paths.handoffs);
        await emitTaskProgressEvent({
          logger: log.child({ taskId: pipelineTaskId }),
          repoRoot: paths.repoRoot,
          taskId: pipelineTaskId,
          event: {
            type: 'pipeline.dalton_mode.selected',
            input: {
              mode: isComplex ? 'complex' : 'simple',
              reason: daltonRemediationActive
                ? 'remediation-forced-simple'
                : isComplex ? 'parallel-ok-complex' : 'parallel-ok-simple',
            },
          },
        });

        if (isComplex) {
          const fleetPrompt = await buildFleetPrompt(
            paths.implementationSteps,
            paths.handoffs,
            focusScope,
            externalMcpRegistry,
            {
              repoRoot: paths.repoRoot,
              contextPackDir: effectiveContextPackDir,
            },
            frozenSliceFormat,
          );
          const daltonResult = await runRoleAgent({
            agentId: 'dalton',
            repoRoot: paths.repoRoot,
            taskId: pipelineTaskId ?? '',
            spanId: newSpanId(),
            skipWorkflowValidation: false,
            contextPackDir: effectiveContextPackDir,
            abortSignal: abortController.signal,
            promptOverride: fleetPrompt,
          });
          agentMcpStatuses['dalton'] = daltonResult.mcpLaunch ?? MISSING_MCP_LAUNCH_STATUS;
          agentTimings['dalton'] = Math.round((Date.now() - agentStart) / 1000);

          const qaPolicy = await runRuntimePolicyCheck(paths.repoRoot, 'ron', 'runtime', pipelineTaskId);
          if (qaPolicy.exitCode !== 0) {
            const cleanupContext = await buildFleetDaltonCleanupContext({
              repoRoot: paths.repoRoot,
              handoffsDir: paths.handoffs,
              implStepsDir: paths.implementationSteps,
              policyResult: qaPolicy,
            });
            const cleanupPrompt = buildFleetDaltonCleanupPrompt(
              cleanupContext,
              focusScope,
              externalMcpRegistry,
            );
            const cleanupResult = await runRoleAgent({
              agentId: 'dalton',
              repoRoot: paths.repoRoot,
              taskId: pipelineTaskId ?? '',
              spanId: newSpanId(),
              skipWorkflowValidation: true,
              contextPackDir: effectiveContextPackDir,
              abortSignal: abortController.signal,
              promptOverride: cleanupPrompt,
              launchPhase: 'Artifact Cleanup',
            });
            agentMcpStatuses['dalton'] = cleanupResult.mcpLaunch ?? MISSING_MCP_LAUNCH_STATUS;
          }

          testCaptureResults = await runPostDaltonPasses();
          skipNextEntryValidation = true;
          isFirstAgent = false;
          if (options.stopAfter === 'dalton') break;
          continue;
        }
      }

      const skipWorkflowValidation = isFirstAgent || skipNextEntryValidation;

      let agentPromptOverride: string | undefined;
      if (agentId === 'dalton') {
        agentPromptOverride = await buildSimpleDaltonPrompt(
          paths.implementationSteps,
          paths.handoffs,
          focusScope,
          externalMcpRegistry,
          {
            repoRoot: paths.repoRoot,
            contextPackDir: effectiveContextPackDir,
          },
          frozenSliceFormat,
        );
      } else if (agentId === 'ron') {
        agentPromptOverride = buildTestCapturePrompt(
          testCaptureResults,
          focusScope,
          externalMcpRegistry,
          testCaptureWarning,
          frozenSliceFormat,
        );
      }

      const agentResult = await runRoleAgent({
        agentId,
        repoRoot: paths.repoRoot,
        taskId: pipelineTaskId ?? '',
        spanId: newSpanId(),
        skipWorkflowValidation,
        contextPackDir: effectiveContextPackDir,
        abortSignal: abortController.signal,
        promptOverride: agentPromptOverride,
      });
      agentMcpStatuses[agentId] = agentResult.mcpLaunch ?? MISSING_MCP_LAUNCH_STATUS;
      skipNextEntryValidation = agentId === 'alice' || agentId === 'dalton';
      isFirstAgent = false;

      const agentEnd = Date.now();
      agentTimings[agentId] = Math.round((agentEnd - agentStart) / 1000);

      if (agentId === 'dalton') {
        testCaptureResults = await runPostDaltonPasses();
      }

      if (agentId === 'ron') {
        const hasFindings = await remediationHasBlockingFindings(paths.handoffs);
        if (hasFindings) {
          await remediationClearCloseoutArtifacts(paths.handoffs, paths.templates);
          await remediationRunQaLoop({
            maxCycles: maxRemediationCycles,
            taskId: pipelineTaskId,
            repoRoot: paths.repoRoot,
            contextPackDir: effectiveContextPackDir,
            focusScope,
            externalMcpRegistry,
            abortSignal: abortController.signal,
          });
        }

        await runRetrospectivePhaseIfNeeded({
          handoffsDir: paths.handoffs,
          repoRoot: paths.repoRoot,
          contextPackDir: effectiveContextPackDir,
          currentTaskId: pipelineTaskId,
          externalMcpRegistry,
          abortSignal: abortController.signal,
          agentMcpStatuses,
          agentTimings,
        });
      }

      if (options.stopAfter && agentId === options.stopAfter) {
        break;
      }
    }

    const totalSeconds = Math.round((Date.now() - pipelineStart) / 1000);

    const receipt: PipelineReceipt = {
      status: 'completed',
      workflowPath,
      totalSeconds,
      prewarmSeconds,
      agentTimings,
      externalMcp: {
        registry: externalMcpRegistryHealth,
        agents: agentMcpStatuses,
      },
    };

    // NOTE: receipt is intentionally NOT written here. We defer the write
    // until after completePendingItem returns so the on-disk status reflects
    // whether closeout actually finished.

    // Pre-check queue-advance readiness. If policy fails (e.g. incomplete
    // retrospective), give Ron one remediation pass before attempting closeout.
    const preCloseoutCheck = await runPolicyValidation({ mode: 'queue-advance', taskId: pipelineTaskId, repoRoot: paths.repoRoot });
    if (!preCloseoutCheck.passed) {
      const policyDetails = [preCloseoutCheck.stdout, preCloseoutCheck.stderr]
        .filter(Boolean).join('\n').trim();
      const reason = 'queue-advance-policy-blocked';
      await emitTaskProgressEvent({
        logger: log.child({ taskId: pipelineTaskId }),
        repoRoot: paths.repoRoot,
        taskId: pipelineTaskId,
        event: { type: 'closeout_remediation.launching', input: { reason } },
      });
      try {
        await runRoleAgent({
          agentId: 'ron',
          repoRoot: paths.repoRoot,
          taskId: pipelineTaskId ?? '',
          spanId: newSpanId(),
          skipWorkflowValidation: true,
          contextPackDir: effectiveContextPackDir,
          abortSignal: abortController.signal,
          promptOverride: [
            'Your previous QA run completed but task closeout is blocked by policy validation.',
            '',
            'Fix ONLY the missing handoff artifacts required for closeout.',
            'Do not repeat QA review work — just fill in the gaps identified below.',
            '',
            '## Policy Failure Details',
            '',
            policyDetails,
          ].join('\n'),
          launchPhase: 'Closeout Remediation',
        });
      } catch (remediationErr) {
        log.warn('closeout_remediation.failed', { error: getErrorMessage(remediationErr) });
      }
    }

    try {
      await emitTaskProgressEvent({
        logger: log.child({ taskId: pipelineTaskId }),
        repoRoot: paths.repoRoot,
        taskId: pipelineTaskId,
        event: { type: 'closeout.started' },
      });
      await completePendingItem({ taskId: pipelineTaskId, repoRoot: paths.repoRoot, contextPackDir: effectiveContextPackDir });
    } catch (err) {
      const closeoutError = err instanceof Error ? err.message : String(err);
      log.error('post_pipeline_closeout.failed', err, { error: closeoutError });
      const closeoutFailedReceipt: PipelineReceipt = {
        ...receipt,
        status: 'closeout-failed',
        closeoutError,
      };
      await writePipelineReceipt(paths.taskRuntime, closeoutFailedReceipt);
      const tagged = err instanceof Error ? err : new Error(closeoutError);
      (tagged as { _isCloseoutFailure?: boolean })._isCloseoutFailure = true;
      throw tagged;
    }

    await writePipelineReceipt(paths.taskRuntime, receipt);
    return receipt;
  } catch (err) {
    const killRequest = await readPipelineKillRequest(paths.repoRoot, pipelineTaskId);
    const killed = abortController.signal.aborted || killRequest !== undefined;

    const isCloseoutFailure = !killed && (err as { _isCloseoutFailure?: boolean })?._isCloseoutFailure === true;
    if (isCloseoutFailure) {
      throw err;
    }

    const failureReason = killed
      ? `Pipeline killed: ${killRequest?.reason ?? 'operator-request'}`
      : getErrorMessage(err);
    const failureStatus: PipelineReceipt['status'] = killed ? 'killed' : 'failed';
    const failureReceipt: PipelineReceipt = {
      status: failureStatus,
      workflowPath,
      totalSeconds: Math.round((Date.now() - pipelineStart) / 1000),
      prewarmSeconds,
      agentTimings,
      failureReason,
      externalMcp: {
        registry: getCachedExternalMcpRegistryHealth(paths.repoRoot),
        agents: agentMcpStatuses,
      },
    };

    await emitTaskProgressEvent({
      logger: log.child({ taskId: pipelineTaskId }),
      repoRoot: paths.repoRoot,
      taskId: pipelineTaskId,
      event: killed ? { type: 'pipeline.killed', input: { reason: 'killed' } } : { type: 'pipeline.failed', input: { reason: 'failed' } },
    });
    await writePipelineReceipt(paths.taskRuntime, failureReceipt);
    await handlePipelineFailure(paths.repoRoot, effectiveContextPackDir, options.taskId);

    if (killed) {
      throw new Error(failureReason);
    }
    throw err;
  } finally {
    stopKillMonitor();
    await clearPipelineKill(paths.repoRoot, pipelineTaskId);
    await lock.release();
  }
}

function toFocusScopePromptOptions(selectedPrimary?: {
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: 'directory' | 'file';
  primaryFocusTargets?: FocusScopePromptOptions['primaryFocusTargets'];
  testTarget?: { path: string; kind: 'directory' | 'file' };
  supportTargets?: FocusScopePromptOptions['supportTargets'];
  writableRoots?: FocusScopePromptOptions['writableRoots'];
  readonlyContextRoots?: FocusScopePromptOptions['readonlyContextRoots'];
  estateType?: string;
}): FocusScopePromptOptions | undefined {
  if (!selectedPrimary) {
    return undefined;
  }

  return {
    primaryFocusRelativePath: selectedPrimary.primaryFocusRelativePath,
    primaryFocusTargetKind: selectedPrimary.primaryFocusTargetKind,
    primaryFocusTargets: selectedPrimary.primaryFocusTargets,
    testTarget: selectedPrimary.testTarget
      ? {
          path: selectedPrimary.testTarget.path,
          kind: selectedPrimary.testTarget.kind,
        }
      : undefined,
    supportTargets: selectedPrimary.supportTargets,
    writableRoots: selectedPrimary.writableRoots,
    readonlyContextRoots: selectedPrimary.readonlyContextRoots,
    estateType: selectedPrimary.estateType,
  };
}
