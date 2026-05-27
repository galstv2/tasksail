import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  recordTaskCompletedNotification,
  recordTaskFailedNotification,
  subscribeTaskNotificationCreated,
  type TaskNotificationCreatedEvent,
} from '../producer.js';
import { readTaskNotificationSnapshot } from '../store.js';

describe('task notification producer', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'task-notification-producer-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('records task-completed with registry metadata and archivePath', async () => {
    seedRegistry(repoRoot, {
      completed: [{
        taskId: 'task-complete',
        taskGuid: '11111111-1111-4111-8111-111111111111',
        fileName: 'task-complete.md',
        title: 'Complete the rollout',
        state: 'completed',
        contextPackId: 'pack-alpha',
        contextPackDir: '/context-packs/alpha',
        scopeMode: null,
        selectedRepoIds: [],
        selectedFocusIds: [],
        createdAt: null,
        completedAt: '2026-05-25T12:00:00.000Z',
        archivePath: '/archives/task-complete.md',
      }],
    });
    const events: TaskNotificationCreatedEvent[] = [];
    const unsubscribe = subscribeTaskNotificationCreated((event) => events.push(event));

    const record = await recordTaskCompletedNotification({
      repoRoot,
      taskId: 'task-complete',
      archivePath: '/archives/task-complete.md',
      now: new Date('2026-05-25T12:01:00.000Z'),
    });
    unsubscribe();

    expect(record).toMatchObject({
      notificationId: sha256('task:task-complete:completed'),
      dedupeKey: 'task:task-complete:completed',
      type: 'task-completed',
      severity: 'success',
      taskId: 'task-complete',
      taskGuid: '11111111-1111-4111-8111-111111111111',
      taskTitle: 'Complete the rollout',
      taskFileName: 'task-complete.md',
      contextPackId: 'pack-alpha',
      contextPackDir: '/context-packs/alpha',
      contextPackLabel: 'pack-alpha',
      archivePath: '/archives/task-complete.md',
      errorItemPath: null,
      createdAt: '2026-05-25T12:01:00.000Z',
      seenAt: null,
      dismissedAt: null,
    });
    expect(events).toEqual([{ type: 'created', record }]);
  });

  it('records task-failed with registry metadata and errorItemPath', async () => {
    seedRegistry(repoRoot, {
      failed: [{
        taskId: 'task-failed',
        taskGuid: '22222222-2222-4222-8222-222222222222',
        fileName: 'task-failed.md',
        title: 'Fix the importer',
        state: 'failed',
        contextPackId: null,
        contextPackDir: '/context-packs/imports',
        scopeMode: null,
        selectedRepoIds: [],
        selectedFocusIds: [],
        createdAt: null,
        completedAt: null,
        archivePath: null,
      }],
    });

    const record = await recordTaskFailedNotification({
      repoRoot,
      taskId: 'task-failed',
      errorItemPath: '/repo/AgentWorkSpace/error-items/task-failed.md',
      now: new Date('2026-05-25T12:02:00.000Z'),
    });

    expect(record).toMatchObject({
      notificationId: sha256('task:task-failed:failed'),
      dedupeKey: 'task:task-failed:failed',
      type: 'task-failed',
      severity: 'error',
      taskId: 'task-failed',
      taskGuid: '22222222-2222-4222-8222-222222222222',
      taskTitle: 'Fix the importer',
      taskFileName: 'task-failed.md',
      contextPackId: null,
      contextPackDir: '/context-packs/imports',
      contextPackLabel: 'imports',
      archivePath: null,
      errorItemPath: '/repo/AgentWorkSpace/error-items/task-failed.md',
    });
  });

  it('falls back to taskId-only metadata when registry metadata is absent', async () => {
    const record = await recordTaskCompletedNotification({
      repoRoot,
      taskId: 'missing-task',
      now: new Date('2026-05-25T12:03:00.000Z'),
    });

    expect(record).toMatchObject({
      taskId: 'missing-task',
      taskGuid: null,
      taskTitle: null,
      taskFileName: null,
      contextPackId: null,
      contextPackDir: null,
      contextPackLabel: null,
      archivePath: null,
      errorItemPath: null,
      message: 'Task missing-task completed.',
    });
  });

  it('does not emit a created event for duplicate notifications', async () => {
    const events: TaskNotificationCreatedEvent[] = [];
    const unsubscribe = subscribeTaskNotificationCreated((event) => events.push(event));

    const completed = await recordTaskCompletedNotification({
      repoRoot,
      taskId: 'dupe-completed-task',
      now: new Date('2026-05-25T12:03:30.000Z'),
    });
    const duplicateCompleted = await recordTaskCompletedNotification({
      repoRoot,
      taskId: 'dupe-completed-task',
      now: new Date('2026-05-25T12:03:45.000Z'),
    });
    const first = await recordTaskFailedNotification({
      repoRoot,
      taskId: 'dupe-task',
      now: new Date('2026-05-25T12:04:00.000Z'),
    });
    const second = await recordTaskFailedNotification({
      repoRoot,
      taskId: 'dupe-task',
      now: new Date('2026-05-25T12:05:00.000Z'),
    });
    unsubscribe();

    const snapshot = await readTaskNotificationSnapshot(repoRoot);
    expect(completed).not.toBeNull();
    expect(duplicateCompleted).toBeNull();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(events).toEqual([{ type: 'created', record: completed }, { type: 'created', record: first }]);
    expect(snapshot.notifications).toHaveLength(2);
  });
});

function seedRegistry(
  repoRoot: string,
  setPatch: Partial<Record<'open' | 'pending' | 'active' | 'failed' | 'completed', unknown[]>>,
): void {
  const registryDir = path.join(repoRoot, '.platform-state');
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    path.join(registryDir, 'task-registry.json'),
    JSON.stringify({
      schema_version: 2,
      tasks: {
        test: {
          open: setPatch.open ?? [],
          pending: setPatch.pending ?? [],
          active: setPatch.active ?? [],
          failed: setPatch.failed ?? [],
          completed: setPatch.completed ?? [],
        },
      },
    }, null, 2) + '\n',
    'utf-8',
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
