import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolvePaths, getErrorMessage } from '../core/index.js';
import type { RunRoleAgentOptions, AgentRunResult, AgentMcpLaunchStatus } from './types.js';
import { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } from './metadata.js';
import { resolveAutonomyProfile, buildCopilotArgs, formatCopilotCommand } from './autonomy.js';
import { buildAgentEnvironment, buildAutonomyEnvironment } from './environment.js';
import { runRuntimePolicyCheck, guardrailReceiptPath, writeGuardrailReceipt } from './guardrails.js';
import { launchCopilot, waitForCopilotDetailed } from './processLifecycle.js';
import { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } from '../context-pack/focusedRepo.js';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import { readTextFile } from '../core/io.js';
import { buildAgentArtifactRemediationPrompt, checkAgentArtifactCompletion } from './artifactCompletion.js';
import { computeRuntimeFactsSourceSignature } from './runtimeFacts.js';
import {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
  type ExternalMcpLaunchContext,
} from './pythonHelpers.js';
import { writeSessionStartReceipt, writeSessionTerminalReceipt } from './sessionReceipts.js';
import {
  captureChangedPathsSnapshot,
  type ChangedPathsSnapshot,
  DaltonConfinementError,
  validateDaltonBoundaryChanges,
} from './confinement.js';

function launchPromptPath(repoRoot: string, agentId: RunRoleAgentOptions['agentId']): string {
  const promptFile = agentId === 'lily'
    ? 'plan-task.prompt.md'
    : agentId === 'alice'
      ? 'start-task.prompt.md'
      : agentId === 'dalton'
        ? 'execute-task.prompt.md'
      : 'continue-task.prompt.md';
  return path.join(repoRoot, '.github', 'copilot', 'prompts', promptFile);
}

function confinementRetryPromptPath(
  repoRoot: string,
  agentId: RunRoleAgentOptions['agentId'],
): string {
  if (agentId !== 'dalton') {
    throw new Error(`Confinement retry prompt is only defined for Dalton. Got: ${agentId}`);
  }
  return path.join(repoRoot, '.github', 'copilot', 'prompts', 'execute-task-retry.prompt.md');
}

function formatDryRunOutput(
  command: string,
): string {
  return `${command}\n`;
}

