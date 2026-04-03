import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { readTextFile, safeJsonParse, writeTextFile } from '../../core/index.js';

export interface PipelineKillRequest {
  requestedAt: string;
  reason: string;
}

export function pipelineKillSwitchPath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'pipeline-kill-switch.json');
}

export function pipelineKillSwitchExists(repoRoot: string): boolean {
  return existsSync(pipelineKillSwitchPath(repoRoot));
}

export async function readPipelineKillRequest(
  repoRoot: string,
): Promise<PipelineKillRequest | undefined> {
  const filePath = pipelineKillSwitchPath(repoRoot);
  const content = await readTextFile(filePath);
  if (!content) {
    return undefined;
  }
  return safeJsonParse<PipelineKillRequest>(content, filePath);
}

export async function requestPipelineKill(
  repoRoot: string,
  reason: string,
): Promise<void> {
  await writeTextFile(
    pipelineKillSwitchPath(repoRoot),
    JSON.stringify({
      requestedAt: new Date().toISOString(),
      reason,
    }, null, 2) + '\n',
  );
}

export async function clearPipelineKill(repoRoot: string): Promise<boolean> {
  const filePath = pipelineKillSwitchPath(repoRoot);
  if (!existsSync(filePath)) {
    return false;
  }
  await unlink(filePath);
  return true;
}
