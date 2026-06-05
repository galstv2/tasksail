import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createLogger,
  emitTaskProgressEvent,
  ensureDir,
  newSpanId,
  normalizeAgentLaunchPhase,
  resolvePaths,
  writeProtocolStdout,
} from '../core/index.js';
import type { RunRoleAgentOptions, AgentRunResult } from './types.js';
import { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } from './metadata.js';
import { resolveAutonomyProfile, buildAgentArgs, formatAgentCommand } from './autonomy.js';
import { buildAgentEnvironment, buildAutonomyEnvironment } from './environment.js';
import { runRuntimePolicyCheck, writeUniqueGuardrailReceipt } from './guardrails.js';
import {
  explainSelectedPrimaryBoundaryFailure,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
} from '../context-pack/focusedRepo.js';
import { readTextFile } from '../core/io.js';
import {
  boundedArtifactCompletionReasons,
  buildAgentArtifactRemediationPrompt,
  checkAgentArtifactCompletionDetails,
  formatIncompleteArtifactReasons,
  type AgentArtifactCompletionDetails,
} from './artifactCompletion.js';
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
import { prepopulateRequirementVerification } from './pipeline/requirementVerification.js';
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
import type { AgentId } from '../core/index.js';
import type { AgentLifecycleProgressInput } from '../core/taskProgressEvents.js';
import { resolveContextPackContainerPath, runtimeRequiresContainerPaths } from '../container/sharedMcp.js';
import { logPostSpawnReasoningEffortRejection, validateRoleAgentReasoningEffortBeforeSpawn } from './reasoningEffortLaunch.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { loadTaskPackSnapshot } from '../context-pack/taskPackSnapshot.js';
import { assertTaskWorktreeBindingsCoverSnapshot } from '../context-pack/taskWorktreeSelection.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';
import {
  assertNoOriginalTargetRootsInAgentLaunch,
  assertNoOriginalTargetRootsInTaskArtifacts,
} from './agentRootContainment.js';
import {
  buildAgentRuntimePathManifest,
  prependRuntimePathManifestToPrompt,
} from './agentRuntimePathManifest.js';
import {
  cleanupRoleAgentLaunchExtensions,
  prependRoleAgentLaunchAvailabilityNote,
  resolveRoleAgentLaunchExtensions,
  type RoleAgentLaunchExtensionResolution,
} from './roleLaunchExtensions.js';

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

async function ensureCleanupArtifactDirs(paths: { handoffs: string; implementationSteps: string }): Promise<void> {
  await Promise.all([
    ensureDir(paths.handoffs),
    ensureDir(paths.implementationSteps),
  ]);
}

async function prepopulateRequirementVerificationForRonLaunch(
  options: RunRoleAgentOptions,
  paths: { handoffs: string; repoRoot: string },
  behavior: { skipWhenPromptOverride: boolean } = { skipWhenPromptOverride: true },
): Promise<void> {
  if (
    options.agentId !== 'ron'
    || (behavior.skipWhenPromptOverride && options.promptOverride)
    || options.launchPhase === 'Retrospective'
  ) {
    return;
  }
  await prepopulateRequirementVerification({
    handoffsDir: paths.handoffs,
    repoRoot: paths.repoRoot,
  });
}

