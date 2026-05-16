import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger, getErrorMessage } from '../core/index.js';
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

const log = createLogger('platform/agent-runner/agentSession');

export type PreparedAgentMcpLaunchContext = ExternalMcpLaunchContext & {
  configFilePath?: string;
};

export type { ExternalMcpLaunchContext };

let internalMcpLaunchCounter = 0;

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

  let launchContext: ExternalMcpLaunchContext;
  try {
    launchContext = await prepareExternalMcpLaunchContext({
      agentId: options.agentId,
      repoRoot: options.repoRoot,
      taskId: options.taskId,
      env: options.agentEnv,
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
  mkdirSync(root, { recursive: true });
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
  log.child({
    agentId,
    taskId: context?.taskId,
    providerId: context?.providerId,
    spanId: context?.spanId,
  }).info('external_mcp.launch_status', {
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
  const launchStartedAt = Date.now();
  const progressTaskId = options.env['TASKSAIL_TASK_ID'] || '';
  const progressIdentity = options.session && progressTaskId
    ? {
        providerId: getActiveProvider(options.repoRoot).id,
        agentId: options.session.agentId,
        taskId: progressTaskId,
        launchId: options.session.launchId,
        modelId: options.env['RUN_ROLE_AGENT_ACTIVE_MODEL'] || 'unknown',
      }
    : undefined;

  if (progressIdentity) {
    log.child({
      taskId: progressIdentity.taskId,
      agentId: progressIdentity.agentId,
      providerId: progressIdentity.providerId,
    }).progress({
      level: 'info',
      event: 'agent.launch.started',
      extra: {
        child_pid: child.pid ?? null,
        launch_id: progressIdentity.launchId,
        model_id: progressIdentity.modelId,
      },
      text: `[agent] started ${progressIdentity.agentId}  pid=${child.pid ?? 'unknown'}  model=${progressIdentity.modelId}`,
    });
  }

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
  const status = deriveAgentRunStatus(runSummary);
  if (progressIdentity) {
    log.child({
      taskId: progressIdentity.taskId,
      agentId: progressIdentity.agentId,
      providerId: progressIdentity.providerId,
    }).progress({
      level: 'info',
      event: 'agent.launch.terminal',
      extra: {
        child_pid: child.pid ?? null,
        status,
        duration_ms: durationMs,
        exit_code: runSummary.exitCode,
      },
      text: `[agent] exited ${progressIdentity.agentId}  ${status}  in ${Math.round(durationMs / 1000)}s${status === 'success' ? ' [ok]' : status === 'failure' ? ' [fail]' : ''}`,
    });
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

function deriveAgentRunStatus(
  result: Awaited<ReturnType<typeof waitForAgentDetailed>>,
): 'success' | 'failure' | 'killed' | 'timeout' {
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
