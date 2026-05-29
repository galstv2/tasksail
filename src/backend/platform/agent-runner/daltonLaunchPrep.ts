import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import type { RunRoleAgentOptions, AutonomyIntent } from './types.js';
import type { RunSummary } from './processLifecycle.js';
import type { AgentLifecycleProgressInput } from '../core/taskProgressEvents.js';
import { readTextFile } from '../core/io.js';
import { createLogger, emitTaskProgressEvent, getErrorMessage } from '../core/index.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';
import {
  captureChangedPathsSnapshot,
  validateDaltonBoundaryChanges,
  DaltonConfinementError,
  type ChangedPathsSnapshot,
} from './confinement.js';
import { agentErrorWithTails } from './recoveryPasses.js';
import { getActiveProvider } from '../cli-provider/index.js';

const log = createLogger('platform/agent-runner/daltonLaunchPrep');

export interface DaltonBoundaryMonitorRoots {
  readonly roots: string[];
  readonly source: 'task-sidecar-worktrees' | 'legacy-focused-roots';
}

export function resolveDaltonLaunchCwd(
  focused: FocusedRepoResult,
  agentId: RunRoleAgentOptions['agentId'],
): string {
  if (!focused.primaryFocusRelativePath) {
    return focused.primaryRepoRoot;
  }

  if (focused.primaryFocusTargetKind === 'file') {
    const focusParentRelativePath = path.dirname(focused.primaryFocusRelativePath);
    const focusCwd = path.join(focused.primaryRepoRoot, focusParentRelativePath);
    if (!existsSync(focusCwd)) {
      throw new Error(
        `Cannot launch ${daltonLaunchAgentLabel(agentId)}: parent directory for selected focus file "${focused.primaryFocusRelativePath}" ` +
        `does not exist at "${focusCwd}".`,
      );
    }
    return focusCwd;
  }

  const focusCwd = path.join(focused.primaryRepoRoot, focused.primaryFocusRelativePath);
  if (!existsSync(focusCwd)) {
    throw new Error(
      `Cannot launch ${daltonLaunchAgentLabel(agentId)}: selected monolith focus subfolder "${focused.primaryFocusRelativePath}" ` +
      `does not exist at "${focusCwd}".`,
    );
  }

  return focusCwd;
}

export function resolveDaltonBoundaryMonitorRoots(options: {
  taskId?: string;
  repoRoot: string;
  focused: FocusedRepoResult;
}): DaltonBoundaryMonitorRoots {
  const taskId = options.taskId?.trim();
  if (!taskId) {
    return {
      roots: [options.repoRoot, ...options.focused.declaredRepoRoots],
      source: 'legacy-focused-roots',
    };
  }

  const taskJson = readTaskJsonSafe(taskId, options.repoRoot);
  if (!taskJson) {
    throw new Error(
      `Cannot prepare Dalton confinement for taskId=${taskId}: task sidecar is missing or unreadable.`,
    );
  }

  const repoBindings = taskJson.contextPackBinding.repoBindings ?? [];
  const readonlyBindings = taskJson.contextPackBinding.readonlyContextBindings ?? [];
  if (repoBindings.length === 0 && readonlyBindings.length === 0) {
    throw new Error(
      `Cannot prepare Dalton confinement for taskId=${taskId}: no task worktree roots found in task sidecar.`,
    );
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const binding of [...repoBindings, ...readonlyBindings]) {
    const root = binding.worktreeRoot;
    if (!root.trim() || seen.has(root)) {
      continue;
    }
    seen.add(root);
    roots.push(root);
  }

  if (roots.length === 0) {
    throw new Error(
      `Cannot prepare Dalton confinement for taskId=${taskId}: no task worktree roots found in task sidecar.`,
    );
  }

  return {
    roots,
    source: 'task-sidecar-worktrees',
  };
}

export async function prepareDaltonBoundary(
  focused: FocusedRepoResult,
  options: {
    agentId: RunRoleAgentOptions['agentId'];
    repoRoot: string;
    taskId?: string;
    usesFocusedRepoLaunch: boolean;
    verificationTempAllowedDir?: string;
  },
  autonomyArgs: AutonomyIntent,
): Promise<{ agentCwd: string; preRunBoundarySnapshot: ChangedPathsSnapshot }> {
  for (const root of focused.visibleRepoRoots) {
    if (!autonomyArgs.allowedDirs.includes(root)) {
      autonomyArgs.allowedDirs.push(root);
    }
  }

  let agentCwd = options.repoRoot;
  if (options.usesFocusedRepoLaunch) {
    agentCwd = resolveDaltonLaunchCwd(focused, options.agentId);
    if (
      options.verificationTempAllowedDir &&
      !autonomyArgs.allowedDirs.includes(options.verificationTempAllowedDir)
    ) {
      autonomyArgs.allowedDirs.push(options.verificationTempAllowedDir);
    }
  }

  const monitorRoots = resolveDaltonBoundaryMonitorRoots({
    taskId: options.taskId,
    repoRoot: options.repoRoot,
    focused,
  });
  const preRunBoundarySnapshot = await captureChangedPathsSnapshot(monitorRoots.roots);

  return { agentCwd, preRunBoundarySnapshot };
}

