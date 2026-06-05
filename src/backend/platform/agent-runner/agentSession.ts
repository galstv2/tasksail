import path from 'node:path';
import { mkdirSync, chmodSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import {
  createLogger,
  emitTaskProgressEvent,
  formatTaskAgentDisplayName,
  getErrorMessage,
  normalizeAgentLaunchPhase,
  normalizeTaskAgentLaunchOutcome,
  type TaskAgentLaunchOutcome,
} from '../core/index.js';
import type { AgentRunStatus } from '../core/index.js';
import type { RunRoleAgentOptions, AgentMcpLaunchStatus } from './types.js';
import { launchAgent, waitForAgentDetailed } from './processLifecycle.js';
import {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
  type ExternalMcpLaunchContext,
} from './pythonHelpers.js';
import {
  writeSessionMonitorHeartbeat,
  writeSessionStartReceipt,
  writeSessionTerminalReceipt,
} from './sessionReceipts.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { ResolvedMcpServer } from '../cli-provider/index.js';
import { getPlatformConfig } from '../platform-config/get.js';

const log = createLogger('platform/agent-runner/agentSession');

export type PreparedAgentMcpLaunchContext = ExternalMcpLaunchContext & {
  configFilePath?: string;
};

export type { ExternalMcpLaunchContext };

let internalMcpLaunchCounter = 0;

type AgentSessionTerminalProjection = {
  progressStatus: AgentRunStatus;
  outcome: TaskAgentLaunchOutcome;
  terminalStatus: 'completed' | 'failed';
  exitCode: number;
};

export async function refreshQaCodeDiff(options: {
  agentId: RunRoleAgentOptions['agentId'];
  contextPackDir?: string;
  handoffsDir: string;
  repoRoot: string;
  taskId: string;
  abortSignal?: AbortSignal;
}): Promise<void> {
  if (options.agentId !== 'ron' || !options.contextPackDir) {
    return;
  }

  const outputPath = path.join(options.handoffsDir, 'code-changes.diff');
  const result = await captureCodeDiff({
    outputPath,
    repoRoot: options.repoRoot,
    taskId: options.taskId,
    abortSignal: options.abortSignal,
  });

  if (result.exitCode !== 0) {
    const diagnostics = [
      result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : undefined,
      result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : undefined,
    ].filter((entry): entry is string => Boolean(entry));
    throw new Error([
      `QA code diff generation failed for task ${options.taskId}; refusing to launch Ron with a stale or incomplete code-changes.diff.`,
      ...diagnostics,
    ].join('\n'));
  }
}

export async function mergeExternalMcpLaunchEnvironment(options: {
  agentId: RunRoleAgentOptions['agentId'];
  repoRoot: string;
  taskId: string;
  spanId?: string;
  agentEnv: Record<string, string>;
  internalMcpServer?: ResolvedMcpServer;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext | undefined> {
  const provider = getActiveProvider(options.repoRoot);
  const launchLog = log.child({
    taskId: options.taskId,
    agentId: options.agentId,
    spanId: options.spanId,
  });
  // Set when prepareExternalMcpLaunchContext throws and we synthesize a fallback
  // launchContext so the internal MCP can still be wired up. Carries the
  // underlying error message for diagnostic logging and signals downstream
  // branches that the launchContext is our synthesized fallback rather than a
  // real helper response.
  let helperFailureMessage: string | undefined;

  const renderMergedConfig = (
    launchContext: ExternalMcpLaunchContext,
    externalInjectionEnabled: boolean,
  ): PreparedAgentMcpLaunchContext => {
    const mergedServers = [
      ...(options.internalMcpServer ? [options.internalMcpServer] : []),
      ...(externalInjectionEnabled ? launchContext.resolvedServers : []),
    ];
    if (mergedServers.length === 0) {
      return launchContext;
    }

    const launchDir = launchContext.launchDir ?? createInternalMcpLaunchDir(
      options.repoRoot,
      provider.homeDirName(),
      options.agentId,
    );
    try {
      const configFilePath = provider.renderMcpConfig(launchDir, mergedServers);
      // Preserve the synthesized failure reason so operators can see why the
      // external helper failed; otherwise emit the success message.
      const internalOnlyWithExternalIssue = !externalInjectionEnabled
        && launchContext.status !== 'not-applicable';
      return {
        ...launchContext,
        status: externalInjectionEnabled
          ? launchContext.status
          : internalOnlyWithExternalIssue
            ? 'degraded'
            : 'available',
        reason: externalInjectionEnabled || internalOnlyWithExternalIssue
          ? launchContext.reason
          : 'internal repo-context MCP injected',
        injectionEnabled: true,
        launchDir,
        resolvedServers: mergedServers,
        configFilePath,
      };
    } catch (err) {
      if (options.internalMcpServer) {
        throw new Error(`internal MCP config render failed: ${getErrorMessage(err)}`);
      }
      launchLog.warn('external_mcp.config_render.failed', { error: getErrorMessage(err) });
      return {
        status: 'unavailable',
        reason: `external MCP config render failed: ${getErrorMessage(err)}`,
        injectionEnabled: false,
        envExports: {},
        resolvedServers: [],
        selectedServerIds: launchContext.selectedServerIds,
        excludedServerIds: launchContext.excludedServerIds,
      };
    }
  };

  // Read the local-MCP opt-in flag here, the single helper-env-assembly seam.
  // A failed/unreadable config is treated as disabled (fail-closed). Its own
  // try/catch keeps a config error from being misread as a helper failure.
  let localMcpEnabled = false;
  try {
    localMcpEnabled = (await getPlatformConfig(options.repoRoot)).external_mcp_local_enabled;
  } catch {
    localMcpEnabled = false;
  }

  let launchContext: ExternalMcpLaunchContext;
  try {
    launchContext = await prepareExternalMcpLaunchContext({
      agentId: options.agentId,
      repoRoot: options.repoRoot,
      taskId: options.taskId,
      // Pass the opt-in flag to the helper subprocess only; do not add it to
      // agentEnv so it never leaks into the launched agent's process env.
      env: {
        ...options.agentEnv,
        TASKSAIL_LOCAL_MCP_ENABLED: localMcpEnabled ? '1' : '',
      },
      abortSignal: options.abortSignal,
    });
  } catch (err) {
    if (!options.internalMcpServer) {
      launchLog.warn('external_mcp.launch_context.failed', { error: getErrorMessage(err) });
      return undefined;
    }
    helperFailureMessage = getErrorMessage(err);
    launchContext = {
      status: 'unavailable',
      reason: `external MCP launch context failed: ${helperFailureMessage}`,
      injectionEnabled: false,
      envExports: {},
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    };
  }

  if (launchContext.injectionEnabled) {
    const mergedLaunchContext = renderMergedConfig(launchContext, true);
    if (mergedLaunchContext.injectionEnabled) {
      Object.assign(options.agentEnv, launchContext.envExports);
    }
    return mergedLaunchContext;
  }
  if (helperFailureMessage !== undefined) {
    launchLog.warn('external_mcp.unavailable.internal_wired', { reason: helperFailureMessage });
  } else if (launchContext.status !== 'not-applicable') {
    launchLog.warn('external_mcp.launch_context.unavailable', { status: launchContext.status, reason: launchContext.reason });
  }
  return renderMergedConfig(launchContext, false);
}

function createInternalMcpLaunchDir(
  repoRoot: string,
  providerHomeDirName: string,
  agentId: string,
): string {
  const root = path.join(repoRoot, '.platform-state', 'runtime', providerHomeDirName);
  // SEC-TS-02: owner-only so other local users cannot traverse into per-launch
  // dirs that hold resolved MCP auth tokens. mkdir does not tighten an existing
  // dir, so chmod unconditionally (matches renderer.py) to correct a pre-existing
  // permissive root.
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  internalMcpLaunchCounter += 1;
  const token = `${agentId}-${Date.now()}-${process.pid}-${internalMcpLaunchCounter}`;
  return path.join(root, token);
}

export function summarizeExternalMcpLaunchContext(
  launchContext: PreparedAgentMcpLaunchContext | undefined,
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

export function logExternalMcpLaunchStatus(
  agentId: RunRoleAgentOptions['agentId'],
  launchStatus: AgentMcpLaunchStatus,
  context?: { taskId?: string; providerId?: string; spanId?: string },
): void {
  const childLog = log.child({
    agentId,
    taskId: context?.taskId,
    providerId: context?.providerId,
    spanId: context?.spanId,
  });
  const cleanStatus = launchStatus.status === 'available' || launchStatus.status === 'not-applicable';
  const logMethod = cleanStatus ? childLog.debug : childLog.warn;
  logMethod('external_mcp.launch_status', {
    status: launchStatus.status,
    injectionEnabled: launchStatus.injectionEnabled,
    selectedServerIds: launchStatus.selectedServerIds,
    excludedServerIds: launchStatus.excludedServerIds,
    reason: launchStatus.reason,
  });
}

/** Correct a session receipt to 'completed' after greedy-stop or denied-action recovery overrides exitCode to 0. */
export async function correctSessionReceipt(receiptFile: string | null, agentId: string): Promise<void> {
  if (!receiptFile) return;
  await writeSessionTerminalReceipt({
    receiptPath: receiptFile,
    agentId,
    terminalStatus: 'completed',
    exitCode: 0,
  }).catch(() => {});
}

export async function runAgentSession(options: {
  repoRoot: string;
  cliArgs: string[];
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
    taskRuntime: string;
    launchId: string;
    agentId: string;
    roleName: string;
    displayName: string;
    launchPhase?: string;
    retryOfLaunchId?: string;
    promptAudit?: {
      promptPath: string | null;
      promptSource: 'file' | 'override';
      inlineAgentContext: boolean;
      effectivePromptSha256: string;
    };
  };
  /** External MCP launch dir for this session. When present, a .provider-pid
   *  sentinel is written immediately after the provider child is spawned so
   *  cleanup_stale_launches can distinguish a live launch from a stale one. */
  launchDir?: string;
}): Promise<{
  runSummary: Awaited<ReturnType<typeof waitForAgentDetailed>>;
  greedyStopTriggered: boolean;
  sessionReceiptFile: string | null;
}> {
  const child = launchAgent(options.cliArgs, {
    repoRoot: options.repoRoot,
    cwd: options.cwd,
    env: options.env,
    wallClockTimeoutS: options.wallClockTimeoutS,
    idleTimeoutS: options.idleTimeoutS,
  });
  // Best-effort: write a .provider-pid sentinel so the Python cleanup helper
  // can identify live launch dirs by the long-running provider PID rather than
  // the short-lived helper PID embedded in the dir name.
  if (options.launchDir && child.pid !== undefined) {
    const sentinelPath = path.join(options.launchDir, '.provider-pid');
    // Best-effort, content-safe (pid only). Written atomically via temp + rename
    // so a concurrent cleanup never observes a partial/empty sentinel. Uses
    // node:fs directly (not the core-barrel writeTextFileAtomic) to avoid coupling
    // this advisory write to the partial core mocks in the agent-runner test suite.
    const tmpSentinel = `${sentinelPath}.tmp-${process.pid}`;
    try {
      writeFileSync(tmpSentinel, String(child.pid), { mode: 0o600 });
      renameSync(tmpSentinel, sentinelPath);
    } catch {
      // Best-effort: drop the temp file if the rename did not consume it.
      try { unlinkSync(tmpSentinel); } catch { /* ignore */ }
    }
  }
  const launchStartedAt = Date.now();
  const progressTaskId = options.env['TASKSAIL_TASK_ID'] || '';
  const progressIdentity = options.session && progressTaskId
    ? {
        providerId: getActiveProvider(options.repoRoot).id,
        agentId: options.session.agentId,
        taskId: progressTaskId,
        launchId: options.session.launchId,
        launchPhase: options.session.launchPhase ?? null,
        displayPhase: normalizeAgentLaunchPhase({
          agentId: options.session.agentId,
          launchPhase: options.session.launchPhase,
        }),
        modelId: options.env['RUN_ROLE_AGENT_ACTIVE_MODEL'] || 'unknown',
      }
    : undefined;

  // Write session start receipt for the runtime stream watcher.
  let sessionReceiptFile: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatStopped = false;
  let heartbeatInFlight: Promise<void> | undefined;
  const monitorStartedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const writeHeartbeat = (): void => {
    if (heartbeatStopped || !sessionReceiptFile || heartbeatInFlight) {
      return;
    }
    const heartbeat = writeSessionMonitorHeartbeat({
      receiptPath: sessionReceiptFile,
      monitorPid: process.pid,
      monitorStartedAt,
    })
      .catch(() => {})
      .finally(() => {
        if (heartbeatInFlight === heartbeat) {
          heartbeatInFlight = undefined;
        }
      });
    heartbeatInFlight = heartbeat;
  };
  const stopHeartbeat = async (): Promise<void> => {
    heartbeatStopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    if (heartbeatInFlight) {
      await heartbeatInFlight.catch(() => {});
    }
  };
  if (options.session) {
    try {
      sessionReceiptFile = await writeSessionStartReceipt({
        ...options.session,
        launchPid: child.pid ?? null,
      });
      writeHeartbeat();
      heartbeatTimer = setInterval(writeHeartbeat, 30_000);
    } catch {
      // Non-fatal — the terminal feed just won't show the start event.
    }
  }
  if (progressIdentity) {
    await emitTaskProgressEvent({
      logger: log.child({
        taskId: progressIdentity.taskId,
        agentId: progressIdentity.agentId,
        providerId: progressIdentity.providerId,
      }),
      repoRoot: options.repoRoot,
      taskId: progressIdentity.taskId,
      event: {
        type: 'agent.launch.started',
        input: {
          agentId: progressIdentity.agentId,
          providerId: progressIdentity.providerId,
          launchId: progressIdentity.launchId,
          launchPhase: progressIdentity.launchPhase,
          displayPhase: progressIdentity.displayPhase,
          displayName: formatTaskAgentDisplayName({
            agentId: progressIdentity.agentId,
            phase: progressIdentity.displayPhase,
          }),
          childPid: child.pid ?? null,
          modelId: progressIdentity.modelId,
        },
      },
    });
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

  let runSummary: Awaited<ReturnType<typeof waitForAgentDetailed>>;
  try {
    runSummary = await waitForAgentDetailed(child, {
      wallClockTimeoutMs: options.wallClockTimeoutS !== undefined
        ? options.wallClockTimeoutS * 1000
        : undefined,
      idleTimeoutMs: options.idleTimeoutS !== undefined
        ? options.idleTimeoutS * 1000
        : undefined,
      abortSignal: options.abortSignal,
    });
  } finally {
    if (greedyTimer) {
      clearInterval(greedyTimer);
    }
    await stopHeartbeat();
  }
  const durationMs = Date.now() - launchStartedAt;
  const terminalProjection = projectAgentSessionTerminal({ runSummary, greedyStopTriggered });
  if (progressIdentity) {
    await emitTaskProgressEvent({
      logger: log.child({
        taskId: progressIdentity.taskId,
        agentId: progressIdentity.agentId,
        providerId: progressIdentity.providerId,
      }),
      repoRoot: options.repoRoot,
      taskId: progressIdentity.taskId,
      event: {
        type: 'agent.launch.terminal',
        input: {
          agentId: progressIdentity.agentId,
          providerId: progressIdentity.providerId,
          launchId: progressIdentity.launchId,
          launchPhase: progressIdentity.launchPhase,
          displayPhase: progressIdentity.displayPhase,
          displayName: formatTaskAgentDisplayName({
            agentId: progressIdentity.agentId,
            phase: progressIdentity.displayPhase,
          }),
          childPid: child.pid ?? null,
          status: terminalProjection.progressStatus,
          outcome: terminalProjection.outcome,
          durationMs,
          exitCode: terminalProjection.exitCode,
        },
      },
    });
  }
  // Write session terminal receipt for the runtime stream watcher.
  if (sessionReceiptFile && options.session) {
    try {
      await writeSessionTerminalReceipt({
        receiptPath: sessionReceiptFile,
        agentId: options.session.agentId,
        terminalStatus: terminalProjection.terminalStatus,
        exitCode: terminalProjection.exitCode,
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

function deriveAgentRunStatus(
  result: Awaited<ReturnType<typeof waitForAgentDetailed>>,
): AgentRunStatus {
  if (
    result.terminationReason === 'wall-clock-timeout'
    || result.terminationReason === 'idle-timeout'
  ) {
    return 'timeout';
  }
  if (result.terminationReason === 'aborted') {
    return 'killed';
  }
  return result.exitCode === 0 ? 'success' : 'failure';
}

export function projectAgentSessionTerminal(input: {
  runSummary: Awaited<ReturnType<typeof waitForAgentDetailed>>;
  greedyStopTriggered: boolean;
}): AgentSessionTerminalProjection {
  if (input.greedyStopTriggered) {
    return {
      progressStatus: 'success',
      outcome: 'completed',
      terminalStatus: 'completed',
      exitCode: 0,
    };
  }
  const progressStatus = deriveAgentRunStatus(input.runSummary);
  return {
    progressStatus,
    outcome: normalizeTaskAgentLaunchOutcome({
      processStatus: progressStatus,
      exitCode: input.runSummary.exitCode,
    }),
    terminalStatus: input.runSummary.exitCode === 0 ? 'completed' : 'failed',
    exitCode: input.runSummary.exitCode,
  };
}
