import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { getErrorMessage } from '../core/index.js';
import type { RunRoleAgentOptions, AgentMcpLaunchStatus } from './types.js';
import { launchAgent, waitForAgentDetailed } from './processLifecycle.js';
import {
  captureCodeDiff,
  prepareExternalMcpLaunchContext,
  type ExternalMcpLaunchContext,
} from './pythonHelpers.js';
import { writeSessionStartReceipt, writeSessionTerminalReceipt } from './sessionReceipts.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { ResolvedMcpServer } from '../cli-provider/index.js';

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
  agentEnv: Record<string, string>;
  internalMcpServer?: ResolvedMcpServer;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext | undefined> {
  const provider = getActiveProvider(options.repoRoot);
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
      const preservesFailureReason = !externalInjectionEnabled && helperFailureMessage !== undefined;
      return {
        ...launchContext,
        status: externalInjectionEnabled ? launchContext.status : 'available',
        reason: externalInjectionEnabled || preservesFailureReason
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
      console.warn(
        '[roleAgent] external MCP config render failed, continuing without MCP:',
        getErrorMessage(err),
      );
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
      console.warn(
        '[roleAgent] external MCP launch context failed, continuing without MCP:',
        getErrorMessage(err),
      );
      return undefined;
    }
    helperFailureMessage = getErrorMessage(err);
    launchContext = {
      status: 'available',
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
    console.warn(
      '[roleAgent] external MCP unavailable, internal MCP wired up:',
      helperFailureMessage,
    );
  } else if (launchContext.status !== 'not-applicable') {
    console.warn(
      '[roleAgent] external MCP launch context unavailable, continuing without MCP:',
      `${launchContext.status}: ${launchContext.reason}`,
    );
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

  const runSummary = await waitForAgentDetailed(child, {
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