export async function validateDaltonPostRunBoundary(options: {
  platformRepoRoot: string;
  focused: FocusedRepoResult;
  preRunBoundarySnapshot: ChangedPathsSnapshot;
  agentSpawnedAtMs?: number;
}): Promise<void> {
  const postRunBoundarySnapshot = await captureChangedPathsSnapshot(
    Object.keys(options.preRunBoundarySnapshot.byRepoRoot),
  );
  await validateDaltonBoundaryChanges({
    platformRepoRoot: options.platformRepoRoot,
    focused: options.focused,
    before: options.preRunBoundarySnapshot,
    after: postRunBoundarySnapshot,
    agentSpawnedAtMs: options.agentSpawnedAtMs,
  });
}

export function buildArtifactCleanupPrompt(options: {
  artifactPrompt: string;
  policyFailureDetails?: string;
  forbiddenPathTokens: readonly string[];
}): string {
  const sections = [
    'Your previous run did not leave the workflow ready for the next role.',
  ];
  if (options.policyFailureDetails?.trim()) {
    sections.push('', `Blocking workflow-policy details: ${options.policyFailureDetails.trim()}`);
  }
  sections.push(
    '',
    'Use only the exact absolute artifact paths listed below.',
    'Do not write literal provider placeholder paths. Forbidden path tokens:',
    ...options.forbiddenPathTokens.map((token) => `- ${token}`),
    'Do not use shell commands to create workflow artifact directories; the platform creates those directories before this cleanup pass.',
    'If a write fails, report the exact listed path and the failure. Do not guess alternate workspace paths.',
    '',
    options.artifactPrompt.trim(),
  );
  return sections.join('\n');
}

export function isDaltonFamilyAgent(agentId: RunRoleAgentOptions['agentId']): boolean {
  return agentId === 'dalton' || agentId === 'dalton-verify';
}

export function daltonFamilyRuntimeLabel(agentId: RunRoleAgentOptions['agentId']): string {
  return agentId === 'dalton'
    ? 'Dalton'
    : `Dalton-family agent "${agentId}"`;
}

function daltonLaunchAgentLabel(agentId: RunRoleAgentOptions['agentId']): string {
  return agentId === 'dalton'
    ? 'agent "dalton"'
    : `Dalton-family agent "${agentId}"`;
}

function confinementRetryPromptPath(repoRoot: string, agentId: RunRoleAgentOptions['agentId']): string {
  if (!isDaltonFamilyAgent(agentId)) {
    throw new Error(`Confinement retry prompt is only defined for Dalton-family agents. Got: ${agentId}`);
  }
  return path.join(repoRoot, getActiveProvider(repoRoot).resolvePromptPath('execute-task-retry'));
}

async function resolveConfinementRetryPrompt(
  repoRoot: string,
  agentId: RunRoleAgentOptions['agentId'],
): Promise<{ prompt: string; promptPath: string; promptSource: 'file' }> {
  const promptPath = confinementRetryPromptPath(repoRoot, agentId);
  const prompt = (await readTextFile(promptPath))?.trim();
  if (!prompt) {
    throw new Error(`Launch prompt is missing or empty: ${promptPath}`);
  }
  return {
    prompt,
    promptPath,
    promptSource: 'file',
  };
}

export function buildDaltonConfinementRetryPrompt(options: {
  basePrompt: string;
  originalAssignmentPrompt: string;
  violation: DaltonConfinementError;
  focused: FocusedRepoResult;
}): string {
  const originalAssignmentPrompt = options.originalAssignmentPrompt.trim();
  if (!originalAssignmentPrompt) {
    throw new Error(
      'Cannot launch Dalton confinement retry: original assignment prompt is empty. ' +
      'Retry requires the original implementation context because each Dalton launch is independent.',
    );
  }

  const sections = [options.basePrompt.trim()];
  if (options.violation.violationPaths.length > 0) {
    sections.push(
      '',
      'Out-of-bound changed paths detected:',
      ...options.violation.violationPaths.map((violationPath) => `- ${violationPath}`),
    );
  }
  sections.push(
    '',
    'Your previous run violated the enforced implementation boundary.',
    'First remove or repair every out-of-bound change. Keep all remaining code edits inside the writable roots listed below.',
    '',
    'You are a fresh independent Dalton process. You do not have memory of the prior launch. The prior process may have completed some implementation work before the boundary violation was detected.',
    '',
    'Compare the current codebase state to the original assignment context below. Continue from the current repo state. Do not restart blindly, do not duplicate already-correct work, and do not undo valid in-bound changes unless they are wrong. Finish the original acceptance criteria and validation commands.',
    '',
    `Writable roots: ${JSON.stringify(options.focused.writableRoots ?? [])}`,
    `Read-only context roots: ${JSON.stringify(options.focused.readonlyContextRoots ?? [])}`,
    '',
    '## Original Assignment Context',
    '',
    originalAssignmentPrompt,
  );
  return sections.join('\n');
}