function forbiddenArtifactCleanupPathTokens(repoRoot: string): string[] {
  const envVars = getActiveProvider(repoRoot).promptPathEnvVars();
  return [
    `$${envVars.handoffsDir}`,
    `$${envVars.implStepsDir}`,
    'AgentWorkSpace/tasks/active',
  ];
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

const AGENT_LIFECYCLE_EVENT_TYPES = [{ type: 'agent.artifact_check.started' }, { type: 'agent.artifact_check.completed' }, { type: 'agent.artifact_check.failed' }, { type: 'agent.cleanup.started' }, { type: 'agent.cleanup.completed' }, { type: 'agent.cleanup.failed' }, { type: 'agent.policy_check.started' }, { type: 'agent.policy_check.completed' }, { type: 'agent.policy_check.failed' }, { type: 'agent.policy_remediation.started' }, { type: 'agent.policy_remediation.completed' }, { type: 'agent.policy_remediation.failed' }] as const;
type AgentLifecycleEventType = typeof AGENT_LIFECYCLE_EVENT_TYPES[number]['type'];

let roleLaunchCounter = 0;

export function createRoleLaunchId(): string {
  roleLaunchCounter += 1;
  return `${Date.now()}-${process.pid}-${roleLaunchCounter}`;
}

function extractPolicyViolationRuleIds(policyResult: { stdout: string }): string[] {
  try {
    const parsed: unknown = JSON.parse(policyResult.stdout);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { violations?: unknown }).violations)) {
      return [];
    }
    return (parsed as { violations: unknown[] }).violations
      .map((violation) => (
        violation && typeof violation === 'object'
          ? (violation as { rule_id?: unknown }).rule_id
          : undefined
      ))
      .filter((ruleId): ruleId is string => typeof ruleId === 'string');
  } catch {
    return [];
  }
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
  // Launch-extension staging happens INSIDE runRoleAgentInner, after the existing
  // authorization and workflow-policy gates and before provider arg/env construction
  // (exactDataFlow steps 1 -> 4). The inner reports its resolution back here via the
  // callback so the stage is cleaned exactly once in this finally, however the inner
  // returns or throws. A launch that fails an earlier gate never resolves — the
  // resolution stays undefined and cleanup is a no-op, so no assignment read or stage
  // directory is created for launches that should fail before extension work.
  let launchExtensionResolution: RoleAgentLaunchExtensionResolution | undefined;
  try {
    return await runRoleAgentInner(options, {
      setLaunchExtensionResolution: (resolution) => { launchExtensionResolution = resolution; },
    });
  } finally {
    await cleanupRoleAgentLaunchExtensions(launchExtensionResolution, {
      repoRoot: paths.repoRoot,
      agentId: options.agentId,
      taskId: options.taskId,
      launchId: launchExtensionResolution?.stageLaunchId,
    });
  }
}

