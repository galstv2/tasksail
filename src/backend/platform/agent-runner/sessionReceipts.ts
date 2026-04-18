import path from 'node:path';
import { writeTextFile } from '../core/index.js';
import { readTextFile } from '../core/io.js';

const MAX_SESSION_HISTORY = 20;

type PromptAuditMetadata = {
  promptPath: string | null;
  promptSource: 'file' | 'override';
  inlineAgentContext: boolean;
  effectivePromptSha256: string;
};

/**
 * Build the per-launch receipt path.
 *
 * Path: <taskRuntime>/role-sessions/<agentId>-<launchId>.json
 *
 * `launchId` is `${epochMs}-${pid}` — caller-supplied, derived at runRoleAgent
 * invocation time. The pair is collision-resistant within any single host
 * process lifetime.
 *
 * Fleet-mode note (§4.12): multiple concurrent sub-Daltons share the same
 * agentId ('dalton'). Without a per-launch suffix, the second sub-Dalton's
 * writeSessionStartReceipt would overwrite the first's. §5.2's recoverOnStartup
 * pid scan enumerates ALL `${agentId}-${launchId}.json` files per task and
 * treats the task as live if ANY pid is still alive.
 */
function sessionReceiptPath(taskRuntime: string, agentId: string, launchId: string): string {
  return path.join(taskRuntime, 'role-sessions', `${agentId}-${launchId}.json`);
}

/**
 * Write a session start receipt so the runtime stream watcher can detect
 * the agent launch and emit a "started" event to the terminal feed.
 */
export async function writeSessionStartReceipt(options: {
  taskRuntime: string;
  launchId: string;
  agentId: string;
  roleName: string;
  displayName: string;
  launchPid: number | null;
  promptAudit?: PromptAuditMetadata;
  /** Optional launch phase label (e.g. "Verification") shown in the terminal UI. */
  launchPhase?: string;
}): Promise<string> {
  const receiptPath = sessionReceiptPath(options.taskRuntime, options.agentId, options.launchId);

  // Preserve previous session in history so the frontend watcher can observe
  // the completed/failed state even after this file is overwritten.
  let sessionHistory: Record<string, unknown>[] = [];
  try {
    const existing = await readTextFile(receiptPath);
    if (existing) {
      const prev = JSON.parse(existing) as Record<string, unknown>;
      const prevHistory = Array.isArray(prev.session_history) ? prev.session_history as Record<string, unknown>[] : [];
      const { session_history: _, ...prevSession } = prev;
      sessionHistory = [...prevHistory, prevSession].slice(-MAX_SESSION_HISTORY);
    }
  } catch {
    // No usable previous receipt — start with empty history.
  }

  const receipt = {
    agent_id: options.agentId,
    launch_id: options.launchId,
    role_name: options.roleName,
    session_kind: 'task-role',
    ...(options.launchPhase != null ? { launch_phase: options.launchPhase } : {}),
    launch: {
      status: 'started',
      started_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      pid: options.launchPid,
      invoked_by: 'src/backend/platform/agent-runner/roleAgent.ts',
      prompt_audit: options.promptAudit
        ? {
          prompt_path: options.promptAudit.promptPath,
          prompt_source: options.promptAudit.promptSource,
          inline_agent_context: options.promptAudit.inlineAgentContext,
          effective_prompt_sha256: options.promptAudit.effectivePromptSha256,
        }
        : undefined,
    },
    latest_output_lines: [`Started ${options.displayName} runtime.`],
    session_history: sessionHistory,
  };
  await writeTextFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return receiptPath;
}

/**
 * Update an existing session receipt with terminal status so the runtime
 * stream watcher can detect the agent exit and emit a "completed"/"failed" event.
 */
export async function writeSessionTerminalReceipt(options: {
  receiptPath: string;
  agentId: string;
  terminalStatus: 'completed' | 'failed';
  exitCode: number;
}): Promise<void> {
  const existing = await readTextFile(options.receiptPath);
  if (!existing) return;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    return;
  }

  payload.terminal = {
    status: options.terminalStatus,
    completed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    exit_code: options.exitCode,
    updated_by: 'src/backend/platform/agent-runner/roleAgent.ts',
  };
  payload.latest_output_lines = [
    `${(payload.role_name as string) ?? options.agentId} exited ${options.terminalStatus} (exit_code=${options.exitCode}).`,
  ];
  await writeTextFile(options.receiptPath, JSON.stringify(payload, null, 2) + '\n');
}