function confinementReceiptBoundaryContext(focused: FocusedRepoResult): {
  writable_roots: FocusedRepoResult['writableRoots'];
  readonly_context_roots: FocusedRepoResult['readonlyContextRoots'];
} {
  return {
    writable_roots: focused.writableRoots ?? [],
    readonly_context_roots: focused.readonlyContextRoots ?? [],
  };
}

// ---------------------------------------------------------------------------
// Post-run confinement validation + retry orchestration
// ---------------------------------------------------------------------------

export interface ConfinementValidationDeps {
  repoRoot: string;
  taskId?: string;
  agentId: RunRoleAgentOptions['agentId'];
  activeModel: string;
  focused: FocusedRepoResult;
  preRunBoundarySnapshot: ChangedPathsSnapshot;
  agentSpawnedAtMs?: number;
  runSummary: RunSummary;
  originalAssignmentPrompt: string;
  writeLaunchGuardrailReceipt: (data: Record<string, unknown>) => Promise<void>;
  resetArtifactCompletionCache: () => void;
  /** Build the retry agent CLI args from a prompt string. */
  buildRetryArgs: (prompt: string) => {
    cliArgs: string[];
    promptAudit: {
      promptPath: string | null;
      promptSource: 'file' | 'override';
      inlineAgentContext: boolean;
      effectivePromptSha256: string;
    };
  };
  /** Run an agent session and return its summary. */
  runAgentSessionForRetry: (args: string[], promptAudit: Record<string, unknown>) => Promise<{
    runSummary: RunSummary;
    greedyStopTriggered: boolean;
    sessionReceiptFile: string | null;
  }>;
  runAgentSessionForConfinementRetry?: (args: string[], promptAudit: Record<string, unknown>, metadata: {
    launchPhase: 'Confinement retry';
    retryOfLaunchId: string;
    launchId?: string;
  }) => Promise<{
    runSummary: RunSummary;
    greedyStopTriggered: boolean;
    sessionReceiptFile: string | null;
  }>;
  initialLaunchId?: string;
  createConfinementRetryLaunchId?: () => string;
  /** Update the lastPromptAudit tracking variable. */
  setLastPromptAudit: (audit: {
    promptPath: string | null;
    promptSource: 'file' | 'override';
    inlineAgentContext: boolean;
    effectivePromptSha256: string;
  }) => void;
}

/**
 * Validate Dalton's post-run confinement boundary, retry once on violation.
 * Returns the updated runSummary/exitCode if a retry was executed.
 * Throws on unrecoverable confinement violation or retry failure.
 */
