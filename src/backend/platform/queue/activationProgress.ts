import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';

import { createLogger, getErrorMessage, writeTextFileAtomic } from '../core/index.js';
import { assertValidTaskId, type QueuePaths } from './paths.js';

const log = createLogger('platform/queue/activationProgress');

export const ACTIVATION_PROGRESS_PHASES = [
  'claimed',
  'validating',
  'preparing-worktree',
  'materializing-worktree',
  'initializing-task',
  'starting-pipeline',
] as const;

export type ActivationProgressPhase = typeof ACTIVATION_PROGRESS_PHASES[number];

export interface ActivationProgressRecord {
  schemaVersion: 1;
  taskId: string;
  queueName: string;
  title: string | null;
  phase: ActivationProgressPhase;
  startedAt: string;
  updatedAt: string;
  repoLabel?: string;
  originalRoot?: string;
  branch?: string;
  worktreeRoot?: string;
}

const phaseSet = new Set<string>(ACTIVATION_PROGRESS_PHASES);

function isValidTaskId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    assertValidTaskId(value);
    return true;
  } catch {
    return false;
  }
}

function markerPath(paths: QueuePaths, taskId: string): string {
  assertValidTaskId(taskId);
  return path.join(paths.activatingItemsDir, `${taskId}.json`);
}

function safeMarkerFileName(value: string): string | null {
  if (!value.endsWith('.json') || value.startsWith('.')) return null;
  const stem = value.slice(0, -'.json'.length);
  return isValidTaskId(stem) ? value : null;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseRecord(value: unknown): ActivationProgressRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  if (!isValidTaskId(record.taskId)) return null;
  if (typeof record.queueName !== 'string' || record.queueName.trim() === '' || hasPathSeparator(record.queueName)) return null;
  if (!(typeof record.title === 'string' || record.title === null)) return null;
  if (typeof record.phase !== 'string' || !phaseSet.has(record.phase)) return null;
  if (typeof record.startedAt !== 'string' || record.startedAt.trim() === '') return null;
  if (typeof record.updatedAt !== 'string' || record.updatedAt.trim() === '') return null;
  if (!isOptionalString(record.repoLabel)) return null;
  if (!isOptionalString(record.originalRoot)) return null;
  if (!isOptionalString(record.branch)) return null;
  if (!isOptionalString(record.worktreeRoot)) return null;

  return {
    schemaVersion: 1,
    taskId: record.taskId,
    queueName: record.queueName,
    title: record.title,
    phase: record.phase as ActivationProgressPhase,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(record.repoLabel !== undefined ? { repoLabel: record.repoLabel } : {}),
    ...(record.originalRoot !== undefined ? { originalRoot: record.originalRoot } : {}),
    ...(record.branch !== undefined ? { branch: record.branch } : {}),
    ...(record.worktreeRoot !== undefined ? { worktreeRoot: record.worktreeRoot } : {}),
  };
}

async function readMarker(paths: QueuePaths, fileName: string): Promise<ActivationProgressRecord | null> {
  if (!safeMarkerFileName(fileName)) return null;
  const fullPath = path.join(paths.activatingItemsDir, fileName);
  try {
    const raw = await readFile(fullPath, 'utf-8');
    const record = parseRecord(JSON.parse(raw));
    if (record && `${record.taskId}.json` !== fileName) {
      log.warn('activation_progress.marker.identity_mismatch', {
        marker: fileName,
        recordedTaskId: record.taskId,
      });
      return null;
    }
    return record;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('activation_progress.marker.read_ignored', {
        marker: fileName,
        error: getErrorMessage(err),
      });
    }
    return null;
  }
}

export async function writeActivationProgress(
  paths: QueuePaths,
  input: Omit<ActivationProgressRecord, 'schemaVersion' | 'updatedAt'> & {
    updatedAt?: string;
  },
): Promise<ActivationProgressRecord> {
  const now = input.updatedAt ?? new Date().toISOString();
  const record: ActivationProgressRecord = {
    schemaVersion: 1,
    taskId: input.taskId,
    queueName: input.queueName,
    title: input.title,
    phase: input.phase,
    startedAt: input.startedAt,
    updatedAt: now,
    ...(input.repoLabel !== undefined ? { repoLabel: input.repoLabel } : {}),
    ...(input.originalRoot !== undefined ? { originalRoot: input.originalRoot } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.worktreeRoot !== undefined ? { worktreeRoot: input.worktreeRoot } : {}),
  };
  const validated = parseRecord(record);
  if (!validated) {
    throw new Error(`invalid activation progress record for task "${input.taskId}"`);
  }

  await writeTextFileAtomic(
    markerPath(paths, input.taskId),
    JSON.stringify(validated, null, 2) + '\n',
  );
  return validated;
}

export async function listActivationProgressMarkerFileNames(paths: QueuePaths): Promise<string[]> {
  try {
    return (await readdir(paths.activatingItemsDir))
      .filter((entry) => safeMarkerFileName(entry) !== null)
      .sort();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('activation_progress.dir.read_failed', { error: getErrorMessage(err) });
    }
    return [];
  }
}

export async function readActivationProgressRecords(
  paths: QueuePaths,
): Promise<ActivationProgressRecord[]> {
  const entries = await listActivationProgressMarkerFileNames(paths);
  const records = await Promise.all(entries.map((entry) => readMarker(paths, entry)));
  return records.filter((record): record is ActivationProgressRecord => record !== null);
}

export async function readActivationProgressRecord(
  paths: QueuePaths,
  taskId: string,
): Promise<ActivationProgressRecord | null> {
  return readMarker(paths, `${taskId}.json`);
}

export async function clearActivationProgress(
  paths: QueuePaths,
  taskId: string,
): Promise<void> {
  await rm(markerPath(paths, taskId), { force: true });
}

export async function sweepActivationProgressMarkers(args: {
  paths: QueuePaths;
  repoRoot: string;
  reason: 'startup-recovery' | 'repair-auto-fix';
}): Promise<{ removed: string[]; ignoredMalformed: string[] }> {
  const entries = await listActivationProgressMarkerFileNames(args.paths);

  const removed: string[] = [];
  const ignoredMalformed: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(args.paths.activatingItemsDir, entry);
    const record = await readMarker(args.paths, entry);
    if (!record) ignoredMalformed.push(entry);
    try {
      await rm(fullPath, { force: true });
      removed.push(record?.taskId ?? entry);
      log.info('activation_progress.marker.swept', {
        reason: args.reason,
        taskId: record?.taskId,
        marker: entry,
      });
    } catch (err: unknown) {
      if (existsSync(fullPath)) {
        log.warn('activation_progress.marker.sweep_failed', {
          reason: args.reason,
          taskId: record?.taskId,
          marker: entry,
          error: getErrorMessage(err),
        });
      }
    }
  }

  return { removed, ignoredMalformed };
}
