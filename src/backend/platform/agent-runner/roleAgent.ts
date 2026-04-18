import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolvePaths } from '../core/index.js';
import type { RunRoleAgentOptions, AgentRunResult } from './types.js';
import { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } from './metadata.js';
import { resolveAutonomyProfile, buildCopilotArgs, formatCopilotCommand } from './autonomy.js';
import { buildAgentEnvironment, buildAutonomyEnvironment } from './environment.js';
import { runRuntimePolicyCheck, guardrailReceiptPath, writeGuardrailReceipt } from './guardrails.js';
import { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } from '../context-pack/focusedRepo.js';
import { readTextFile } from '../core/io.js';
import { buildAgentArtifactRemediationPrompt, checkAgentArtifactCompletion } from './artifactCompletion.js';
import { computeRuntimeFactsSourceSignature } from './runtimeFacts.js';
import {
  runCopilotSession,
  correctSessionReceipt,
  refreshQaCodeDiff,
  mergeExternalMcpLaunchEnvironment,
  summarizeExternalMcpLaunchContext,
  logExternalMcpLaunchStatus,
} from './copilotSession.js';
import type { ChangedPathsSnapshot } from './confinement.js';
import {
  buildArtifactCleanupPrompt,
  prepareDaltonBoundary,
  isDaltonFamilyAgent,
  daltonFamilyRuntimeLabel,
  handleDaltonConfinementValidation,
} from './daltonLaunchPrep.js';
import {
  agentErrorWithTails,
  extractPolicyFailureDetails,
  hasConcreteArtifactRemediation,
  incompleteArtifactOwnerLabel,
  isRecoverableDeniedActionExit,
  buildDeniedActionContinuationPrompt,
} from './recoveryPasses.js';