async function resolveLaunchPrompt(
  repoRoot: string,
  agentId: RunRoleAgentOptions['agentId'],
  promptOverride?: string,
): Promise<{ prompt: string; promptPath: string | null; promptSource: 'file' | 'override' }> {
  if (promptOverride?.trim()) {
    return {
      prompt: promptOverride.trim(),
      promptPath: null,
      promptSource: 'override',
    };
  }
  const promptPath = launchPromptPath(repoRoot, agentId);
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildPromptAudit(options: {
  promptPath: string | null;
  promptSource: 'file' | 'override';
  inlineAgentContext: boolean;
  effectivePrompt: string;
}): {
  promptPath: string | null;
  promptSource: 'file' | 'override';
  inlineAgentContext: boolean;
  effectivePromptSha256: string;
} {
  return {
    promptPath: options.promptPath,
    promptSource: options.promptSource,
    inlineAgentContext: options.inlineAgentContext,
    effectivePromptSha256: sha256Hex(options.effectivePrompt),
  };
}

function formatOutputSection(label: string, content: string): string {
  return `--- ${label} ---\n${content || '<no output>'}`;
}

function agentErrorWithTails(
  message: string,
  runSummary: { stdoutTail: string; stderrTail: string },
): Error {
  return new Error(
    [
      message,
      formatOutputSection('stdout tail', runSummary.stdoutTail),
      formatOutputSection('stderr tail', runSummary.stderrTail),
    ].join('\n'),
  );
}

function extractPolicyFailureDetails(
  policyResult: { stdout: string; stderr: string },
): string {
  const stderr = policyResult.stderr.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = policyResult.stdout.trim();
  if (!stdout) {
    return '';
  }

  try {
    const parsed = JSON.parse(stdout) as {
      violations?: Array<{ message?: string; rule_id?: string }>;
      next_steps?: string[];
    };
    const violationLines = (parsed.violations ?? [])
      .map((violation) => violation.message?.trim() || violation.rule_id?.trim() || '')
      .filter((line) => line.length > 0);
    const nextStepLines = (parsed.next_steps ?? [])
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const combined = [...violationLines, ...nextStepLines];
    if (combined.length > 0) {
      return combined.join(' | ');
    }
  } catch {
    // Fall back to raw stdout when the validator did not emit JSON.
  }

  return stdout;
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

function hasConcreteArtifactRemediation(prompt: string): boolean {
  return prompt.trim().length > 0;
}

function incompleteArtifactOwnerLabel(agentId: RunRoleAgentOptions['agentId']): string {
  if (agentId === 'alice') return 'Alice';
  if (agentId === 'dalton') return 'Dalton';
  if (agentId === 'ron') return 'Ron';
  return agentId;
}

function resolveDaltonLaunchCwd(focused: FocusedRepoResult): string {
  if (!focused.primaryFocusRelativePath) {
    return focused.primaryRepoRoot;
  }

  const focusCwd = path.join(focused.primaryRepoRoot, focused.primaryFocusRelativePath);
  if (!existsSync(focusCwd)) {
    throw new Error(
      `Cannot launch agent "dalton": selected monolith focus subfolder "${focused.primaryFocusRelativePath}" ` +
      `does not exist at "${focusCwd}".`,
    );
  }

  return focusCwd;
}

function buildArtifactCleanupPrompt(options: {
  agentId: RunRoleAgentOptions['agentId'];
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

const RECOVERABLE_ARTIFACT_AUTHOR_DENIAL_PATTERNS = [
  /permission denied and could not request permission from user/i,
  /could not request permission from user/i,
];

function isRecoverableArtifactAuthorDeniedAction(
  autonomyProfile: string,
  runSummary: Awaited<ReturnType<typeof waitForCopilotDetailed>>,
): boolean {
  if (autonomyProfile !== 'artifact-author') {
    return false;
  }
  const combinedOutput = `${runSummary.stdoutTail}\n${runSummary.stderrTail}`;
  return RECOVERABLE_ARTIFACT_AUTHOR_DENIAL_PATTERNS.some((pattern) => pattern.test(combinedOutput));
}

function buildDeniedActionContinuationPrompt(agentId: RunRoleAgentOptions['agentId']): string {
  const owner = incompleteArtifactOwnerLabel(agentId);
  return [
    `Your previous ${owner} run attempted a denied command or permission request and exited early.`,
    '',
    'Do not run shell commands.',
    'Do not request permission.',
    'Do not retry denied tools.',
    'Continue from the current workspace state using only allowed read/search/write tools.',
    'If you want to verify artifact content, inspect the files directly instead of executing commands.',
    'Finish only the remaining workflow artifacts for your role, then stop.',
  ].join('\n');
}

async function refreshQaCodeDiff(options: {
  agentId: RunRoleAgentOptions['agentId'];
  contextPackDir?: string;
  handoffsDir: string;
  repoRoot: string;
  abortSignal?: AbortSignal;
}): Promise<void> {
  if (options.agentId !== 'ron' || !options.contextPackDir) {
    return;
  }

  const outputPath = path.join(options.handoffsDir, 'code-changes.diff');
  const result = await captureCodeDiff({
    contextPackDir: options.contextPackDir,
    outputPath,
    repoRoot: options.repoRoot,
    abortSignal: options.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate QA code diff at ${outputPath}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

async function mergeExternalMcpLaunchEnvironment(options: {
  agentId: RunRoleAgentOptions['agentId'];
  repoRoot: string;
  agentEnv: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext | undefined> {
  try {
    const launchContext = await prepareExternalMcpLaunchContext({
      agentId: options.agentId,
      repoRoot: options.repoRoot,
      env: options.agentEnv,
      abortSignal: options.abortSignal,
    });
    if (launchContext.injectionEnabled) {
      if (!launchContext.configFilePath && launchContext.envExports['COPILOT_HOME']) {
        launchContext.configFilePath = path.join(launchContext.envExports['COPILOT_HOME'], 'mcp-config.json');
      }
      delete launchContext.envExports['COPILOT_HOME'];
      Object.assign(options.agentEnv, launchContext.envExports);
      return launchContext;
    }
    if (launchContext.status !== 'not-applicable') {
      console.warn(
        '[roleAgent] external MCP launch context unavailable, continuing without MCP:',
        `${launchContext.status}: ${launchContext.reason}`,
      );
    }
    return launchContext;
  } catch (err) {
    console.warn(
      '[roleAgent] external MCP launch context failed, continuing without MCP:',
      getErrorMessage(err),
    );
    return undefined;
  }
}

function summarizeExternalMcpLaunchContext(
  launchContext: ExternalMcpLaunchContext | undefined,
): AgentMcpLaunchStatus {
  if (!launchContext) {
    return {
      status: 'unavailable',
      reason: 'launch context helper failed',
      injectionEnabled: false,
      selectedServerIds: [],
      excludedServerIds: [],
    };
  }

  return {
    status: launchContext.status,
    reason: launchContext.reason,
    injectionEnabled: launchContext.injectionEnabled,
    selectedServerIds: [...launchContext.selectedServerIds],
    excludedServerIds: [...launchContext.excludedServerIds],
  };
}

function logExternalMcpLaunchStatus(
  agentId: RunRoleAgentOptions['agentId'],
  launchStatus: AgentMcpLaunchStatus,
): void {
  console.log(
    '[roleAgent] MCP launch status:',
    JSON.stringify({
      agentId,
      status: launchStatus.status,
      injectionEnabled: launchStatus.injectionEnabled,
      selectedServerIds: launchStatus.selectedServerIds,
      excludedServerIds: launchStatus.excludedServerIds,
      reason: launchStatus.reason,
    }),
  );
}

const NEXT_AGENT_BY_CURRENT: Partial<Record<RunRoleAgentOptions['agentId'], RunRoleAgentOptions['agentId']>> = {
  alice: 'dalton',
  dalton: 'ron',
};

/** Correct a session receipt to 'completed' after greedy-stop or denied-action recovery overrides exitCode to 0. */
async function correctSessionReceipt(receiptFile: string | null, agentId: string): Promise<void> {
  if (!receiptFile) return;
  await writeSessionTerminalReceipt({
    receiptPath: receiptFile,
    agentId,
    terminalStatus: 'completed',
    exitCode: 0,
  }).catch(() => {});
}

async function runCopilotSession(options: {
  copilotArgs: string[];
  cwd: string;
  env: Record<string, string>;
  wallClockTimeoutS?: number;
  idleTimeoutS?: number;
  abortSignal?: AbortSignal;
  greedyStopOnArtifactCompletion?: {
    pollIntervalMs?: number;
    completionCheck: () => Promise<boolean>;
  };
  session?: {
    repoRoot: string;
    agentId: string;
    roleName: string;
    displayName: string;
    promptAudit?: {
      promptPath: string | null;
      promptSource: 'file' | 'override';
      inlineAgentContext: boolean;
      effectivePromptSha256: string;
    };
  };
}): Promise<{
  runSummary: Awaited<ReturnType<typeof waitForCopilotDetailed>>;
  greedyStopTriggered: boolean;
  sessionReceiptFile: string | null;
}> {
  const child = launchCopilot(options.copilotArgs, {
    cwd: options.cwd,
    env: options.env,
    wallClockTimeoutS: options.wallClockTimeoutS,
    idleTimeoutS: options.idleTimeoutS,
  });

  // Write session start receipt for the runtime stream watcher.
  let sessionReceiptFile: string | undefined;
  if (options.session) {
    try {
      sessionReceiptFile = await writeSessionStartReceipt({
        ...options.session,
        launchPid: child.pid ?? null,
      });
    } catch {
      // Non-fatal — the terminal feed just won't show the start event.
    }
  }

  let greedyStopTriggered = false;
  let greedyMonitorError: unknown;
  let greedyCheckInFlight = false;
  const greedyPollIntervalMs = options.greedyStopOnArtifactCompletion?.pollIntervalMs ?? 1000;
  const greedyTimer = options.greedyStopOnArtifactCompletion
    ? setInterval(() => {
      if (greedyCheckInFlight || greedyStopTriggered) {
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      greedyCheckInFlight = true;
      void options.greedyStopOnArtifactCompletion?.completionCheck()
        .then((complete) => {
          if (!complete || greedyStopTriggered) {
            return;
          }
          if (child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          greedyStopTriggered = true;
          child.kill('SIGTERM');
        })
        .catch((err: unknown) => {
          if (greedyMonitorError === undefined) {
            greedyMonitorError = err;
          }
        })
        .finally(() => {
          greedyCheckInFlight = false;
        });
    }, greedyPollIntervalMs)
    : undefined;

  const runSummary = await waitForCopilotDetailed(child, {
    wallClockTimeoutMs: options.wallClockTimeoutS !== undefined
      ? options.wallClockTimeoutS * 1000
      : undefined,
    idleTimeoutMs: options.idleTimeoutS !== undefined
      ? options.idleTimeoutS * 1000
      : undefined,
    abortSignal: options.abortSignal,
  });
  if (greedyTimer) {
    clearInterval(greedyTimer);
  }

  // Write session terminal receipt for the runtime stream watcher.
  if (sessionReceiptFile && options.session) {
    try {
      await writeSessionTerminalReceipt({
        receiptPath: sessionReceiptFile,
        agentId: options.session.agentId,
        terminalStatus: runSummary.exitCode === 0 ? 'completed' : 'failed',
        exitCode: runSummary.exitCode,
      });
    } catch {
      // Non-fatal — the terminal feed just won't show the end event.
    }
  }

  if (greedyMonitorError !== undefined) {
    throw greedyMonitorError;
  }
  return {
    runSummary,
    greedyStopTriggered,
    sessionReceiptFile: sessionReceiptFile ?? null,
  };
}

/**
 * Run a role agent through the full workflow:
 * 1. Resolve metadata from registry
 * 2. Check workflow policy (unless skipped)
 * 3. Resolve autonomy profile
 * 4. Build copilot CLI args
 * 5. Launch and wait for copilot process
 * 6. Write guardrail receipt
 */
export async function runRoleAgent(
  options: RunRoleAgentOptions,
): Promise<AgentRunResult> {
  const paths = resolvePaths();
  const startTime = Date.now();

  // 1. Load registry and resolve agent profile.
  const registry = await loadAgentRegistry(paths.repoRoot);
  const profile = resolveAgentProfile(registry, options.agentId);
  const activeModel = resolveActiveModel(options.agentId, profile);

  // 1b. Optional role expectation check.
  if (options.expectRole && options.agentId !== options.expectRole) {
    throw new Error(
      `Agent ID '${options.agentId}' does not match expected role '${options.expectRole}'.`,
    );
  }

  // 2. Workflow policy check (unless bypassed by internal orchestrators).
  if (options.skipWorkflowValidation) {
    const allowBypass = (process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] ?? '').trim().toLowerCase();
    if (allowBypass !== 'true') {
      throw new Error(
        '--skip-workflow-check is reserved for controlled internal orchestrators. ' +
        'Set RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS=true.',
      );
    }
    const orchestratorId = (process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] ?? '').trim();
    const knownOrchestrators = new Set([
      'pipeline-sequencer',
      'remediation-loop',
    ]);
    if (!knownOrchestrators.has(orchestratorId)) {
      throw new Error(
        `--skip-workflow-check requires a known orchestrator ID via RUN_ROLE_AGENT_ORCHESTRATOR_ID. ` +
        `Got: '${orchestratorId}'. Known: ${[...knownOrchestrators].sort().join(', ')}.`,
      );
    }
  }

  if (!options.skipWorkflowValidation) {
    const policyResult = await runRuntimePolicyCheck(
      paths.repoRoot,
      options.agentId,
    );
    if (policyResult.exitCode !== 0) {
      const failureDetails = extractPolicyFailureDetails(policyResult);
      const receiptPath = guardrailReceiptPath(
        paths.guardrails,
        options.agentId,
      );
      await writeGuardrailReceipt(receiptPath, {
        schema_version: 1,
        status: 'failed',
        agent_id: options.agentId,
        model: activeModel,
        violations: failureDetails,
        policy_stdout: policyResult.stdout,
        policy_stderr: policyResult.stderr,
      });
      throw new Error(
        `Workflow policy check failed for agent "${options.agentId}": ${failureDetails}`,
      );
    }
  }

  // 3. Resolve autonomy profile.
  const autonomyArgs = resolveAutonomyProfile(
    profile,
    options.contextPackDir,
    paths.repoRoot,
  );

  // 3b. When a context pack is active, resolve scoped target repos and add
  // them as allowed roots (AgentWorkSpace/ + target_folders).
  // All repo-executor agents launch from the focused repo CWD with inlined
  // agent context. Dalton also gets selected-primary confinement enforcement.
  const usesFocusedRepoLaunch = profile.autonomyProfile === 'repo-executor';
  const usesFocusedRepoContext = options.agentId === 'lily';
  const needsFocusedRepoVisibility = profile.autonomyProfile === 'qa-executor';
  const enforcesSelectedPrimaryBoundary =
    profile.autonomyProfile === 'repo-executor' && options.agentId === 'dalton';
  let agentCwd = paths.repoRoot;
  let focused;
  let preRunBoundarySnapshot: ChangedPathsSnapshot | undefined;
  if (options.contextPackDir) {
    const agentWorkspaceDir = path.join(paths.repoRoot, 'AgentWorkSpace');
    if (!autonomyArgs.allowedDirs.includes(agentWorkspaceDir)) {
      // Dalton launches from the platform repo root, but workflow artifacts still
      // live under AgentWorkSpace. Add it explicitly for all context-pack runs
      // instead of relying on implicit CWD-subtree access from the Copilot CLI.
      autonomyArgs.allowedDirs.push(agentWorkspaceDir);
    }

    focused = enforcesSelectedPrimaryBoundary
      ? await resolveSelectedPrimaryRepoRoot(
          options.contextPackDir,
          paths.repoRoot,
        )
      : usesFocusedRepoLaunch || usesFocusedRepoContext || needsFocusedRepoVisibility
        ? await resolveFocusedRepoRoot(
            options.contextPackDir,
            paths.repoRoot,
          )
        : undefined;

      if (focused) {
        // Add the activated reference repo set as allowed dirs so Dalton can read
        // support repos, while post-run confinement still hard-enforces writes to
        // the selected primary repo/focus boundary only.
        for (const root of focused.visibleRepoRoots) {
          autonomyArgs.allowedDirs.push(root);
        }
        if (usesFocusedRepoLaunch) {
          agentCwd = enforcesSelectedPrimaryBoundary
            ? resolveDaltonLaunchCwd(focused)
            : focused.primaryRepoRoot;
          autonomyArgs.allowedDirs.push(paths.repoRoot);
        }
        if (enforcesSelectedPrimaryBoundary) {
          preRunBoundarySnapshot = await captureChangedPathsSnapshot([
            paths.repoRoot,
            ...focused.declaredRepoRoots,
          ]);
        }
      } else if (usesFocusedRepoLaunch || enforcesSelectedPrimaryBoundary) {
        throw new Error(
          enforcesSelectedPrimaryBoundary
            ? `Cannot resolve the selected primary boundary for Dalton from context pack "${options.contextPackDir}". ` +
              'Failing closed — Dalton requires an authoritative active task/workspace selection with exactly one selected primary target.'
            : `Cannot resolve focused repo root for repo-executor "${options.agentId}" ` +
              `from context pack "${options.contextPackDir}". ` +
              `Failing closed — repo-executor requires a resolvable focused repo.`,
        );
      } else if (usesFocusedRepoContext) {
        console.warn(
          `[roleAgent] planning-agent could not resolve focused repo roots from context pack "${options.contextPackDir}". ` +
          'Continuing with planning workspace dirs only.',
        );
      }
    }

  // 4. Build copilot CLI args and resolve launch prompt.
  const skipAgentFlag = usesFocusedRepoLaunch && focused != null;
  const globalInstructionsPath = path.join(paths.repoRoot, '.github', 'copilot', 'instructions', 'global.instructions.md');
  // repo-executor agents (Dalton) get only their own instructions — global
  // workflow/artifact context is noise for a pure code agent.
  const skipGlobalInstructions = profile.autonomyProfile === 'repo-executor';
  const [launchPrompt, globalInstructions, agentProfileContent, instructionContent] = await Promise.all([
    resolveLaunchPrompt(paths.repoRoot, options.agentId, options.promptOverride),
    skipAgentFlag && !skipGlobalInstructions ? readTextFile(globalInstructionsPath) : Promise.resolve(undefined),
    skipAgentFlag && profile.agentProfilePath
      ? readTextFile(path.join(paths.repoRoot, profile.agentProfilePath))
      : Promise.resolve(undefined),
    skipAgentFlag && profile.instructionPath
      ? readTextFile(path.join(paths.repoRoot, profile.instructionPath))
      : Promise.resolve(undefined),
  ]);
  // When skipAgentFlag is true, inline the agent context into every prompt —
  // Copilot CLI can't discover agent config from CWD when it's an external repo.
  const inlineAgentContext = (prompt: string): string =>
    skipAgentFlag
      ? [globalInstructions?.trim(), agentProfileContent?.trim(), instructionContent?.trim(), prompt].filter(Boolean).join('\n\n---\n\n')
      : prompt;
  const runPromptOverrideSession = async (overridePrompt: string, overrideLaunchPhase?: string) => {
    const effectivePrompt = inlineAgentContext(overridePrompt);
    const overrideArgs = [...buildCopilotArgs(profile, autonomyArgs, { skipAgentFlag }), '-p', effectivePrompt];
    const overridePromptAudit = buildPromptAudit({
      promptPath: null,
      promptSource: 'override',
      inlineAgentContext: skipAgentFlag,
      effectivePrompt,
    });
    lastPromptAudit = overridePromptAudit;
    const overrideSession = await runCopilotSession({
      copilotArgs: overrideArgs,
      cwd: agentCwd,
      env: agentEnv,
      wallClockTimeoutS,
      idleTimeoutS,
      abortSignal: options.abortSignal,
      session: {
        ...sessionInfo,
        ...(overrideLaunchPhase != null ? { launchPhase: overrideLaunchPhase } : {}),
        promptAudit: overridePromptAudit,
      },
    });
    return {
      promptAudit: overridePromptAudit,
      session: overrideSession,
    };
  };
  const effectivePrompt = inlineAgentContext(launchPrompt.prompt);
  const promptAudit = buildPromptAudit({
    promptPath: launchPrompt.promptPath,
    promptSource: launchPrompt.promptSource,
    inlineAgentContext: skipAgentFlag,
    effectivePrompt,
  });
  const copilotArgs = [...buildCopilotArgs(profile, autonomyArgs, { skipAgentFlag }), '-p', effectivePrompt];
  const autonomyEnv = buildAutonomyEnvironment(
    profile,
    autonomyArgs,
    agentCwd,
    paths.repoRoot,
    focused,
    options.contextPackDir,
  );

  // 5. Build environment for the copilot launch.
  const agentEnv = buildAgentEnvironment(
    profile,
    options.contextPackDir,
    paths.repoRoot,
    { skipHandoffEnvVars: enforcesSelectedPrimaryBoundary },
  );

  if (options.wallClockBudget !== undefined) {
    agentEnv['COPILOT_WALL_CLOCK_TIMEOUT_S'] = String(options.wallClockBudget);
  }

  // 6b. Merge autonomy exports into env.
  Object.assign(agentEnv, autonomyEnv);

  // 5b. Dry-run: print command and return before launch-time side effects.
  if (options.dryRun) {
    const cmd = formatCopilotCommand(copilotArgs);
    process.stdout.write(formatDryRunOutput(cmd));
    return {
      exitCode: 0,
      agentId: options.agentId,
      durationMs: Date.now() - startTime,
      mcpLaunch: {
        status: 'not-run',
        reason: 'dry-run launch skipped',
        injectionEnabled: false,
        selectedServerIds: [],
        excludedServerIds: [],
      },
    };
  }

  const externalMcpLaunchContext = await mergeExternalMcpLaunchEnvironment({
    agentId: options.agentId,
    repoRoot: paths.repoRoot,
    agentEnv,
    abortSignal: options.abortSignal,
  });
  if (externalMcpLaunchContext?.injectionEnabled) {
    if (externalMcpLaunchContext.configFilePath) {
      copilotArgs.push('--additional-mcp-config', `@${externalMcpLaunchContext.configFilePath}`);
    } else {
      console.warn(
        '[roleAgent] external MCP config file path unavailable, continuing without MCP flag injection.',
      );
    }
  }
  const mcpLaunch = summarizeExternalMcpLaunchContext(externalMcpLaunchContext);
  logExternalMcpLaunchStatus(options.agentId, mcpLaunch);
  if (externalMcpLaunchContext && externalMcpLaunchContext.status !== 'not-applicable') {
    Object.assign(
      agentEnv,
      buildAutonomyEnvironment(
        profile,
        autonomyArgs,
        agentCwd,
        paths.repoRoot,
        focused,
        options.contextPackDir,
        externalMcpLaunchContext,
      ),
    );
  }

  // Preflight: verify that critical env-var paths are reachable before
  // launching the copilot. A missing handoffs dir means the agent will
  // launch, fail to find its task context, and exit silently — which is
  // hard to diagnose. Fail fast with a clear message instead.
  const preflightPaths: [string, string][] = [
    ['COPILOT_HANDOFFS_DIR', agentEnv['COPILOT_HANDOFFS_DIR'] ?? ''],
    ['COPILOT_IMPL_STEPS_DIR', agentEnv['COPILOT_IMPL_STEPS_DIR'] ?? ''],
  ];
  for (const [envKey, envPath] of preflightPaths) {
    if (envPath && !existsSync(envPath)) {
      throw new Error(
        `Preflight failed for agent "${options.agentId}": ${envKey} points to "${envPath}" which does not exist. ` +
        `Agent CWD: ${agentCwd}`,
      );
    }
  }

  await refreshQaCodeDiff({
    agentId: options.agentId,
    contextPackDir: options.contextPackDir,
    handoffsDir: paths.handoffs,
    repoRoot: paths.repoRoot,
    abortSignal: options.abortSignal,
  });

  const wallClockTimeoutS = options.wallClockBudget ?? profile.wallClockTimeoutS;
  const idleTimeoutS = options.idleTimeout ?? profile.idleTimeoutS;
  let artifactCompletionSignature = '';
  let artifactCompletionResult: boolean | undefined;
  let artifactCompletionInFlight: Promise<boolean> | null = null;
  const COMPLETE_SIGNATURE = '__complete__';
  const resetArtifactCompletionCache = (): void => {
    artifactCompletionSignature = '';
    artifactCompletionResult = undefined;
    artifactCompletionInFlight = null;
  };
  const artifactCompletionCheck = async (): Promise<boolean> => {
    if (artifactCompletionInFlight) {
      return artifactCompletionInFlight;
    }
    if (artifactCompletionResult === undefined) {
      artifactCompletionInFlight = checkAgentArtifactCompletion({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        abortSignal: options.abortSignal,
      }).then((result) => {
        artifactCompletionResult = result;
        artifactCompletionSignature = result ? COMPLETE_SIGNATURE : '';
        return result;
      }).finally(() => {
        artifactCompletionInFlight = null;
      });
      return artifactCompletionInFlight;
    }
    if (artifactCompletionSignature === COMPLETE_SIGNATURE) {
      return artifactCompletionResult;
    }
    const signature = await computeRuntimeFactsSourceSignature({
      repoRoot: paths.repoRoot,
      handoffsDir: paths.handoffs,
      implStepsDir: paths.implementationSteps,
    });
    if (artifactCompletionResult !== undefined && signature === artifactCompletionSignature) {
      return artifactCompletionResult;
    }
    artifactCompletionSignature = signature;
    artifactCompletionInFlight = checkAgentArtifactCompletion({
      agentId: profile.registryId,
      handoffsDir: paths.handoffs,
      implStepsDir: paths.implementationSteps,
      repoRoot: paths.repoRoot,
      abortSignal: options.abortSignal,
    }).then((result) => {
      artifactCompletionResult = result;
      return result;
    }).finally(() => {
      artifactCompletionInFlight = null;
    });
    return artifactCompletionInFlight;
  };

  const sessionInfo = {
    repoRoot: paths.repoRoot,
    agentId: options.agentId,
    roleName: profile.role,
    displayName: profile.displayName,
    launchPhase: options.launchPhase,
  };

  const initialSession = await runCopilotSession({
    copilotArgs,
    cwd: agentCwd,
    env: agentEnv,
    wallClockTimeoutS,
    idleTimeoutS,
    abortSignal: options.abortSignal,
    session: {
      ...sessionInfo,
      promptAudit,
    },
    greedyStopOnArtifactCompletion: options.agentId === 'alice' || options.agentId === 'ron'
      ? {
        completionCheck: artifactCompletionCheck,
      }
      : undefined,
  });
  let runSummary = initialSession.runSummary;
  let exitCode = runSummary.exitCode;
  resetArtifactCompletionCache();
  if (initialSession.greedyStopTriggered) {
    const artifactsCompleteAfterGreedyStop = await artifactCompletionCheck();
    if (artifactsCompleteAfterGreedyStop) {
      runSummary = {
        ...runSummary,
        exitCode: 0,
        terminationReason: 'exited',
      };
      exitCode = 0;
      await correctSessionReceipt(initialSession.sessionReceiptFile, options.agentId);
    }
  }

  const durationMs = Date.now() - startTime;
  const receiptPath = guardrailReceiptPath(
    paths.guardrails,
    options.agentId,
  );
  let lastPromptAudit = promptAudit;
  const writeLaunchGuardrailReceipt = async (data: Record<string, unknown>): Promise<void> => {
    await writeGuardrailReceipt(receiptPath, {
      ...data,
      prompt_audit: {
        prompt_path: lastPromptAudit.promptPath,
        prompt_source: lastPromptAudit.promptSource,
        inline_agent_context: lastPromptAudit.inlineAgentContext,
        effective_prompt_sha256: lastPromptAudit.effectivePromptSha256,
      },
    });
  };

  if (exitCode !== 0 && isRecoverableArtifactAuthorDeniedAction(profile.autonomyProfile, runSummary)) {
    const artifactsCompleteAfterDeniedExit = await artifactCompletionCheck();
    if (artifactsCompleteAfterDeniedExit) {
      runSummary = {
        ...runSummary,
        exitCode: 0,
        terminationReason: 'exited',
      };
      exitCode = 0;
      await correctSessionReceipt(initialSession.sessionReceiptFile, options.agentId);
    } else {
      const continuationArgs = [
        ...buildCopilotArgs(profile, autonomyArgs, { skipAgentFlag }),
        '-p',
        inlineAgentContext(buildDeniedActionContinuationPrompt(options.agentId)),
      ];
      const continuationPromptAudit = buildPromptAudit({
        promptPath: null,
        promptSource: 'override',
        inlineAgentContext: skipAgentFlag,
        effectivePrompt: continuationArgs[continuationArgs.length - 1] as string,
      });
      lastPromptAudit = continuationPromptAudit;
      const continuationSession = await runCopilotSession({
        copilotArgs: continuationArgs,
        cwd: agentCwd,
        env: agentEnv,
        wallClockTimeoutS,
        idleTimeoutS,
        abortSignal: options.abortSignal,
        session: {
          ...sessionInfo,
          promptAudit: continuationPromptAudit,
        },
        greedyStopOnArtifactCompletion: options.agentId === 'alice' || options.agentId === 'ron'
          ? {
            completionCheck: artifactCompletionCheck,
          }
          : undefined,
      });
      runSummary = continuationSession.runSummary;
      exitCode = runSummary.exitCode;
      resetArtifactCompletionCache();
      if (continuationSession.greedyStopTriggered) {
        const artifactsCompleteAfterContinuation = await artifactCompletionCheck();
        if (artifactsCompleteAfterContinuation) {
          runSummary = {
            ...runSummary,
            exitCode: 0,
            terminationReason: 'exited',
          };
          exitCode = 0;
          await correctSessionReceipt(continuationSession.sessionReceiptFile, options.agentId);
        }
      }
    }
  }

  if (exitCode !== 0) {
    await writeLaunchGuardrailReceipt({
      schema_version: 1,
      status: 'failed',
      agent_id: options.agentId,
      model: activeModel,
      exit_code: exitCode,
      termination_reason: runSummary.terminationReason,
      signal_code: runSummary.signalCode,
      stdout_tail: runSummary.stdoutTail,
      stderr_tail: runSummary.stderrTail,
    });
    throw agentErrorWithTails(
      `Agent "${options.agentId}" exited with code ${exitCode} (${runSummary.terminationReason}).`,
      runSummary,
    );
  }

  if (enforcesSelectedPrimaryBoundary && focused && preRunBoundarySnapshot) {
    try {
      const postRunBoundarySnapshot = await captureChangedPathsSnapshot([
        paths.repoRoot,
        ...focused.declaredRepoRoots,
      ]);
      validateDaltonBoundaryChanges({
        platformRepoRoot: paths.repoRoot,
        focused,
        before: preRunBoundarySnapshot,
        after: postRunBoundarySnapshot,
      });
    } catch (error: unknown) {
      if (!(error instanceof DaltonConfinementError)) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'confinement-violation',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: getErrorMessage(error),
          violation_paths: [],
        });
        throw error;
      }

      const retryPrompt = await resolveConfinementRetryPrompt(paths.repoRoot, options.agentId);
      const retryEffectivePrompt = inlineAgentContext(buildDaltonConfinementRetryPrompt({
        basePrompt: retryPrompt.prompt,
        violation: error,
      }));
      const retryArgs = [...buildCopilotArgs(profile, autonomyArgs, { skipAgentFlag }), '-p', retryEffectivePrompt];
      const retryPromptAudit = buildPromptAudit({
        promptPath: retryPrompt.promptPath,
        promptSource: retryPrompt.promptSource,
        inlineAgentContext: skipAgentFlag,
        effectivePrompt: retryEffectivePrompt,
      });
      lastPromptAudit = retryPromptAudit;
      const retrySession = await runCopilotSession({
        copilotArgs: retryArgs,
        cwd: agentCwd,
        env: agentEnv,
        wallClockTimeoutS,
        idleTimeoutS,
        abortSignal: options.abortSignal,
        session: {
          ...sessionInfo,
          promptAudit: retryPromptAudit,
        },
      });
      runSummary = retrySession.runSummary;
      exitCode = runSummary.exitCode;
      resetArtifactCompletionCache();
      if (runSummary.exitCode !== 0) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: runSummary.exitCode,
          termination_reason: runSummary.terminationReason,
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" confinement retry exited with code ${runSummary.exitCode} (${runSummary.terminationReason}).`,
          runSummary,
        );
      }

      try {
        const postRetryBoundarySnapshot = await captureChangedPathsSnapshot([
          paths.repoRoot,
          ...focused.declaredRepoRoots,
        ]);
        validateDaltonBoundaryChanges({
          platformRepoRoot: paths.repoRoot,
          focused,
          // Compare against the original pre-run state so retry passes cannot
          // gradually creep outside the boundary and normalize that drift.
          before: preRunBoundarySnapshot,
          after: postRetryBoundarySnapshot,
        });
      } catch (retryError: unknown) {
        const violationPaths = retryError instanceof DaltonConfinementError
          ? retryError.violationPaths
          : [];
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'confinement-violation',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: getErrorMessage(retryError),
          violation_paths: violationPaths,
        });
        throw retryError;
      }
    }
  }

  // Dalton has no required artifacts (artifact I/O was removed from the SWE
  // pipeline), so skip the artifact completion check entirely for Dalton.
  let artifactsComplete = options.agentId === 'dalton' || await artifactCompletionCheck();
  const nextAgentId = NEXT_AGENT_BY_CURRENT[options.agentId];

  if (options.agentId === 'alice') {
    let nextPolicyResult = artifactsComplete && nextAgentId
      ? await runRuntimePolicyCheck(paths.repoRoot, nextAgentId)
      : undefined;
    const nextPolicyBlocked = nextPolicyResult !== undefined && nextPolicyResult.exitCode !== 0;
    if (!artifactsComplete || nextPolicyBlocked) {
      const artifactPrompt = await buildAgentArtifactRemediationPrompt({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        abortSignal: options.abortSignal,
      });
      const policyFailureDetails = nextPolicyBlocked && nextPolicyResult
        ? extractPolicyFailureDetails(nextPolicyResult)
        : undefined;
      if (!hasConcreteArtifactRemediation(artifactPrompt)) {
        const terminationReason = artifactsComplete ? 'next-role-blocked' : 'artifact-incomplete';
        const stderrTail = policyFailureDetails ?? runSummary.stderrTail;
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: terminationReason,
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: stderrTail,
        });
        if (artifactsComplete) {
          throw new Error(
            `Workflow policy check failed for next agent "${nextAgentId}" after agent "${options.agentId}" completed, but no concrete incomplete ${incompleteArtifactOwnerLabel(options.agentId)} artifacts were detected: ${policyFailureDetails}`,
          );
        }
        throw agentErrorWithTails(
          `Agent "${options.agentId}" exited successfully with incomplete artifacts, but no concrete incomplete ${incompleteArtifactOwnerLabel(options.agentId)} artifacts were detected.`,
          runSummary,
        );
      }

      const cleanupPrompt = buildArtifactCleanupPrompt({
        agentId: options.agentId,
        artifactPrompt,
        policyFailureDetails,
      });
      const cleanupSession = await runPromptOverrideSession(cleanupPrompt, 'Artifact Cleanup');
      runSummary = cleanupSession.session.runSummary;
      resetArtifactCompletionCache();
      if (runSummary.exitCode !== 0) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: runSummary.exitCode,
          termination_reason: runSummary.terminationReason,
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" cleanup pass exited with code ${runSummary.exitCode} (${runSummary.terminationReason}).`,
          runSummary,
        );
      }

      artifactsComplete = await artifactCompletionCheck();
      if (!artifactsComplete) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'artifact-incomplete',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" cleanup pass still left required workflow artifacts incomplete.`,
          runSummary,
        );
      }

      if (nextAgentId) {
        nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId);
        if (nextPolicyResult.exitCode !== 0) {
          const finalFailureDetails = extractPolicyFailureDetails(nextPolicyResult);
          await writeLaunchGuardrailReceipt({
            schema_version: 1,
            status: 'failed',
            agent_id: options.agentId,
            model: activeModel,
            exit_code: 0,
            termination_reason: 'next-role-blocked',
            signal_code: runSummary.signalCode,
            stdout_tail: runSummary.stdoutTail,
            stderr_tail: finalFailureDetails,
          });
          throw new Error(
            `Workflow policy check failed for next agent "${nextAgentId}" after agent "${options.agentId}" completed: ${finalFailureDetails}`,
          );
        }
      }
    }
  } else if (!artifactsComplete) {
    if (options.agentId === 'ron') {
      const artifactPrompt = await buildAgentArtifactRemediationPrompt({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        abortSignal: options.abortSignal,
      });
      if (!hasConcreteArtifactRemediation(artifactPrompt)) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'artifact-incomplete',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" exited successfully with incomplete artifacts, but no concrete incomplete ${incompleteArtifactOwnerLabel(options.agentId)} artifacts were detected.`,
          runSummary,
        );
      }
      const cleanupSession = await runPromptOverrideSession(buildArtifactCleanupPrompt({
        agentId: options.agentId,
        artifactPrompt,
      }), 'Artifact Cleanup');
      runSummary = cleanupSession.session.runSummary;
      resetArtifactCompletionCache();
      if (runSummary.exitCode !== 0) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: runSummary.exitCode,
          termination_reason: runSummary.terminationReason,
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" cleanup pass exited with code ${runSummary.exitCode} (${runSummary.terminationReason}).`,
          runSummary,
        );
      }
      const artifactsCompleteAfterCleanup = await artifactCompletionCheck();
      if (!artifactsCompleteAfterCleanup) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'artifact-incomplete',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" cleanup pass still left required workflow artifacts incomplete.`,
          runSummary,
        );
      }
    } else {
      await writeLaunchGuardrailReceipt({
        schema_version: 1,
        status: 'failed',
        agent_id: options.agentId,
        model: activeModel,
        exit_code: exitCode,
        termination_reason: 'artifact-incomplete',
        signal_code: runSummary.signalCode,
        stdout_tail: runSummary.stdoutTail,
        stderr_tail: runSummary.stderrTail,
      });
      throw agentErrorWithTails(
        `Agent "${options.agentId}" exited successfully but did not complete its required workflow artifacts.`,
        runSummary,
      );
    }
  }

  if (options.agentId !== 'alice' && nextAgentId && !options.skipWorkflowValidation) {
    let nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId);
    if (nextPolicyResult.exitCode !== 0) {
      const nextFailureDetails = extractPolicyFailureDetails(nextPolicyResult);
      let shouldRetryCurrentAgent = true;
      let remediationPrompt = [
        'Your previous run did not leave the workflow ready for the next role.',
        '',
        `Blocking workflow-policy details: ${nextFailureDetails}`,
        '',
        'Fix only the missing handoff artifacts or validation evidence required for handoff.',
        'Do not repeat unrelated work. Do not leave placeholder-only sections.',
      ].join('\n');
      if (!shouldRetryCurrentAgent) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'next-role-blocked',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: nextFailureDetails,
        });
        throw new Error(
          `Workflow policy check failed for next agent "${nextAgentId}" after agent "${options.agentId}" completed, but no concrete incomplete ${incompleteArtifactOwnerLabel(options.agentId)} artifacts were detected: ${nextFailureDetails}`,
        );
      }
      const remediationSession = await runPromptOverrideSession(remediationPrompt, 'Policy Remediation');
      runSummary = remediationSession.session.runSummary;
      resetArtifactCompletionCache();
      if (runSummary.exitCode !== 0) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: runSummary.exitCode,
          termination_reason: runSummary.terminationReason,
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" remediation pass exited with code ${runSummary.exitCode} (${runSummary.terminationReason}).`,
          runSummary,
        );
      }

      const artifactsCompleteAfterRemediation = await artifactCompletionCheck();
      if (!artifactsCompleteAfterRemediation) {
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'artifact-incomplete',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: runSummary.stderrTail,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" remediation pass still left required workflow artifacts incomplete.`,
          runSummary,
        );
      }

      nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId);
      if (nextPolicyResult.exitCode !== 0) {
        const finalFailureDetails = extractPolicyFailureDetails(nextPolicyResult);
        await writeLaunchGuardrailReceipt({
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          exit_code: 0,
          termination_reason: 'next-role-blocked',
          signal_code: runSummary.signalCode,
          stdout_tail: runSummary.stdoutTail,
          stderr_tail: finalFailureDetails,
        });
        throw new Error(
          `Workflow policy check failed for next agent "${nextAgentId}" after agent "${options.agentId}" completed: ${finalFailureDetails}`,
        );
      }
    }
  }

  await writeLaunchGuardrailReceipt({
    schema_version: 1,
    status: 'passed',
    agent_id: options.agentId,
    model: activeModel,
    exit_code: exitCode,
    termination_reason: runSummary.terminationReason,
    signal_code: runSummary.signalCode,
    stdout_tail: runSummary.stdoutTail,
    stderr_tail: runSummary.stderrTail,
  });

  return {
    exitCode,
    agentId: options.agentId,
    durationMs,
    mcpLaunch,
  };
}
