import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createLogger,
  newSpanId,
  resolvePaths,
  writeProtocolStdout,
} from '../core/index.js';
import type { RunRoleAgentOptions, AgentRunResult } from './types.js';
import { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } from './metadata.js';
import { resolveAutonomyProfile, buildAgentArgs, formatAgentCommand } from './autonomy.js';
import { buildAgentEnvironment, buildAutonomyEnvironment } from './environment.js';
import { runRuntimePolicyCheck, guardrailReceiptPath, writeGuardrailReceipt } from './guardrails.js';
import {
  explainSelectedPrimaryBoundaryFailure,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
} from '../context-pack/focusedRepo.js';
import { readTextFile } from '../core/io.js';
import { buildAgentArtifactRemediationPrompt, checkAgentArtifactCompletion } from './artifactCompletion.js';
import { computeRuntimeFactsSourceSignature } from './runtimeFacts.js';
import {
  runAgentSession,
  correctSessionReceipt,
  refreshQaCodeDiff,
  mergeExternalMcpLaunchEnvironment,
  summarizeExternalMcpLaunchContext,
  logExternalMcpLaunchStatus,
  type PreparedAgentMcpLaunchContext,
} from './agentSession.js';
import type { ChangedPathsSnapshot } from './confinement.js';
import {
  buildArtifactCleanupPrompt,
  prepareDaltonBoundary,
  isDaltonFamilyAgent,
  daltonFamilyRuntimeLabel,
  handleDaltonConfinementValidation,
} from './daltonLaunchPrep.js';
import {
  buildWorktreeBindingMap,
  applyWorktreeInjectionToFocused,
  applyWorktreeInjectionToAllowedDirs,
} from './worktreeInjection.js';
import { buildReinforcementOverlay } from './reinforcementOverlay.js';

const log = createLogger('platform/agent-runner/roleAgent');
import {
  agentErrorWithTails,
  extractPolicyFailureDetails,
  hasConcreteArtifactRemediation,
  incompleteArtifactOwnerLabel,
  isRecoverableDeniedActionExit,
  buildDeniedActionContinuationPrompt,
} from './recoveryPasses.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { ProviderPromptKind, ResolvedMcpServer } from '../cli-provider/index.js';
import { resolveContextPackContainerPath, runtimeRequiresContainerPaths } from '../container/sharedMcp.js';
import { getPlatformConfig } from '../platform-config/get.js';

