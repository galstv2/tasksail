import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dismissAllTaskNotifications,
  dismissTaskNotification,
  markTaskNotificationsSeen,
  readTaskNotificationSnapshot,
  recordTaskNotification,
  resolveTaskNotificationStorePath,
} from '../store.js';
import { flushLoggers } from '../../core/logger.js';
import type { TaskNotificationRecord } from '../types.js';

let logDir: string;
let previousLogDir: string | undefined;
let previousLogLevel: string | undefined;

describe('task notification store', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'task-notifications-'));
    logDir = mkdtempSync(path.join(tmpdir(), 'task-notifications-logs-'));
    previousLogDir = process.env.LOG_DIR;
    previousLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_DIR = logDir;
    process.env.LOG_LEVEL = 'debug';
    flushLoggers();
  });

  afterEach(() => {
    flushLoggers();
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    if (previousLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = previousLogDir;
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  it('reads an empty snapshot when no store exists', async () => {
    const snapshot = await readTaskNotificationSnapshot(repoRoot);

    expect(snapshot).toMatchObject({
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 0,
      notifications: [],
    });
    expect(existsSync(resolveTaskNotificationStorePath(repoRoot))).toBe(false);
  });

  it('creates the parent directory and writes the first notification atomically', async () => {
    const record = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1' }),
      now: dateMinute(1),
    });

    const storePath = resolveTaskNotificationStorePath(repoRoot);
    expect(record).toMatchObject({
      notificationId: sha256('task:task-1:completed'),
      dedupeKey: 'task:task-1:completed',
      createdAt: dateMinute(1).toISOString(),
      seenAt: null,
      dismissedAt: null,
    });
    expect(existsSync(storePath)).toBe(true);
    expect(readdirSync(path.dirname(storePath)).filter((entry) => entry.includes('.tmp-'))).toEqual([]);
  });

  it('serializes concurrent notification record mutations without losing records', async () => {
    await Promise.all([
      recordTaskNotification({
        repoRoot,
        record: recordInput({ taskId: 'task-1' }),
        now: dateMinute(1),
      }),
      recordTaskNotification({
        repoRoot,
        record: recordInput({ taskId: 'task-2' }),
        now: dateMinute(2),
      }),
    ]);

    const snapshot = await readTaskNotificationSnapshot(repoRoot);
    expect(snapshot.notifications.map((record) => record.taskId).sort()).toEqual(['task-1', 'task-2']);
  });

  it('excludes seen and dismissed records from unseenCount and the visible snapshot', async () => {
    const first = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1' }),
      now: dateMinute(1),
    });
    const second = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-2' }),
      now: dateMinute(2),
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // allVisible marks every visible record seen, so unseenCount drops to 0.
    const afterSeen = await markTaskNotificationsSeen({
      repoRoot,
      notificationIds: [first!.notificationId],
      allVisible: true,
      now: dateMinute(3),
    });
    expect(afterSeen.unseenCount).toBe(0);
    expect(afterSeen.notifications.every((record) => record.seenAt === dateMinute(3).toISOString())).toBe(true);

    // A dismissed record leaves the visible snapshot and is not counted as unseen.
    await dismissTaskNotification({
      repoRoot,
      notificationId: first!.notificationId,
      now: dateMinute(4),
    });
    const snapshot = await readTaskNotificationSnapshot(repoRoot);
    expect(snapshot.unseenCount).toBe(0);
    expect(snapshot.notifications.map((record) => record.notificationId)).toEqual([second!.notificationId]);
  });

  it('marks notifications seen without dismissing records', async () => {
    const first = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1' }),
      now: dateMinute(1),
    });
    const second = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-2' }),
      now: dateMinute(2),
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const snapshot = await markTaskNotificationsSeen({
      repoRoot,
      notificationIds: [first!.notificationId],
      now: dateMinute(3),
    });

    expect(snapshot.unseenCount).toBe(1);
    expect(snapshot.notifications).toHaveLength(2);
    expect(snapshot.notifications.find((record) => record.notificationId === first!.notificationId)).toMatchObject({
      seenAt: dateMinute(3).toISOString(),
      dismissedAt: null,
    });
  });

  it('dismiss removes a single notification from the visible snapshot, then dismissAll clears it', async () => {
    const first = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1' }),
      now: dateMinute(1),
    });
    const second = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-2' }),
      now: dateMinute(2),
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // Dismissing one notification removes it from the visible snapshot and persists dismissedAt.
    const afterOne = await dismissTaskNotification({
      repoRoot,
      notificationId: second!.notificationId,
      now: dateMinute(3),
    });
    expect(afterOne.notifications.map((record) => record.notificationId)).toEqual([first!.notificationId]);
    expect(readPersistedNotifications(repoRoot).find((record) => record.notificationId === second!.notificationId)).toMatchObject({
      dismissedAt: dateMinute(3).toISOString(),
    });

    // Dismissing all clears the visible snapshot, zeroes unseenCount, and persists dismissedAt on every record.
    const afterAll = await dismissAllTaskNotifications({
      repoRoot,
      now: dateMinute(4),
    });
    expect(afterAll.unseenCount).toBe(0);
    expect(afterAll.notifications).toEqual([]);
    expect(readPersistedNotifications(repoRoot).every((record) => record.dismissedAt !== null)).toBe(true);
  });

  it('quarantines malformed JSON and returns an empty snapshot', async () => {
    const storePath = resolveTaskNotificationStorePath(repoRoot);
    await mkdir(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, '{not-json', 'utf-8');

    const snapshot = await readTaskNotificationSnapshot(repoRoot);

    expect(snapshot.notifications).toEqual([]);
    expect(snapshot.unseenCount).toBe(0);
    expect(existsSync(storePath)).toBe(false);
    expect(readdirSync(path.dirname(storePath)).some((entry) => entry.startsWith('notifications.json.corrupt.'))).toBe(true);
  });

  it('returns null for duplicate dedupeKey without changing seen or dismissed state', async () => {
    const first = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1' }),
      now: dateMinute(1),
    });
    expect(first).not.toBeNull();
    await markTaskNotificationsSeen({
      repoRoot,
      notificationIds: [first!.notificationId],
      now: dateMinute(2),
    });

    const duplicate = await recordTaskNotification({
      repoRoot,
      record: recordInput({ taskId: 'task-1', taskTitle: 'Duplicate title' }),
      now: dateMinute(3),
    });

    const persisted = readPersistedNotifications(repoRoot);
    expect(duplicate).toBeNull();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      taskTitle: 'Task task-1',
      seenAt: dateMinute(2).toISOString(),
      dismissedAt: null,
    });
    expect(readLogRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'debug',
        msg: 'task_notifications.record.duplicate_ignored',
        extra: { taskId: 'task-1', notificationType: 'task-completed' },
      }),
    ]));
  });

  it('caps retention at 200 non-dismissed visible records and 500 total persisted records', async () => {
    for (let index = 0; index < 350; index += 1) {
      const record = await recordTaskNotification({
        repoRoot,
        record: recordInput({
          taskId: `dismissed-${index}`,
          type: 'task-failed',
          severity: 'error',
        }),
        now: dateMinute(index),
      });
      expect(record).not.toBeNull();
      await dismissTaskNotification({
        repoRoot,
        notificationId: record!.notificationId,
        now: dateMinute(400 + index),
      });
    }
    for (let index = 0; index < 210; index += 1) {
      await recordTaskNotification({
        repoRoot,
        record: recordInput({ taskId: `visible-${index}` }),
        now: dateMinute(800 + index),
      });
    }

    const snapshot = await readTaskNotificationSnapshot(repoRoot);
    const persisted = readPersistedNotifications(repoRoot);

    expect(snapshot.notifications).toHaveLength(200);
    expect(snapshot.notifications[0]).toMatchObject({ taskId: 'visible-209' });
    expect(snapshot.notifications.at(-1)).toMatchObject({ taskId: 'visible-10' });
    expect(persisted).toHaveLength(500);
    expect(persisted.filter((record) => record.dismissedAt === null)).toHaveLength(200);
    expect(persisted.filter((record) => record.dismissedAt !== null)).toHaveLength(300);
  }, 15_000);

  it('normalizes persisted records so sensitive fields are not exposed or rewritten', async () => {
    const storePath = resolveTaskNotificationStorePath(repoRoot);
    await mkdir(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      notifications: [
        {
          ...recordFixture({
            taskId: 'task-1',
            notificationId: sha256('task:task-1:completed'),
            dedupeKey: 'task:task-1:completed',
          }),
          stdout: 'secret stdout',
          stderr: 'secret stderr',
          prompt: 'secret prompt',
          rawError: 'secret raw error',
        },
      ],
    }), 'utf-8');

    const snapshot = await readTaskNotificationSnapshot(repoRoot);
    await markTaskNotificationsSeen({
      repoRoot,
      allVisible: true,
      now: dateMinute(2),
    });
    const raw = readFileSync(storePath, 'utf-8');

    expect(snapshot.notifications[0]).not.toHaveProperty('stdout');
    expect(snapshot.notifications[0]).not.toHaveProperty('stderr');
    expect(snapshot.notifications[0]).not.toHaveProperty('prompt');
    expect(snapshot.notifications[0]).not.toHaveProperty('rawError');
    expect(raw).not.toContain('secret stdout');
    expect(raw).not.toContain('secret stderr');
    expect(raw).not.toContain('secret prompt');
    expect(raw).not.toContain('secret raw error');
  });
});

