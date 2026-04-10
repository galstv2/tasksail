import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import type { CopilotArgs, RunRoleAgentOptions } from './types.js';
import type { CopilotRunSummary } from './processLifecycle.js';
import { readTextFile } from '../core/io.js';
import { getErrorMessage } from '../core/index.js';
import {
  captureChangedPathsSnapshot,
  validateDaltonBoundaryChanges,
  DaltonConfinementError,
  type ChangedPathsSnapshot,
} from './confinement.js';
import { agentErrorWithTails } from './recoveryPasses.js';

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

export async function prepareDaltonBoundary(
  focused: FocusedRepoResult,
  options: {
    agentId: RunRoleAgentOptions['agentId'];
    repoRoot: string;
    usesFocusedRepoLaunch: boolean;
    verificationTempAllowedDir?: string;
  },
  autonomyArgs: CopilotArgs,
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

  const preRunBoundarySnapshot = await captureChangedPathsSnapshot([
    options.repoRoot,
    ...focused.declaredRepoRoots,
  ]);

  return { agentCwd, preRunBoundarySnapshot };
}

export async function validateDaltonPostRunBoundary(options: {
  platformRepoRoot: string;
  focused: FocusedRepoResult;
  preRunBoundarySnapshot: ChangedPathsSnapshot;
}): Promise<void> {
  const postRunBoundarySnapshot = await captureChangedPathsSnapshot([
    options.platformRepoRoot,
    ...options.focused.declaredRepoRoots,
  ]);
  validateDaltonBoundaryChanges({
    platformRepoRoot: options.platformRepoRoot,
    focused: options.focused,
    before: options.preRunBoundarySnapshot,
    after: postRunBoundarySnapshot,
  });
}

export function buildArtifactCleanupPrompt(options: {
  artifactPrompt: string;
  policyFailureDetails?: string;
}): string {
  const sections = [
    'Your previous run did not leave the workflow ready for the next role.',
  ];
  if (options.policyFailureDetails?.trim()) {
    sections.push('', `Blocking workflow-policy details: ${options.policyFailureDetails.trim()}`);
  }
  sections.push('', options.artifactPrompt.trim());
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

function confinementRetryPromptPath(
  repoRoot: string,
  agentId: RunRoleAgentOptions['agentId'],
): string {
  if (!isDaltonFamilyAgent(agentId)) {
    throw new Error(`Confinement retry prompt is only defined for Dalton-family agents. Got: ${agentId}`);
  }
  return path.join(repoRoot, '.github', 'copilot', 'prompts', 'execute-task-retry.prompt.md');
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

function buildDaltonConfinementRetryPrompt(options: {
  basePrompt: string;
  violation: DaltonConfinementError;
}): string {
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
    'Remove or repair every out-of-bound change, keep all remaining code edits inside the selected primary repo or primary monolith focus path, then finish the originally assigned slice.',
  );
  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Post-run confinement validation + retry orchestration
// ---------------------------------------------------------------------------

export interface ConfinementValidationDeps {
  repoRoot: string;
  agentId: RunRoleAgentOptions['agentId'];
  activeModel: string;
  focused: FocusedRepoResult;
  preRunBoundarySnapshot: ChangedPathsSnapshot;
  runSummary: CopilotRunSummary;
  writeLaunchGuardrailReceipt: (data: Record<string, unknown>) => Promise<void>;
  resetArtifactCompletionCache: () => void;
  /** Build the retry copilot args from a prompt string. */
  buildRetryArgs: (prompt: string) => {
    copilotArgs: string[];
    promptAudit: {
      promptPath: string | null;
      promptSource: 'file' | 'override';
      inlineAgentContext: boolean;
      effectivePromptSha256: string;
    };
  };
  /** Run a copilot session and return its summary. */
  runCopilotSessionForRetry: (args: string[], promptAudit: Record<string, unknown>) => Promise<{
    runSummary: CopilotRunSummary;
    greedyStopTriggered: boolean;
    sessionReceiptFile: string | null;
  }>;
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
): Promise<{ runSummary: CopilotRunSummary; exitCode: number } | undefined> {
  try {
    await validateDaltonPostRunBoundary({
      platformRepoRoot: deps.repoRoot,
      focused: deps.focused,
      preRunBoundarySnapshot: deps.preRunBoundarySnapshot,
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
      });
      throw error;
    }

    const retryPrompt = await resolveConfinementRetryPrompt(deps.repoRoot, deps.agentId);
    const retryBuilt = deps.buildRetryArgs(buildDaltonConfinementRetryPrompt({
      basePrompt: retryPrompt.prompt,
      violation: error,
    }));
    deps.setLastPromptAudit(retryBuilt.promptAudit);
    const retrySession = await deps.runCopilotSessionForRetry(
      retryBuilt.copilotArgs,
      retryBuilt.promptAudit,
    );
    const retryRunSummary = retrySession.runSummary;
    deps.resetArtifactCompletionCache();
    if (retryRunSummary.exitCode !== 0) {
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
      });
    } catch (retryError: unknown) {
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
      });
      throw retryError;
    }

    return { runSummary: retryRunSummary, exitCode: retryRunSummary.exitCode };
  }
}
