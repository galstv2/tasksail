import path from 'node:path';
import { readTextFile, safeJsonParse, writeTextFile } from '../core/index.js';
import { setLabelValue } from './artifacts.js';

const TASK_COUNTER_DIR_RELATIVE = '.platform-state/task-counters';
const DEFAULT_CONTEXT_PACK_ID = 'platform-core';
const RETROSPECTIVE_CYCLE_LENGTH = 10;

function contextPackIdFromDir(contextPackDir?: string): string {
  const trimmed = contextPackDir?.trim();
  if (!trimmed) {
    return DEFAULT_CONTEXT_PACK_ID;
  }
  return path.basename(trimmed);
}

export function isRetrospectiveRequiredForCompletedCount(completedCount: number): boolean {
  return (completedCount + 1) % RETROSPECTIVE_CYCLE_LENGTH === 0;
}

export async function getRetrospectiveRequiredForNextTask(options: {
  repoRoot: string;
  contextPackDir?: string;
}): Promise<boolean> {
  const contextPackId = contextPackIdFromDir(options.contextPackDir);
  const counterPath = path.join(
    options.repoRoot,
    TASK_COUNTER_DIR_RELATIVE,
    `${contextPackId}.json`,
  );
  const raw = await readTextFile(counterPath);
  if (!raw) {
    return false;
  }
  try {
    const payload = safeJsonParse<Record<string, unknown>>(raw, counterPath);
    const completedCount = typeof payload.completed_count === 'number'
      ? payload.completed_count
      : 0;
    return isRetrospectiveRequiredForCompletedCount(completedCount);
  } catch {
    return false;
  }
}

export async function syncRetrospectiveRequiredMetadata(options: {
  repoRoot: string;
  handoffsDir: string;
  contextPackDir?: string;
}): Promise<void> {
  const retrospectivePath = path.join(options.handoffsDir, 'retrospective-input.md');
  const content = await readTextFile(retrospectivePath);
  if (content === undefined) {
    return;
  }
  const required = await getRetrospectiveRequiredForNextTask({
    repoRoot: options.repoRoot,
    contextPackDir: options.contextPackDir,
  });
  const updated = setLabelValue(
    content,
    'Retrospective Required',
    required ? 'true' : 'false',
  );
  if (updated !== content) {
    await writeTextFile(retrospectivePath, updated);
  }
}