function recordInput(overrides: Partial<Omit<TaskNotificationRecord, 'notificationId' | 'createdAt' | 'seenAt' | 'dismissedAt'>> = {}): Omit<TaskNotificationRecord, 'notificationId' | 'createdAt' | 'seenAt' | 'dismissedAt'> {
  const taskId = overrides.taskId ?? 'task-1';
  const type = overrides.type ?? 'task-completed';
  return {
    dedupeKey: overrides.dedupeKey ?? `task:${taskId}:${type === 'task-completed' ? 'completed' : 'failed'}`,
    type,
    severity: overrides.severity ?? (type === 'task-completed' ? 'success' : 'error'),
    taskId,
    taskGuid: overrides.taskGuid ?? `guid-${taskId}`,
    taskTitle: overrides.taskTitle ?? `Task ${taskId}`,
    taskFileName: overrides.taskFileName ?? `${taskId}.md`,
    contextPackId: overrides.contextPackId ?? 'pack-1',
    contextPackDir: overrides.contextPackDir ?? '/tmp/context-packs/pack-1',
    contextPackLabel: overrides.contextPackLabel ?? 'pack-1',
    archivePath: overrides.archivePath ?? (type === 'task-completed' ? `/tmp/archive/${taskId}.md` : null),
    errorItemPath: overrides.errorItemPath ?? (type === 'task-failed' ? `/tmp/error-items/${taskId}.md` : null),
    message: overrides.message ?? `${taskId} notification`,
  };
}

function readLogRecords(): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      records.push(...readFileSync(entryPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>));
    }
  };
  visit(logDir);
  return records;
}

function recordFixture(overrides: Partial<TaskNotificationRecord> = {}): TaskNotificationRecord {
  const input = recordInput(overrides);
  return {
    ...input,
    notificationId: overrides.notificationId ?? sha256(input.dedupeKey),
    createdAt: overrides.createdAt ?? dateMinute(1).toISOString(),
    seenAt: overrides.seenAt ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
  };
}

function readPersistedNotifications(root: string): TaskNotificationRecord[] {
  return JSON.parse(readFileSync(resolveTaskNotificationStorePath(root), 'utf-8')).notifications;
}

function dateMinute(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, minute));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