export async function handleDaltonConfinementValidation(
  deps: ConfinementValidationDeps,
): Promise<{ runSummary: RunSummary; exitCode: number } | undefined> {
  const emitConfinementRetryEvent = async (type: 'agent.confinement_retry.started' | 'agent.confinement_retry.completed' | 'agent.confinement_retry.failed', input: AgentLifecycleProgressInput): Promise<void> => {
    if (!deps.taskId) return;
    if (type === 'agent.confinement_retry.started') {
      await emitTaskProgressEvent({ logger: log.child({ taskId: deps.taskId }), repoRoot: deps.repoRoot, taskId: deps.taskId, event: { type: 'agent.confinement_retry.started', input } });
    } else if (type === 'agent.confinement_retry.completed') {
      await emitTaskProgressEvent({ logger: log.child({ taskId: deps.taskId }), repoRoot: deps.repoRoot, taskId: deps.taskId, event: { type: 'agent.confinement_retry.completed', input } });
    } else {
      await emitTaskProgressEvent({ logger: log.child({ taskId: deps.taskId }), repoRoot: deps.repoRoot, taskId: deps.taskId, event: { type: 'agent.confinement_retry.failed', input } });
    }
  };
  try {
    await validateDaltonPostRunBoundary({
      platformRepoRoot: deps.repoRoot,
      focused: deps.focused,
      preRunBoundarySnapshot: deps.preRunBoundarySnapshot,
      agentSpawnedAtMs: deps.agentSpawnedAtMs,
    });
    return undefined;
  } catch (error: unknown) {
    if (!(error instanceof DaltonConfinementError)) {
      await deps.writeLaunchGuardrailReceipt({
        schema_version: 1,
        status: 'failed',
        agent_id: deps.agentId,
        model: deps.activeModel,
        exit_code: 0,
        termination_reason: 'confinement-violation',
        signal_code: deps.runSummary.signalCode,
        stdout_tail: deps.runSummary.stdoutTail,
        stderr_tail: getErrorMessage(error),
        violation_paths: [],
        ...confinementReceiptBoundaryContext(deps.focused),
      });
      throw error;
    }

    const retryPrompt = await resolveConfinementRetryPrompt(deps.repoRoot, deps.agentId);
    const retryBuilt = deps.buildRetryArgs(buildDaltonConfinementRetryPrompt({
      basePrompt: retryPrompt.prompt,
      originalAssignmentPrompt: deps.originalAssignmentPrompt,
      violation: error,
      focused: deps.focused,
    }));
    deps.setLastPromptAudit(retryBuilt.promptAudit);
    log.warn('dalton.confinement_retry.launching', {
      agentId: deps.agentId,
      violationPathCount: error.violationPaths.length,
    });
    const retryLaunchId = deps.createConfinementRetryLaunchId?.();
    const retryProgressInput = {
      agentId: deps.agentId,
      launchId: retryLaunchId ?? deps.initialLaunchId ?? 'unknown',
      displayPhase: 'confinement-retry' as const,
    };
    await emitConfinementRetryEvent('agent.confinement_retry.started', retryProgressInput);
    const retrySession = deps.runAgentSessionForConfinementRetry && deps.initialLaunchId
      ? await deps.runAgentSessionForConfinementRetry(
          retryBuilt.cliArgs,
          retryBuilt.promptAudit,
          {
            launchPhase: 'Confinement retry',
            retryOfLaunchId: deps.initialLaunchId,
            ...(retryLaunchId ? { launchId: retryLaunchId } : {}),
          },
        )
      : await deps.runAgentSessionForRetry(
          retryBuilt.cliArgs,
          retryBuilt.promptAudit,
        );
    const retryRunSummary = retrySession.runSummary;
    deps.resetArtifactCompletionCache();
    if (retryRunSummary.exitCode !== 0) {
      await emitConfinementRetryEvent('agent.confinement_retry.failed', retryProgressInput);
      await deps.writeLaunchGuardrailReceipt({
        schema_version: 1,
        status: 'failed',
        agent_id: deps.agentId,
        model: deps.activeModel,
        exit_code: retryRunSummary.exitCode,
        termination_reason: retryRunSummary.terminationReason,
        signal_code: retryRunSummary.signalCode,
        stdout_tail: retryRunSummary.stdoutTail,
        stderr_tail: retryRunSummary.stderrTail,
        violation_paths: error.violationPaths,
        ...confinementReceiptBoundaryContext(deps.focused),
      });
      throw agentErrorWithTails(
        `Agent "${deps.agentId}" confinement retry exited with code ${retryRunSummary.exitCode} (${retryRunSummary.terminationReason}).`,
        retryRunSummary,
      );
    }

    try {
      await validateDaltonPostRunBoundary({
        platformRepoRoot: deps.repoRoot,
        focused: deps.focused,
        preRunBoundarySnapshot: deps.preRunBoundarySnapshot,
        agentSpawnedAtMs: deps.agentSpawnedAtMs,
      });
    } catch (retryError: unknown) {
      await emitConfinementRetryEvent('agent.confinement_retry.failed', retryProgressInput);
      const violationPaths = retryError instanceof DaltonConfinementError
        ? retryError.violationPaths
        : [];
      await deps.writeLaunchGuardrailReceipt({
        schema_version: 1,
        status: 'failed',
        agent_id: deps.agentId,
        model: deps.activeModel,
        exit_code: 0,
        termination_reason: 'confinement-violation',
        signal_code: retryRunSummary.signalCode,
        stdout_tail: retryRunSummary.stdoutTail,
        stderr_tail: getErrorMessage(retryError),
        violation_paths: violationPaths,
        ...confinementReceiptBoundaryContext(deps.focused),
      });
      throw retryError;
    }

    await emitConfinementRetryEvent('agent.confinement_retry.completed', retryProgressInput);
    return { runSummary: retryRunSummary, exitCode: retryRunSummary.exitCode };
  }
}
