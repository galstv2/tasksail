import { existsSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readTextFile, safeJsonParse, writeTextFile, ensureDir } from '../../core/index.js';

export interface PipelineKillRequest {
  requestedAt: string;
  reason: string;
}

/** @alias PipelineKillRequest — used by {@link getAllActiveKillSwitches}. */
export type KillSwitchRecord = PipelineKillRequest;

function killSwitchDir(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId);
}

export function pipelineKillSwitchPath(repoRoot: string, taskId: string): string {
  return path.join(killSwitchDir(repoRoot, taskId), 'pipeline-kill-switch.json');
}

export function pipelineKillSwitchExists(repoRoot: string, taskId: string): boolean {
  return existsSync(pipelineKillSwitchPath(repoRoot, taskId));
}

export async function readPipelineKillRequest(
  repoRoot: string,
  taskId: string,
): Promise<PipelineKillRequest | undefined> {
  const filePath = pipelineKillSwitchPath(repoRoot, taskId);
  const content = await readTextFile(filePath);
  if (!content) {
    return undefined;
  }
  return safeJsonParse<PipelineKillRequest>(content, filePath);
}

export async function requestPipelineKill(
  repoRoot: string,
  taskId: string,
  reason: string,
): Promise<void> {
  const filePath = pipelineKillSwitchPath(repoRoot, taskId);
  await ensureDir(path.dirname(filePath));
  await writeTextFile(
    filePath,
    JSON.stringify({
      requestedAt: new Date().toISOString(),
      reason,
    }, null, 2) + '\n',
  );
}

export async function clearPipelineKill(repoRoot: string, taskId: string): Promise<boolean> {
  const filePath = pipelineKillSwitchPath(repoRoot, taskId);
  if (!existsSync(filePath)) {
    return false;
  }
  await unlink(filePath);
  return true;
}

/**
 * Enumerate all active kill-switch files across tasks and return a Map
 * keyed by taskId. Used by pipeline supervisor recovery scans (Level 5/7).
 */
export async function getAllActiveKillSwitches(
  repoRoot: string,
): Promise<Map<string, KillSwitchRecord>> {
  const tasksDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks');
  const result = new Map<string, KillSwitchRecord>();

  let taskIds: string[];
  try {
    taskIds = await readdir(tasksDir);
  } catch {
    // tasksDir does not exist yet — no active kill switches.
    return result;
  }

  await Promise.all(
    taskIds.map(async (taskId) => {
      const filePath = path.join(tasksDir, taskId, 'pipeline-kill-switch.json');
      if (!existsSync(filePath)) {
        return;
      }
      const content = await readTextFile(filePath);
      if (!content) {
        return;
      }
      const record = safeJsonParse<KillSwitchRecord>(content, filePath);
      if (record) {
        result.set(taskId, record);
      }
    }),
  );

  return result;
}