function launchPromptPath(repoRoot: string, agentId: RunRoleAgentOptions['agentId']): string {
  const promptFile = agentId === 'lily'
    ? 'plan-task.prompt.md'
    : agentId === 'alice'
      ? 'start-task.prompt.md'
      : isDaltonFamilyAgent(agentId)
        ? 'execute-task.prompt.md'
        : 'continue-task.prompt.md';
  return path.join(repoRoot, '.github', 'copilot', 'prompts', promptFile);
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

const NEXT_AGENT_BY_CURRENT: Partial<Record<RunRoleAgentOptions['agentId'], RunRoleAgentOptions['agentId']>> = {
  alice: 'dalton',
  dalton: 'ron',
};

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
  const paths = resolvePaths({ taskId: options.taskId });
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
      'runtime',
      options.taskId,
    );
    if (policyResult.exitCode !== 0) {
      const failureDetails = extractPolicyFailureDetails(policyResult);
      const receiptPath = guardrailReceiptPath(
        paths.repoRoot,
        options.agentId,
        options.taskId,
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
    options.taskId,
  );

  // 3b. When a context pack is active, resolve scoped target repos and add
  // them as allowed roots. Dalton-family repo-executor launches are confined
  // to focused target repos only, with dalton-verify retaining its narrow
  // verification temp-dir exception.
  // All repo-executor agents launch from the focused repo CWD with inlined
  // agent context. Dalton also gets selected-primary confinement enforcement.
  const usesFocusedRepoLaunch = profile.autonomyProfile === 'repo-executor';
  const usesFocusedRepoContext = options.agentId === 'lily';
  const needsFocusedRepoVisibility = profile.autonomyProfile === 'qa-executor';
  const enforcesSelectedPrimaryBoundary =
    profile.autonomyProfile === 'repo-executor' && isDaltonFamilyAgent(options.agentId);
  const verificationTempAllowedDir = options.agentId === 'dalton-verify'
    ? options.verificationTempAllowedDir?.trim() || undefined
    : undefined;
  let agentCwd = paths.repoRoot;
  let focused;
  let preRunBoundarySnapshot: ChangedPathsSnapshot | undefined;
  if (options.contextPackDir) {
    const agentWorkspaceDir = path.join(paths.repoRoot, 'AgentWorkSpace');
    const allowsGenericTaskSailDirs = !enforcesSelectedPrimaryBoundary;
    if (allowsGenericTaskSailDirs && !autonomyArgs.allowedDirs.includes(agentWorkspaceDir)) {
      // Non-Dalton context-pack launches still rely on workflow artifacts under
      // AgentWorkSpace. Add it explicitly instead of relying on implicit
      // CWD-subtree access from the Copilot CLI.
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
        if (enforcesSelectedPrimaryBoundary) {
          const daltonBoundary = await prepareDaltonBoundary(
            focused,
            {
              agentId: options.agentId,
              repoRoot: paths.repoRoot,
              usesFocusedRepoLaunch,
              verificationTempAllowedDir,
            },
            autonomyArgs,
          );
          agentCwd = daltonBoundary.agentCwd;
          preRunBoundarySnapshot = daltonBoundary.preRunBoundarySnapshot;
        } else {
          for (const root of focused.visibleRepoRoots) {
            autonomyArgs.allowedDirs.push(root);
          }
          if (usesFocusedRepoLaunch) {
            agentCwd = focused.primaryRepoRoot;
            if (!autonomyArgs.allowedDirs.includes(paths.repoRoot)) {
              autonomyArgs.allowedDirs.push(paths.repoRoot);
            }
          }
        }
      } else if (usesFocusedRepoLaunch || enforcesSelectedPrimaryBoundary) {
        throw new Error(
          enforcesSelectedPrimaryBoundary
            ? `Cannot resolve the selected primary boundary for ${daltonFamilyRuntimeLabel(options.agentId)} from context pack "${options.contextPackDir}". ` +
              'Failing closed — Dalton-family launches require an authoritative active task/workspace selection with exactly one selected primary target.'
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
    options.taskId,
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
      taskRuntime: paths.taskRuntime,
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

  // Compute launchId at invocation time: epochMs-pid pair is collision-resistant
  // within any single host process lifetime. Fleet-mode (§4.12) launches multiple
  // concurrent sub-Daltons with the same agentId — each must get its own launchId
  // so their receipts do not overwrite each other and §5.2 recoverOnStartup can
  // enumerate all pids per task and detect which are still alive.
  const launchId = `${Date.now()}-${process.pid}`;
  const sessionInfo = {
    taskRuntime: paths.taskRuntime,
    launchId,
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
    paths.repoRoot,
    options.agentId,
    options.taskId,
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

  if (exitCode !== 0 && isRecoverableDeniedActionExit(runSummary)) {
    const artifactsCompleteAfterDeniedExit = isDaltonFamilyAgent(options.agentId) || await artifactCompletionCheck();
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
    const confinementResult = await handleDaltonConfinementValidation({
      repoRoot: paths.repoRoot,
      agentId: options.agentId,
      activeModel,
      focused,
      preRunBoundarySnapshot,
      runSummary,
      writeLaunchGuardrailReceipt,
      resetArtifactCompletionCache,
      buildRetryArgs: (prompt: string) => {
        const retryEffectivePrompt = inlineAgentContext(prompt);
        const copilotArgs = [...buildCopilotArgs(profile, autonomyArgs, { skipAgentFlag }), '-p', retryEffectivePrompt];
        const promptAudit = buildPromptAudit({
          promptPath: null,
          promptSource: 'override',
          inlineAgentContext: skipAgentFlag,
          effectivePrompt: retryEffectivePrompt,
        });
        return { copilotArgs, promptAudit };
      },
      runCopilotSessionForRetry: async (args, promptAudit) => {
        return runCopilotSession({
          copilotArgs: args,
          cwd: agentCwd,
          env: agentEnv,
          wallClockTimeoutS,
          idleTimeoutS,
          abortSignal: options.abortSignal,
          session: {
            ...sessionInfo,
            promptAudit: promptAudit as {
              promptPath: string | null;
              promptSource: 'file' | 'override';
              inlineAgentContext: boolean;
              effectivePromptSha256: string;
            },
          },
        });
      },
      setLastPromptAudit: (audit) => { lastPromptAudit = audit; },
    });
    if (confinementResult) {
      runSummary = confinementResult.runSummary;
      exitCode = confinementResult.exitCode;
    }
  }

  // Dalton-family agents have no required SWE artifacts (artifact I/O was
  // removed from the SWE pipeline), so skip the artifact completion check.
  let artifactsComplete = isDaltonFamilyAgent(options.agentId) || await artifactCompletionCheck();
  const nextAgentId = NEXT_AGENT_BY_CURRENT[options.agentId];

  if (options.agentId === 'alice') {
    let nextPolicyResult = artifactsComplete && nextAgentId
      ? await runRuntimePolicyCheck(paths.repoRoot, nextAgentId, 'runtime', options.taskId)
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
        nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId, 'runtime', options.taskId);
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
    let nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId, 'runtime', options.taskId);
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

      nextPolicyResult = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId, 'runtime', options.taskId);
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
