import path from 'node:path';
import { getErrorMessage } from '../core/index.js';
import type { RunRoleAgentOptions, AgentMcpLaunchStatus } from './types.js';
import { launchCopilot, waitForCopilotDetailed } from './processLifecycle.js';
import {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
  type ExternalMcpLaunchContext,
} from './pythonHelpers.js';
import { writeSessionStartReceipt, writeSessionTerminalReceipt } from './sessionReceipts.js';

export type { ExternalMcpLaunchContext };

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
    console.warn(
      `[roleAgent] failed to generate QA code diff at ${outputPath}; continuing without refreshed diff:`,
      result.stderr || result.stdout || 'unknown error',
    );
    return;
  }
}

export async function mergeExternalMcpLaunchEnvironment(options: {
  agentId: RunRoleAgentOptions['agentId'];
  repoRoot: string;
  taskId: string;
  agentEnv: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext | undefined> {
  try {
    const launchContext = await prepareExternalMcpLaunchContext({
      agentId: options.agentId,
      repoRoot: options.repoRoot,
      taskId: options.taskId,
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

export function summarizeExternalMcpLaunchContext(
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

export function logExternalMcpLaunchStatus(
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

export async function runCopilotSession(options: {
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
    taskRuntime: string;
    launchId: string;
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