async function runRoleAgentInner(
  options: RunRoleAgentOptions,
  ext: { setLaunchExtensionResolution: (resolution: RoleAgentLaunchExtensionResolution | undefined) => void },
): Promise<AgentRunResult> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const spanId = options.spanId ?? newSpanId();
  const startTime = Date.now();

  // 1. Load registry and resolve agent profile.
  const provider = getActiveProvider(paths.repoRoot);
  const registry = await loadAgentRegistry(paths.repoRoot);
  const profile = resolveAgentProfile(provider, registry, options.agentId);
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
      await writeUniqueGuardrailReceipt({
        repoRoot: paths.repoRoot,
        agentId: options.agentId,
        taskId: options.taskId,
        data: {
          schema_version: 1,
          status: 'failed',
          agent_id: options.agentId,
          model: activeModel,
          violations: failureDetails,
          policy_stdout: policyResult.stdout,
          policy_stderr: policyResult.stderr,
        },
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
              agentId: options.agentId, repoRoot: paths.repoRoot,
              taskId: options.taskId,
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
  const reasoningEffort = await validateRoleAgentReasoningEffortBeforeSpawn({ provider, logger: launchLog, repoRoot: paths.repoRoot, taskId: options.taskId, agentId: options.agentId, modelId: autonomyArgs.model, effort: autonomyArgs.reasoningEffort });
  // Resolve assigned launch extensions only after every pre-spawn gate above
  // (expectRole, skipWorkflowValidation authorization, workflow policy, focused
  // context, reasoning effort) and before the single buildAgentArgs/buildAgentEnvironment
  // calls. Dry-run never resolves or stages, keeping its command clean. The resolution
  // is reported to the wrapper so the stage is cleaned exactly once.
  const primaryLaunchId = createRoleLaunchId();
  const launchExtensionResolution: RoleAgentLaunchExtensionResolution | undefined = options.dryRun
    ? undefined
    : await resolveRoleAgentLaunchExtensions({
        repoRoot: paths.repoRoot,
        runtimeAgentId: options.agentId,
        stageLaunchId: primaryLaunchId,
      });
  ext.setLaunchExtensionResolution(launchExtensionResolution);
  const argsResult = buildAgentArgs(paths.repoRoot, profile, autonomyArgs, {
    launchContext,
    launchExtensions: launchExtensionResolution?.launchExtensions,
  });
  const cliArgs = [...argsResult.args];
  agentCwd = argsResult.launchCwd;
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
  let agentRuntimePathManifest: ReturnType<typeof buildAgentRuntimePathManifest>;
  const materializePrompt = (
    prompt: string, promptPath: string | null, promptSource: 'file' | 'override', manifest = agentRuntimePathManifest,
  ) => provider.materializePrompt({
    prompt: prependRuntimePathManifestToPrompt({
      prompt: prependRoleAgentLaunchAvailabilityNote({
        prompt: appendReinforcementOverlay(prompt),
        availabilityNote: launchExtensionResolution?.availabilityNote,
      }),
      manifest,
      provider,
    }),
    promptPath,
    promptSource,
    profile,
    launchContext,
    includeGlobalInstructions,
  });
  const runPromptOverrideSession = async (overridePrompt: string, overrideLaunchPhase?: string) => {
    const overrideLaunchId = createRoleLaunchId();
    const overrideManifest = { ...agentRuntimePathManifest, ...(overrideLaunchPhase !== undefined ? { launchPhase: overrideLaunchPhase } : {}), includeRoleArtifactChecklist: false };
    const overridePromptResult = materializePrompt(overridePrompt, null, 'override', overrideManifest);
    const overrideArgs = [...baseArgsWithMcp, '-p', overridePromptResult.effectivePrompt];
    const overridePromptAudit = buildPromptAudit({
      promptPath: null,
      promptSource: 'override',
      inlineAgentContext: overridePromptResult.inlineAgentContext,
      effectivePrompt: overridePromptResult.effectivePrompt,
    });
    lastPromptAudit = overridePromptAudit;
    lastReceiptLaunchId = overrideLaunchId;
    if (overrideLaunchPhase != null) {
      lastReceiptLaunchPhase = overrideLaunchPhase;
    }
    if (overrideLaunchPhase === 'Artifact Cleanup') {
      await emitAgentLifecycleEvent('agent.cleanup.started');
    } else if (overrideLaunchPhase === 'Policy Remediation') {
      await emitAgentLifecycleEvent('agent.policy_remediation.started');
    }
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
        launchId: overrideLaunchId,
        ...(overrideLaunchPhase != null ? { launchPhase: overrideLaunchPhase } : {}),
        promptAudit: overridePromptAudit,
      },
    });
    return {
      promptAudit: overridePromptAudit,
      session: overrideSession,
    };
  };
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

  const launchTaskSidecar = options.taskId
    ? readTaskJsonSafe(options.taskId, paths.repoRoot)
    : null;
  const launchSnapshot = options.contextPackDir && options.taskId && launchTaskSidecar
    ? await loadTaskPackSnapshot(paths.repoRoot, options.taskId)
    : undefined;

  const agentEnv = buildAgentEnvironment(
    profile,
    containerContextPackDir ?? options.contextPackDir,
    paths.repoRoot,
    {
      skipHandoffEnvVars: enforcesSelectedPrimaryBoundary,
      wallClockTimeoutS,
      focused,
      ...(sharedMcp ? { mcp: sharedMcp } : {}),
      ...(launchSnapshot ? { snapshot: launchSnapshot } : {}),
      ...(launchExtensionResolution?.launchExtensions
        ? { launchExtensions: launchExtensionResolution.launchExtensions }
        : {}),
    },
    options.taskId,
  );

  // 5b. Dry-run: print command and return before launch-time side effects.
  if (options.dryRun) {
    const dryRunPromptResult = provider.materializePrompt({
      prompt: appendReinforcementOverlay(launchPrompt.prompt),
      promptPath: launchPrompt.promptPath,
      promptSource: launchPrompt.promptSource,
      profile,
      launchContext,
      includeGlobalInstructions,
    });
    const cmd = formatAgentCommand(paths.repoRoot, [...cliArgs, '-p', dryRunPromptResult.effectivePrompt]);
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

  const emitRoleProgressEvent = async (event: Parameters<typeof emitTaskProgressEvent>[0]['event']): Promise<void> => {
    if (!options.taskId) return;
    await emitTaskProgressEvent({
      logger: launchLog,
      repoRoot: paths.repoRoot,
      taskId: options.taskId,
      event,
    }).catch(() => {});
  };
  const currentAgentLifecycleInput = (): AgentLifecycleProgressInput => ({
    agentId: options.agentId,
    launchId: lastReceiptLaunchId,
    displayPhase: normalizeAgentLaunchPhase({ agentId: options.agentId, launchPhase: lastReceiptLaunchPhase }),
  });
  const emitAgentLifecycleEvent = async (type: AgentLifecycleEventType): Promise<void> => {
    await emitRoleProgressEvent({ type, input: currentAgentLifecycleInput() });
  };
  const emitMcpProgressEvent = async (eventType: 'mcp.checked' | 'mcp.degraded' | 'mcp.failed', status: string, selectedCount = 0, excludedCount = 0): Promise<void> => {
    const normalizedStatus = status === 'available' || status === 'degraded' || status === 'failed' || status === 'not-applicable' || status === 'unavailable' || status === 'not-run'
      ? status
      : 'failed';
    const input = {
      agentId: options.agentId,
      status: normalizedStatus,
      injectionEnabled: eventType !== 'mcp.failed',
      selectedServerCount: selectedCount,
      excludedServerCount: excludedCount,
    } as const;
    if (eventType === 'mcp.checked') await emitRoleProgressEvent({ type: 'mcp.checked', input });
    else if (eventType === 'mcp.degraded') await emitRoleProgressEvent({ type: 'mcp.degraded', input });
    else await emitRoleProgressEvent({ type: 'mcp.failed', input });
  };

  let externalMcpLaunchContext: PreparedAgentMcpLaunchContext | undefined;
  try {
    externalMcpLaunchContext = await mergeExternalMcpLaunchEnvironment({
      agentId: options.agentId,
      repoRoot: paths.repoRoot,
      taskId: options.taskId ?? '',
      agentEnv,
      internalMcpServer,
      spanId,
      abortSignal: options.abortSignal,
    });
  } catch (err) {
    await emitMcpProgressEvent('mcp.failed', 'failed');
    throw err;
  }
  if (externalMcpLaunchContext?.injectionEnabled) {
    const configFilePath = (externalMcpLaunchContext as PreparedAgentMcpLaunchContext).configFilePath;
    if (configFilePath) {
      cliArgs.push(...provider.mcpConfigArgs(configFilePath));
    } else {
      launchLog.warn('external_mcp.config_path.missing');
    }
  }
  // Capture the augmented base args (after MCP injection, before the -p prompt arg) so that
  // follow-up sessions (denied-action continuation, cleanup/remediation, confinement retry)
  // carry the same --additional-mcp-config args as the initial session.
  const baseArgsWithMcp = [...cliArgs];
  const mcpLaunch = summarizeExternalMcpLaunchContext(externalMcpLaunchContext);
  const mcpEventType = mcpLaunch.status === 'degraded' || mcpLaunch.status === 'unavailable'
    ? 'mcp.degraded'
    : 'mcp.checked';
  await emitMcpProgressEvent(
    mcpEventType,
    mcpLaunch.status,
    mcpLaunch.selectedServerIds.length,
    mcpLaunch.excludedServerIds.length,
  );
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
  if (options.contextPackDir && options.taskId && launchTaskSidecar && launchSnapshot) {
    assertTaskWorktreeBindingsCoverSnapshot({
      taskId: options.taskId,
      snapshot: launchSnapshot,
      repoBindings: launchTaskSidecar.contextPackBinding.repoBindings,
      phase: options.agentId === 'ron' ? 'qa-diff' : 'agent-launch',
    });
    assertNoOriginalTargetRootsInAgentLaunch({
      taskId: options.taskId,
      agentId: options.agentId,
      surface: {
        focused,
        allowedDirs: autonomyArgs.allowedDirs,
        agentCwd,
        env: agentEnv,
        mcpLaunchContext: externalMcpLaunchContext,
      },
      repoBindings: launchTaskSidecar.contextPackBinding.repoBindings,
      platformRepoRoot: paths.repoRoot,
      contextPackDir: options.contextPackDir,
    });
    if (enforcesSelectedPrimaryBoundary) {
      assertNoOriginalTargetRootsInTaskArtifacts({
        taskId: options.taskId,
        agentId: options.agentId,
        repoBindings: launchTaskSidecar.contextPackBinding.repoBindings,
        platformRepoRoot: paths.repoRoot,
        contextPackDir: options.contextPackDir,
        artifacts: await readAgentExecutableArtifactsForContainment(paths.handoffs, paths.implementationSteps),
      });
    }
  }

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

  await prepopulateRequirementVerificationForRonLaunch(options, paths);

  agentRuntimePathManifest = buildAgentRuntimePathManifest({
    agentId: options.agentId,
    launchPhase: options.launchPhase,
    agentCwd,
    env: agentEnv,
    providerEnvVars: provider.runtimeManifestEnvVars(),
    includeRoleArtifactChecklist: options.promptOverride === undefined && options.launchPhase === undefined,
  });
  const promptResult = materializePrompt(launchPrompt.prompt, launchPrompt.promptPath, launchPrompt.promptSource);
  const effectivePrompt = promptResult.effectivePrompt;
  const promptAudit = buildPromptAudit({
    promptPath: launchPrompt.promptPath,
    promptSource: launchPrompt.promptSource,
    inlineAgentContext: promptResult.inlineAgentContext,
    effectivePrompt,
  });
  cliArgs.push('-p', effectivePrompt);

  let artifactCompletionSignature = '';
  let artifactCompletionResult: AgentArtifactCompletionDetails | undefined;
  let artifactCompletionInFlight: Promise<AgentArtifactCompletionDetails> | null = null;
  const COMPLETE_SIGNATURE = '__complete__';
  const resetArtifactCompletionCache = (): void => {
    artifactCompletionSignature = '';
    artifactCompletionResult = undefined;
    artifactCompletionInFlight = null;
  };
  const artifactCompletionDetailsCheck = async (): Promise<AgentArtifactCompletionDetails> => {
    const emitArtifactCheckResult = async (complete: boolean): Promise<void> => {
      if (complete) {
        await emitAgentLifecycleEvent('agent.artifact_check.completed');
      }
    };
    if (profile.registryId === 'qa') {
      await prepopulateRequirementVerificationForRonLaunch(options, paths, { skipWhenPromptOverride: false });
    }
    if (artifactCompletionInFlight) {
      return artifactCompletionInFlight;
    }
    if (artifactCompletionResult === undefined) {
      await emitAgentLifecycleEvent('agent.artifact_check.started');
      artifactCompletionInFlight = checkAgentArtifactCompletionDetails({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        abortSignal: options.abortSignal,
      }).then(async (result) => {
        artifactCompletionResult = result;
        artifactCompletionSignature = result.complete ? COMPLETE_SIGNATURE : '';
        if (result.complete) {
          await emitArtifactCheckResult(true);
        }
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
    await emitAgentLifecycleEvent('agent.artifact_check.started');
    artifactCompletionInFlight = checkAgentArtifactCompletionDetails({
      agentId: profile.registryId,
      handoffsDir: paths.handoffs,
      implStepsDir: paths.implementationSteps,
      repoRoot: paths.repoRoot,
      taskId: options.taskId,
      abortSignal: options.abortSignal,
    }).then(async (result) => {
      artifactCompletionResult = result;
      if (result.complete) {
        await emitArtifactCheckResult(true);
      }
      return result;
    }).finally(() => {
      artifactCompletionInFlight = null;
    });
    return artifactCompletionInFlight;
  };
  const artifactCompletionCheck = async (): Promise<boolean> => (
    (await artifactCompletionDetailsCheck()).complete
  );
  const artifactCompletionReceiptReasons = async (): Promise<string[]> => (
    boundedArtifactCompletionReasons((await artifactCompletionDetailsCheck()).reasons)
  );
  const artifactCompletionErrorSuffix = async (): Promise<string> => (
    formatIncompleteArtifactReasons((await artifactCompletionDetailsCheck()).reasons)
  );

  // Fleet sub-Daltons share agentId; each launch needs a unique receipt identity.
  // The primary launch ID is generated above (before extension staging) and reused
  // here for the initial session receipt.
  const launchId = primaryLaunchId;
  const sessionInfo = {
    taskRuntime: paths.taskRuntime,
    launchId,
    agentId: options.agentId,
    roleName: profile.role,
    displayName: profile.displayName,
    launchPhase: options.launchPhase,
  };
  let lastReceiptLaunchId = launchId;
  let lastReceiptLaunchPhase = options.launchPhase;

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
    launchDir: externalMcpLaunchContext?.launchDir,
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
  let lastPromptAudit = promptAudit;
  const writeLaunchGuardrailReceipt = async (data: Record<string, unknown>): Promise<void> => {
    await writeUniqueGuardrailReceipt({
      repoRoot: paths.repoRoot,
      agentId: options.agentId,
      taskId: options.taskId,
      launchId: lastReceiptLaunchId,
      launchPhase: lastReceiptLaunchPhase,
      data: {
        ...data,
        prompt_audit: {
          prompt_path: lastPromptAudit.promptPath,
          prompt_source: lastPromptAudit.promptSource,
          inline_agent_context: lastPromptAudit.inlineAgentContext,
          effective_prompt_sha256: lastPromptAudit.effectivePromptSha256,
        },
      },
    });
    const status = typeof data.status === 'string' ? data.status : '';
    const terminationReason = typeof data.termination_reason === 'string' ? data.termination_reason : undefined;
    const displayPhase = normalizeAgentLaunchPhase({ agentId: options.agentId, launchPhase: lastReceiptLaunchPhase });
    const boundedTerminationReason: 'artifact-incomplete' | 'next-role-blocked' | 'workflow-policy-blocked' | 'policy-blocked' | 'denied' | 'failed' | undefined = terminationReason === 'artifact-incomplete' || terminationReason === 'next-role-blocked' || terminationReason === 'workflow-policy-blocked' || terminationReason === 'policy-blocked' || terminationReason === 'denied' || terminationReason === 'failed'
      ? terminationReason
      : undefined;
    const input = {
      agentId: options.agentId,
      launchId: lastReceiptLaunchId,
      displayPhase,
      ...(boundedTerminationReason ? { terminationReason: boundedTerminationReason } : {}),
    };
    if (status === 'passed' || status === 'allowed') {
      await emitRoleProgressEvent({ type: 'guardrail.receipt.allowed', input });
    } else if (terminationReason === 'artifact-incomplete') {
      await emitRoleProgressEvent({ type: 'guardrail.receipt.artifact_incomplete', input });
    } else if (terminationReason === 'next-role-blocked' || terminationReason === 'workflow-policy-blocked' || terminationReason === 'policy-blocked') {
      await emitRoleProgressEvent({ type: 'guardrail.receipt.policy_blocked', input });
    } else if (status === 'failed' || status === 'denied') {
      await emitRoleProgressEvent({ type: 'guardrail.receipt.denied', input });
    } else {
      await emitRoleProgressEvent({ type: 'guardrail.receipt.malformed', input });
    }
  };
  const runRuntimePolicyCheckWithEvents = async (nextAgentId: string) => {
    await emitAgentLifecycleEvent('agent.policy_check.started');
    const result = await runRuntimePolicyCheck(paths.repoRoot, nextAgentId as AgentId, 'runtime', options.taskId);
    await emitAgentLifecycleEvent(result.exitCode === 0 ? 'agent.policy_check.completed' : 'agent.policy_check.failed');
    return result;
  };
  const acceptNonZeroCompletedCleanup = async (receiptFile: string | null, complete: boolean): Promise<void> => {
    if (runSummary.exitCode === 0 || !complete) return;
    launchLog.warn('agent.cleanup.nonzero_exit_artifacts_complete', { launchId: lastReceiptLaunchId, exitCode: runSummary.exitCode, terminationReason: runSummary.terminationReason });
    runSummary = { ...runSummary, exitCode: 0, terminationReason: 'exited' };
    exitCode = 0;
    await correctSessionReceipt(receiptFile, options.agentId);
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
        ...baseArgsWithMcp,
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
      const continuationLaunchId = createRoleLaunchId();
      lastPromptAudit = continuationPromptAudit;
      lastReceiptLaunchId = continuationLaunchId;
      lastReceiptLaunchPhase = options.launchPhase;
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
          launchId: continuationLaunchId,
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
    logPostSpawnReasoningEffortRejection({ providerId: provider.id, logger: launchLog, agentId: options.agentId, modelId: autonomyArgs.model, effort: reasoningEffort, output: `${runSummary.stdoutTail}\n${runSummary.stderrTail}` });
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
        const cliArgs = [...baseArgsWithMcp, '-p', retryEffectivePrompt];
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
        const retryLaunchId = metadata.launchId ?? createRoleLaunchId();
        lastReceiptLaunchId = retryLaunchId;
        lastReceiptLaunchPhase = metadata.launchPhase;
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
            launchId: retryLaunchId,
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
      createConfinementRetryLaunchId: createRoleLaunchId,
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
      ? await runRuntimePolicyCheckWithEvents(nextAgentId)
      : undefined;
    const nextPolicyBlocked = nextPolicyResult !== undefined && nextPolicyResult.exitCode !== 0;
    if (!artifactsComplete || nextPolicyBlocked) {
      const artifactPrompt = await buildAgentArtifactRemediationPrompt({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        abortSignal: options.abortSignal,
        policyViolationRuleIds: nextPolicyResult ? extractPolicyViolationRuleIds(nextPolicyResult) : [],
      });
      const artifactCompletionReasons = artifactsComplete ? [] : await artifactCompletionReceiptReasons();
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
          ...(artifactsComplete ? {} : { artifact_completion_reasons: artifactCompletionReasons }),
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

      await writeLaunchGuardrailReceipt({
        schema_version: 1,
        status: 'failed',
        agent_id: options.agentId,
        model: activeModel,
        exit_code: 0,
        termination_reason: artifactsComplete ? 'next-role-blocked' : 'artifact-incomplete',
        signal_code: runSummary.signalCode,
        stdout_tail: runSummary.stdoutTail,
        stderr_tail: policyFailureDetails ?? runSummary.stderrTail,
        ...(artifactsComplete ? {} : { artifact_completion_reasons: artifactCompletionReasons }),
      });
      const cleanupPrompt = buildArtifactCleanupPrompt({
        artifactPrompt,
        policyFailureDetails,
        forbiddenPathTokens: forbiddenArtifactCleanupPathTokens(paths.repoRoot),
      });
      await ensureCleanupArtifactDirs(paths);
      const cleanupSession = await runPromptOverrideSession(cleanupPrompt, 'Artifact Cleanup');
      runSummary = cleanupSession.session.runSummary;
      resetArtifactCompletionCache();
      artifactsComplete = await artifactCompletionCheck();
      await acceptNonZeroCompletedCleanup(cleanupSession.session.sessionReceiptFile, artifactsComplete);
      if (runSummary.exitCode !== 0) {
        await emitAgentLifecycleEvent('agent.cleanup.failed');
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
      if (!artifactsComplete) {
        const reasonText = await artifactCompletionErrorSuffix();
        await emitAgentLifecycleEvent('agent.cleanup.failed');
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
          artifact_completion_reasons: await artifactCompletionReceiptReasons(),
        });
        throw agentErrorWithTails(
          [
            `Agent "${options.agentId}" cleanup pass still left required workflow artifacts incomplete.`,
            reasonText,
          ].filter(Boolean).join('\n'),
          runSummary,
        );
      }
      await emitAgentLifecycleEvent('agent.cleanup.completed');

      if (nextAgentId) {
        nextPolicyResult = await runRuntimePolicyCheckWithEvents(nextAgentId);
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
      await prepopulateRequirementVerificationForRonLaunch(options, paths, { skipWhenPromptOverride: false });
      resetArtifactCompletionCache();
      const artifactPrompt = await buildAgentArtifactRemediationPrompt({
        agentId: profile.registryId,
        handoffsDir: paths.handoffs,
        implStepsDir: paths.implementationSteps,
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        abortSignal: options.abortSignal,
      });
      const artifactCompletionReasons = await artifactCompletionReceiptReasons();
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
          artifact_completion_reasons: artifactCompletionReasons,
        });
        throw agentErrorWithTails(
          `Agent "${options.agentId}" exited successfully with incomplete artifacts, but no concrete incomplete ${incompleteArtifactOwnerLabel(options.agentId)} artifacts were detected.`,
          runSummary,
        );
      }
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
        artifact_completion_reasons: artifactCompletionReasons,
      });
      const cleanupPrompt = buildArtifactCleanupPrompt({
        artifactPrompt,
        forbiddenPathTokens: forbiddenArtifactCleanupPathTokens(paths.repoRoot),
      });
      await ensureCleanupArtifactDirs(paths);
      const cleanupSession = await runPromptOverrideSession(cleanupPrompt, 'Artifact Cleanup');
      runSummary = cleanupSession.session.runSummary;
      resetArtifactCompletionCache();
      const artifactsCompleteAfterCleanup = await artifactCompletionCheck();
      await acceptNonZeroCompletedCleanup(cleanupSession.session.sessionReceiptFile, artifactsCompleteAfterCleanup);
      if (runSummary.exitCode !== 0) {
        await emitAgentLifecycleEvent('agent.cleanup.failed');
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
      if (!artifactsCompleteAfterCleanup) {
        const reasonText = await artifactCompletionErrorSuffix();
        await emitAgentLifecycleEvent('agent.cleanup.failed');
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
          artifact_completion_reasons: await artifactCompletionReceiptReasons(),
        });
        throw agentErrorWithTails(
          [
            `Agent "${options.agentId}" cleanup pass still left required workflow artifacts incomplete.`,
            reasonText,
          ].filter(Boolean).join('\n'),
          runSummary,
        );
      }
      await emitAgentLifecycleEvent('agent.cleanup.completed');
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
    let nextPolicyResult = await runRuntimePolicyCheckWithEvents(nextAgentId);
    if (nextPolicyResult.exitCode !== 0) {
      const nextFailureDetails = extractPolicyFailureDetails(nextPolicyResult);
      const remediationPrompt = [
        'Your previous run did not leave the workflow ready for the next role.',
        '',
        `Blocking workflow-policy details: ${nextFailureDetails}`,
        '',
        'Fix only the missing handoff artifacts or validation evidence required for handoff.',
        'Do not repeat unrelated work. Do not leave placeholder-only sections.',
      ].join('\n');
      const remediationSession = await runPromptOverrideSession(remediationPrompt, 'Policy Remediation');
      runSummary = remediationSession.session.runSummary;
      resetArtifactCompletionCache();
      if (runSummary.exitCode !== 0) {
        await emitAgentLifecycleEvent('agent.policy_remediation.failed');
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
        await emitAgentLifecycleEvent('agent.policy_remediation.failed');
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

      nextPolicyResult = await runRuntimePolicyCheckWithEvents(nextAgentId);
      if (nextPolicyResult.exitCode !== 0) {
        const finalFailureDetails = extractPolicyFailureDetails(nextPolicyResult);
        await emitAgentLifecycleEvent('agent.policy_remediation.failed');
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
      await emitAgentLifecycleEvent('agent.policy_remediation.completed');
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

async function readAgentExecutableArtifactsForContainment(
  handoffsDir: string,
  implementationStepsDir: string,
): Promise<Array<{ path: string; category: 'implementation-spec' | 'implementation-step'; content: string }>> {
  const artifacts: Array<{ path: string; category: 'implementation-spec' | 'implementation-step'; content: string }> = [];
  const implementationSpecPath = path.join(handoffsDir, 'implementation-spec.md');
  const implementationSpec = await readTextFile(implementationSpecPath);
  if (implementationSpec !== undefined) {
    artifacts.push({ path: implementationSpecPath, category: 'implementation-spec', content: implementationSpec });
  }
  let entries: string[] = [];
  try {
    entries = await readdir(implementationStepsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue;
    const artifactPath = path.join(implementationStepsDir, entry);
    const content = await readTextFile(artifactPath);
    if (content !== undefined) {
      artifacts.push({ path: artifactPath, category: 'implementation-step', content });
    }
  }
  return artifacts;
}
