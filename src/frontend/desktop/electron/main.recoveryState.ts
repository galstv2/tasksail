import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TaskRecoveryKind, TaskRecoveryState, TaskRecoveryStatus } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { pathExists, repoFs, stringOrNull, type ReadOnlyRepoFs } from './utils';

export const DESKTOP_RECOVERY_STATE_PATH = join(
  REPO_ROOT,
  '.platform-state',
  'runtime',
  'desktop-recovery-state.json',
);

type RecoveryStateFilePayload = {
  schemaVersion: 1;
  state: TaskRecoveryState;
};

function isRecoveryKind(value: unknown): value is TaskRecoveryKind {
  return value === 'activation-timeout'
    || value === 'runtime-failure'
    || value === 'queue-repair'
    || value === 'queue-divergence';
}

function isRecoveryStatus(value: unknown): value is TaskRecoveryStatus {
  return value === 'pending-start'
    || value === 'recovery-needed'
    || value === 'repaired'
    || value === 'auto-failed';
}

function parseRecoveryState(value: unknown): TaskRecoveryState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isRecoveryKind(candidate.kind) || !isRecoveryStatus(candidate.status)) {
    return null;
  }

  const summary = stringOrNull(candidate.summary);
  const detectedAt = stringOrNull(candidate.detectedAt);
  const updatedAt = stringOrNull(candidate.updatedAt);
  if (!summary || !detectedAt || !updatedAt) {
    return null;
  }

  return {
    kind: candidate.kind,
    status: candidate.status,
    summary,
    queueName: stringOrNull(candidate.queueName),
    taskId: stringOrNull(candidate.taskId),
    activationStartedAt: stringOrNull(candidate.activationStartedAt),
    deadlineAt: stringOrNull(candidate.deadlineAt),
    detectedAt,
    updatedAt,
    errorItemPath: stringOrNull(candidate.errorItemPath),
  };
}

export async function readTaskRecoveryState(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<TaskRecoveryState | null> {
  if (!(await pathExists(DESKTOP_RECOVERY_STATE_PATH, fsAdapter))) {
    return null;
  }

  try {
    const raw = await fsAdapter.readFile(DESKTOP_RECOVERY_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as RecoveryStateFilePayload)
        : null;
    return parseRecoveryState(payload?.state);
  } catch {
    return null;
  }
}

export async function writeTaskRecoveryState(
  state: TaskRecoveryState,
): Promise<void> {
  await mkdir(join(REPO_ROOT, '.platform-state', 'runtime'), { recursive: true });
  await writeFile(
    DESKTOP_RECOVERY_STATE_PATH,
    JSON.stringify({ schemaVersion: 1, state }, null, 2) + '\n',
    'utf-8',
  );
}

export async function clearTaskRecoveryState(): Promise<void> {
  await rm(DESKTOP_RECOVERY_STATE_PATH, { force: true });
}
