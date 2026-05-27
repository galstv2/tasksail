import { describe, expect, it } from 'vitest';

import type {
  TaskNotificationRecord,
  TaskNotificationSnapshot,
} from './desktopContractTaskNotifications';
import {
  isTaskNotificationEvent,
  isTaskNotificationRecord,
  isTaskNotificationSnapshot,
} from './desktopContractTypeGuards';

type BackendTaskNotificationSnapshotShape = {
  action: 'taskNotifications.read';
  mode: 'read-only';
  unseenCount: number;
  notifications: TaskNotificationRecord[];
  generatedAt: string;
  message: string;
};

describe('desktopContractTaskNotifications', () => {
  it('keeps frontend notification snapshots structurally compatible with backend snapshots', () => {
    const backendSnapshot = {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 1,
      notifications: [notificationRecord()],
      generatedAt: '2026-05-25T10:05:00.000Z',
      message: 'Loaded task notifications.',
    } satisfies BackendTaskNotificationSnapshotShape;

    const frontendSnapshot: TaskNotificationSnapshot = backendSnapshot;
    expect(isTaskNotificationSnapshot(frontendSnapshot)).toBe(true);
  });

  it('keeps backend snapshots structurally compatible with frontend snapshots', () => {
    const frontendSnapshot = {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 0,
      notifications: [],
      generatedAt: '2026-05-25T10:06:00.000Z',
      message: 'Loaded task notifications.',
    } satisfies TaskNotificationSnapshot;

    const backendSnapshot: BackendTaskNotificationSnapshotShape = frontendSnapshot;
    expect(backendSnapshot).toBe(frontendSnapshot);
  });

  it('accepts valid notification records and snapshot events', () => {
    const snapshot: TaskNotificationSnapshot = {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 1,
      notifications: [notificationRecord()],
      generatedAt: '2026-05-25T10:05:00.000Z',
      message: 'Loaded task notifications.',
    };

    expect(isTaskNotificationRecord(snapshot.notifications[0])).toBe(true);
    expect(isTaskNotificationEvent({ type: 'snapshot', snapshot })).toBe(true);
  });

  it('rejects malformed notification record literals', () => {
    expect(isTaskNotificationRecord({
      ...notificationRecord(),
      type: 'task-started',
    })).toBe(false);
    expect(isTaskNotificationRecord({
      ...notificationRecord(),
      severity: 'warning',
    })).toBe(false);
    expect(isTaskNotificationRecord({
      ...notificationRecord(),
      createdAt: '',
    })).toBe(false);
  });
});

function notificationRecord(
  overrides: Partial<TaskNotificationRecord> = {},
): TaskNotificationRecord {
  return {
    notificationId: 'f'.repeat(64),
    dedupeKey: 'task:TASK-001:completed',
    type: 'task-completed',
    severity: 'success',
    taskId: 'TASK-001',
    taskGuid: 'task-guid-1',
    taskTitle: 'Ship notification center',
    taskFileName: 'TASK-001.md',
    contextPackId: 'platform',
    contextPackDir: '/tmp/context-packs/platform',
    contextPackLabel: 'platform',
    archivePath: '/tmp/archive/TASK-001.md',
    errorItemPath: null,
    createdAt: '2026-05-25T10:00:00.000Z',
    seenAt: null,
    dismissedAt: null,
    message: 'Task completed.',
    ...overrides,
  };
}