function launchPromptKind(agentId: RunRoleAgentOptions['agentId']): ProviderPromptKind {
  return agentId === 'lily'
    ? 'plan-task'
    : agentId === 'alice'
      ? 'start-task'
      : isDaltonFamilyAgent(agentId)
        ? 'execute-task'
        : 'continue-task';
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
  const provider = getActiveProvider(repoRoot);
  const promptPath = path.join(repoRoot, provider.resolvePromptPath(launchPromptKind(agentId)));
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

export function sha256Hex(value: string): string {
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

let roleLaunchCounter = 0;

export function createRoleLaunchId(): string {
  roleLaunchCounter += 1;
  return `${Date.now()}-${process.pid}-${roleLaunchCounter}`;
}

/**
 * Run a role agent through the full workflow:
 * 1. Resolve metadata from registry
 * 2. Check workflow policy (unless skipped)
 * 3. Resolve autonomy profile
  * 4. Build agent CLI args
  * 5. Launch and wait for agent process
 * 6. Write guardrail receipt
 */
export async function runRoleAgent(
  options: RunRoleAgentOptions,
): Promise<AgentRunResult> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const spanId = options.spanId ?? newSpanId();
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
  // §B1: when a per-task worktree exists, every downstream consumer of `focused`
  // and `autonomyArgs.allowedDirs` must see worktreeRoot paths instead of
  // originalRoot. Build the substitution map once before resolving focused.
  const worktreeBindingMap = await buildWorktreeBindingMap(options.taskId, paths.repoRoot);
  if (options.contextPackDir) {
    const allowsGenericTaskSailDirs = !enforcesSelectedPrimaryBoundary;
    if (allowsGenericTaskSailDirs) {
      // Non-Dalton context-pack launches still rely on workflow artifacts under
      // AgentWorkSpace. When a taskId is bound, restrict the allowance to the
      // per-task subtree plus shared read/write roots. This is the only
      // --add-dir backstop preventing two parallel artifact-author launches
      // (e.g. Alice on T1 and Alice on T2) from writing into each other's
      // task workspaces — there is no provider-level fence below this layer.
      // Pre-task launches (no taskId yet, e.g. intake) keep the catch-all
      // because the per-task subtree does not exist.
      const ws = path.join(paths.repoRoot, 'AgentWorkSpace');
      // `pendingitems` is intentionally NOT in this universal list and is not
      // declared on any per-profile `allowed_dirs` either. The platform's
      // queue/ module is the only authorized writer. Alice — the only agent
      // that ever needed to read intake — now reads it from the per-task
      // workspace through the active provider's handoffs env var, which
      // queue/operations.ts stages via copyFileSafe at activation time.
      const dirsToAdd = options.taskId
        ? [
            path.join(ws, 'tasks', options.taskId),
            path.join(ws, 'templates'),
            path.join(ws, 'qmd'),
          ]
        : [ws];
      for (const dir of dirsToAdd) {
        if (!autonomyArgs.allowedDirs.includes(dir)) {
          autonomyArgs.allowedDirs.push(dir);
        }
      }
    }

    const resolvedFocused = enforcesSelectedPrimaryBoundary
      ? await resolveSelectedPrimaryRepoRoot(
          options.contextPackDir,
          paths.repoRoot,
          { taskId: options.taskId },
        )
      : usesFocusedRepoLaunch || usesFocusedRepoContext || needsFocusedRepoVisibility
        ? await resolveFocusedRepoRoot(
            options.contextPackDir,
            paths.repoRoot,
            { taskId: options.taskId },
          )
        : undefined;

      // §B1: rewrite focused once, upstream of every consumer. Returns input
      // unchanged when the binding map is empty (legacy/recovery path).
      focused = resolvedFocused
        ? applyWorktreeInjectionToFocused(resolvedFocused, worktreeBindingMap)
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
        if (enforcesSelectedPrimaryBoundary) {
          const diagnostic = await explainSelectedPrimaryBoundaryFailure(
            options.contextPackDir,
            paths.repoRoot,
            { taskId: options.taskId },
          );
          throw new Error(
            `Cannot resolve the selected primary boundary for ${daltonFamilyRuntimeLabel(options.agentId)} ` +
            `from context pack "${options.contextPackDir}": ${diagnostic} ` +
            'Failing closed — Dalton-family launches require an authoritative active task/workspace selection ' +
            'with exactly one selected primary target.',
          );
        }
        throw new Error(
          `Cannot resolve focused repo root for repo-executor "${options.agentId}" ` +
          `from context pack "${options.contextPackDir}". ` +
          `Failing closed — repo-executor requires a resolvable focused repo.`,
        );
      } else if (usesFocusedRepoContext) {
        log.child({ taskId: options.taskId, agentId: options.agentId, spanId })
          .warn('focused_repo.resolve.skipped', { contextPackDir: options.contextPackDir });
      }

    // §B1 defense-in-depth: rewrite any originalRoot path that may have leaked
    // into allowedDirs (no-op when bindingMap is empty or no allowedDir matches).
    // Preserve platform-owned metadata/runtime roots: when a monolith context
    // pack points at a subtree inside the platform repo, originalRoot is the
    // platform root, but contextpacks/, AgentWorkSpace/, and .platform-state/
    // must remain outside the task worktree.
    autonomyArgs.allowedDirs = applyWorktreeInjectionToAllowedDirs(
      autonomyArgs.allowedDirs,
      worktreeBindingMap,
      {
        preservePrefixes: [
          paths.agentWorkSpace,
          paths.platformState,
          options.contextPackDir,
        ].filter((dir): dir is string => Boolean(dir)),
      },
    );
  }

  // 4. Build provider CLI args and resolve launch prompt.
  const provider = getActiveProvider(paths.repoRoot);
  const launchLog = log.child({
    taskId: options.taskId,
    agentId: options.agentId,
    providerId: provider.id,
    spanId,
  });
  const launchContext = {
    repoRoot: paths.repoRoot,
    requestedCwd: agentCwd,
    ...(focused?.primaryRepoRoot ? { focusedRepoRoot: focused.primaryRepoRoot } : {}),
  };
  const argsResult = buildAgentArgs(paths.repoRoot, profile, autonomyArgs, { launchContext });
  const cliArgs = [...argsResult.args];
  agentCwd = argsResult.launchCwd;
  // repo-executor agents (Dalton) get only their own instructions — global
  // workflow/artifact context is noise for a pure code agent.
  const includeGlobalInstructions = profile.autonomyProfile !== 'repo-executor';
  const launchPrompt = await resolveLaunchPrompt(paths.repoRoot, options.agentId, options.promptOverride);
  const reinforcementOverlay = await buildReinforcementOverlay({
    agentId: options.agentId,
    contextPackDir: options.contextPackDir,
    repoRoot: paths.repoRoot,
  });
  const appendReinforcementOverlay = (prompt: string): string => (
    reinforcementOverlay
      ? `${prompt.trim()}\n\n${reinforcementOverlay}`
      : prompt
  );
  const materializePrompt = (
    prompt: string,
    promptPath: string | null,
    promptSource: 'file' | 'override',
  ) => provider.materializePrompt({
    prompt: appendReinforcementOverlay(prompt),
    promptPath,
    promptSource,
    profile,
    launchContext,
    includeGlobalInstructions,
  });
  const runPromptOverrideSession = async (overridePrompt: string, overrideLaunchPhase?: string) => {
    const overridePromptResult = materializePrompt(overridePrompt, null, 'override');
    const overrideArgs = [...argsResult.args, '-p', overridePromptResult.effectivePrompt];
    const overridePromptAudit = buildPromptAudit({
      promptPath: null,
      promptSource: 'override',
      inlineAgentContext: overridePromptResult.inlineAgentContext,
      effectivePrompt: overridePromptResult.effectivePrompt,
    });
    lastPromptAudit = overridePromptAudit;
    const overrideSession = await runAgentSession({
      repoRoot: paths.repoRoot,
      cliArgs: overrideArgs,
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
  const promptResult = materializePrompt(launchPrompt.prompt, launchPrompt.promptPath, launchPrompt.promptSource);
  const effectivePrompt = promptResult.effectivePrompt;
  const promptAudit = buildPromptAudit({
    promptPath: launchPrompt.promptPath,
    promptSource: launchPrompt.promptSource,
    inlineAgentContext: promptResult.inlineAgentContext,
    effectivePrompt,
  });
  cliArgs.push('-p', effectivePrompt);

  const wallClockTimeoutS = options.wallClockBudget ?? profile.wallClockTimeoutS;
  const idleTimeoutS = options.idleTimeout ?? profile.idleTimeoutS;

  // 5. Build environment for the agent launch.
  let sharedMcp: { url: string; port: number } | undefined;
  let containerContextPackDir: string | undefined;
  let internalMcpServer: ResolvedMcpServer | undefined;
  if (options.contextPackDir) {
    const platformConfig = await getPlatformConfig(paths.repoRoot);
    const sharedMcpPort = platformConfig.mcp_port;
    const sharedMcpUrl = `http://localhost:${sharedMcpPort}/sse`;
    sharedMcp = { url: sharedMcpUrl, port: sharedMcpPort };
    containerContextPackDir = (await runtimeRequiresContainerPaths(paths.repoRoot))
      ? resolveContextPackContainerPath(
          paths.repoRoot,
          options.contextPackDir,
          platformConfig.repo_context_mcp_external_mount_roots,
        )
      : options.contextPackDir;
    internalMcpServer = {
      id: 'repo-context-mcp',
      transport: 'sse',
      url: sharedMcpUrl,
      headers: {
        'X-TaskSail-Task-Id': options.taskId ?? '',
        'X-TaskSail-Context-Pack-Dir': containerContextPackDir,
      },
    };
  }

  const agentEnv = buildAgentEnvironment(
    profile,
    containerContextPackDir ?? options.contextPackDir,
    paths.repoRoot,
    {
      skipHandoffEnvVars: enforcesSelectedPrimaryBoundary,
      wallClockTimeoutS,
      focused,
      ...(sharedMcp ? { mcp: sharedMcp } : {}),
    },
    options.taskId,
  );

  // 5b. Dry-run: print command and return before launch-time side effects.
  if (options.dryRun) {
    const cmd = formatAgentCommand(paths.repoRoot, cliArgs);
    writeProtocolStdout(formatDryRunOutput(cmd));
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
    taskId: options.taskId ?? '',
    agentEnv,
    internalMcpServer,
    spanId,
    abortSignal: options.abortSignal,
  });
  if (externalMcpLaunchContext?.injectionEnabled) {
    const configFilePath = (externalMcpLaunchContext as PreparedAgentMcpLaunchContext).configFilePath;
    if (configFilePath) {
      cliArgs.push(...provider.mcpConfigArgs(configFilePath));
    } else {
      launchLog.warn('external_mcp.config_path.missing');
    }
  }
  const mcpLaunch = summarizeExternalMcpLaunchContext(externalMcpLaunchContext);
  logExternalMcpLaunchStatus(options.agentId, mcpLaunch, {
    taskId: options.taskId,
    providerId: provider.id,
    spanId,
  });
  Object.assign(
    agentEnv,
    buildAutonomyEnvironment(
      profile,
      autonomyArgs,
      argsResult,
      agentCwd,
      paths.repoRoot,
      focused,
      options.contextPackDir,
      externalMcpLaunchContext,
    ),
  );

  // Preflight: verify that critical env-var paths are reachable before
  // launching the agent. A missing handoffs dir means the agent will
  // launch, fail to find its task context, and exit silently — which is
  // hard to diagnose. Fail fast with a clear message instead.
  const promptPathEnvVars = provider.promptPathEnvVars();
  const preflightPaths: [string, string][] = [
    [promptPathEnvVars.handoffsDir, agentEnv[promptPathEnvVars.handoffsDir] ?? ''],
    [promptPathEnvVars.implStepsDir, agentEnv[promptPathEnvVars.implStepsDir] ?? ''],
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
    taskId: options.taskId ?? '',
    abortSignal: options.abortSignal,
  });

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
      taskId: options.taskId ?? '',
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

  // Compute launchId at invocation time: epochMs-pid-counter is collision-resistant
  // within any single host process lifetime. Fleet-mode (§4.12) launches multiple
  // concurrent sub-Daltons with the same agentId — each must get its own launchId
  // so their receipts do not overwrite each other and §5.2 recoverOnStartup can
  // enumerate all pids per task and detect which are still alive.
  const launchId = createRoleLaunchId();
  const sessionInfo = {
    taskRuntime: paths.taskRuntime,
    launchId,
    agentId: options.agentId,
    roleName: profile.role,
    displayName: profile.displayName,
    launchPhase: options.launchPhase,
  };

  const daltonAgentSpawnedAtMs = enforcesSelectedPrimaryBoundary && focused && preRunBoundarySnapshot
    ? Date.now()
    : undefined;
  const initialSession = await runAgentSession({
    repoRoot: paths.repoRoot,
    cliArgs,
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
        ...argsResult.args,
        '-p',
      ];
      const continuationPromptResult = materializePrompt(
        buildDeniedActionContinuationPrompt(options.agentId),
        null,
        'override',
      );
      continuationArgs.push(continuationPromptResult.effectivePrompt);
      const continuationPromptAudit = buildPromptAudit({
        promptPath: null,
        promptSource: 'override',
        inlineAgentContext: continuationPromptResult.inlineAgentContext,
        effectivePrompt: continuationPromptResult.effectivePrompt,
      });
      lastPromptAudit = continuationPromptAudit;
      const continuationSession = await runAgentSession({
        repoRoot: paths.repoRoot,
        cliArgs: continuationArgs,
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
      agentSpawnedAtMs: daltonAgentSpawnedAtMs,
      runSummary,
      originalAssignmentPrompt: launchPrompt.prompt,
      writeLaunchGuardrailReceipt,
      resetArtifactCompletionCache,
      initialLaunchId: launchId,
      buildRetryArgs: (prompt: string) => {
        const retryPromptResult = materializePrompt(prompt, null, 'override');
        const retryEffectivePrompt = retryPromptResult.effectivePrompt;
        const cliArgs = [...argsResult.args, '-p', retryEffectivePrompt];
        const promptAudit = buildPromptAudit({
          promptPath: null,
          promptSource: 'override',
          inlineAgentContext: retryPromptResult.inlineAgentContext,
          effectivePrompt: retryEffectivePrompt,
        });
        return { cliArgs, promptAudit };
      },
      runAgentSessionForRetry: async (args, promptAudit) => {
        return runAgentSession({
          repoRoot: paths.repoRoot,
          cliArgs: args,
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
      runAgentSessionForConfinementRetry: async (args, promptAudit, metadata) => {
        return runAgentSession({
          repoRoot: paths.repoRoot,
          cliArgs: args,
          cwd: agentCwd,
          env: agentEnv,
          wallClockTimeoutS,
          idleTimeoutS,
          abortSignal: options.abortSignal,
          session: {
            ...sessionInfo,
            launchId: createRoleLaunchId(),
            launchPhase: metadata.launchPhase,
            retryOfLaunchId: metadata.retryOfLaunchId,
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
