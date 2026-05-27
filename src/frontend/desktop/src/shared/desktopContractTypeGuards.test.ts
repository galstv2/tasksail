import { describe, expect, it } from 'vitest';

import {
  isContextPackListResponse,
  isContextPackSwitchResponse,
  isContextPackReseedResponse,
  isPickDirectoryResponse,
  isDiscoverPrefillResponse,
  isCreateResponse,
  isAgentConfigLoadCapabilitiesResponse,
  isTaskBoardReadBoardResponse,
  isTaskBoardKillTaskResponse,
  isTaskBoardRetryKillCleanupResponse,
  isTaskNotificationEvent,
  isTaskNotificationMutationResponse,
  isTaskNotificationRecord,
  isTaskNotificationSnapshot,
} from './desktopContractTypeGuards';
import type { TaskNotificationRecord } from './desktopContractTaskNotifications';

describe('isContextPackListResponse', () => {
  it('returns true for a list response', () => {
    expect(isContextPackListResponse({ action: 'contextPack.list' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isContextPackListResponse({ action: 'contextPack.create' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContextPackListResponse(null)).toBe(false);
  });

  it('returns false for a non-object', () => {
    expect(isContextPackListResponse('contextPack.list')).toBe(false);
  });
});

describe('isAgentConfigLoadCapabilitiesResponse', () => {
  it('accepts valid capability responses and rejects malformed shapes', () => {
    expect(isAgentConfigLoadCapabilitiesResponse({
      action: 'agentConfig.loadCapabilities',
      mode: 'read-only',
      message: 'Loaded 2 reasoning effort option(s).',
      providerId: 'copilot',
      cliVersion: 'GitHub Copilot CLI 1.0.54',
      effortChoices: ['low', 'high'],
      stale: false,
    })).toBe(true);
    expect(isAgentConfigLoadCapabilitiesResponse({
      action: 'agentConfig.loadCapabilities',
      mode: 'read-only',
      message: 'Loaded.',
      providerId: 'copilot',
      cliVersion: null,
      effortChoices: 'high',
      stale: false,
    })).toBe(false);
  });
});

describe('isContextPackSwitchResponse', () => {
  it('returns true for previewSwitch action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.previewSwitch' })).toBe(true);
  });

  it('returns true for applySwitch action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.applySwitch' })).toBe(true);
  });

  it('returns true for clearActive action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.clearActive' })).toBe(true);
  });

  it('returns false for an unrelated action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContextPackSwitchResponse(null)).toBe(false);
  });
});

describe('isContextPackReseedResponse', () => {
  it('returns true for reseed action', () => {
    expect(isContextPackReseedResponse({ action: 'contextPack.reseed' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isContextPackReseedResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isContextPackReseedResponse(undefined)).toBe(false);
  });
});

describe('isPickDirectoryResponse', () => {
  it('returns true for pickDirectory action', () => {
    expect(isPickDirectoryResponse({ action: 'contextPack.pickDirectory' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isPickDirectoryResponse({ action: 'contextPack.create' })).toBe(false);
  });
});

describe('isDiscoverPrefillResponse', () => {
  it('returns true for discoverPrefill action', () => {
    expect(isDiscoverPrefillResponse({ action: 'contextPack.discoverPrefill' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isDiscoverPrefillResponse({ action: 'contextPack.list' })).toBe(false);
  });
});

describe('isCreateResponse', () => {
  it('returns true for create action', () => {
    expect(isCreateResponse({ action: 'contextPack.create' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isCreateResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false when action property is missing', () => {
    expect(isCreateResponse({ type: 'contextPack.create' })).toBe(false);
  });
});

describe('isTaskBoardKillTaskResponse', () => {
  it('accepts failed and kill-requested responses', () => {
    expect(isTaskBoardKillTaskResponse({
      action: 'taskBoard.killTask',
      mode: 'failed',
      message: 'Stopped.',
      taskId: 'task-a',
      movedItem: 'task-a.md',
      nextActiveItem: null,
    })).toBe(true);
    expect(isTaskBoardKillTaskResponse({
      action: 'taskBoard.killTask',
      mode: 'kill-requested',
      message: 'Stop requested.',
      taskId: 'task-a',
    })).toBe(true);
  });

  it('rejects malformed kill response shapes', () => {
    expect(isTaskBoardKillTaskResponse({ action: 'taskBoard.killTask', mode: 'done', message: 'x', taskId: 'task-a' })).toBe(false);
    expect(isTaskBoardKillTaskResponse({ action: 'taskBoard.killTask', mode: 'failed', message: 1, taskId: 'task-a' })).toBe(false);
    expect(isTaskBoardKillTaskResponse({ action: 'taskBoard.killTask', mode: 'failed', message: 'x', taskId: 1 })).toBe(false);
    expect(isTaskBoardKillTaskResponse({ action: 'taskBoard.killTask', mode: 'failed', message: 'x', taskId: 'task-a', movedItem: null })).toBe(false);
    expect(isTaskBoardKillTaskResponse({ action: 'taskBoard.killTask', mode: 'failed', message: 'x', taskId: 'task-a', nextActiveItem: 1 })).toBe(false);
  });
});

describe('isTaskBoardReadBoardResponse', () => {
  it('accepts valid cleanup-failed pending rows and rejects malformed cleanup fields', () => {
    expect(isTaskBoardReadBoardResponse({
      action: 'taskBoard.readBoard',
      dropboxItems: [],
      pendingItems: [{
        fileName: 'task-a.md',
        taskId: 'task-a',
        title: 'Task A',
        state: 'stopping',
        stopCleanupStatus: 'failed',
        stopCleanupErrorCode: 'failed-item-cleanup-failed',
        stopCleanupFailedAt: '2026-05-24T10:00:00.000Z',
        stopCleanupMessage: 'Cleanup failed.',
        stopCleanupRetryable: true,
      }],
      errorItems: [],
      completedItems: [],
    })).toBe(true);
    expect(isTaskBoardReadBoardResponse({
      action: 'taskBoard.readBoard',
      dropboxItems: [],
      pendingItems: [{
        fileName: 'task-a.md',
        taskId: 'task-a',
        title: 'Task A',
        state: 'stopping',
        stopCleanupStatus: 'retrying',
      }],
      errorItems: [],
      completedItems: [],
    })).toBe(false);
    expect(isTaskBoardReadBoardResponse({
      action: 'taskBoard.readBoard',
      dropboxItems: [],
      pendingItems: [{
        fileName: 'task-a.md',
        taskId: 'task-a',
        title: 'Task A',
        state: 'stopping',
        stopCleanupStatus: 'failed',
        stopCleanupErrorCode: 'wrong-code',
      }],
      errorItems: [],
      completedItems: [],
    })).toBe(false);
  });
});

describe('isTaskBoardRetryKillCleanupResponse', () => {
  it('accepts only cleanup retry scheduled responses', () => {
    expect(isTaskBoardRetryKillCleanupResponse({
      action: 'taskBoard.retryKillCleanup',
      mode: 'cleanup-retry-scheduled',
      message: 'Retry cleanup scheduled.',
      taskId: 'task-a',
    })).toBe(true);
    expect(isTaskBoardRetryKillCleanupResponse({
      action: 'taskBoard.retryKillCleanup',
      mode: 'failed',
      message: 'Retry cleanup scheduled.',
      taskId: 'task-a',
    })).toBe(false);
    expect(isTaskBoardRetryKillCleanupResponse({
      action: 'taskBoard.retryKillCleanup',
      mode: 'cleanup-retry-scheduled',
      message: 'Retry cleanup scheduled.',
      taskId: 1,
    })).toBe(false);
  });
});

describe('task notification guards', () => {
  it('accepts valid record, snapshot, mutation response, and event shapes', () => {
    const record = notificationRecord();
    const snapshot = {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 1,
      notifications: [record],
      generatedAt: '2026-05-25T10:00:00.000Z',
      message: 'Loaded task notifications.',
    };
    const mutation = {
      action: 'taskNotifications.markSeen',
      mode: 'updated',
      unseenCount: 0,
      notifications: [record],
      generatedAt: '2026-05-25T10:01:00.000Z',
      message: 'Marked task notifications seen.',
    };

    expect(isTaskNotificationRecord(record)).toBe(true);
    expect(isTaskNotificationSnapshot(snapshot)).toBe(true);
    expect(isTaskNotificationMutationResponse(mutation)).toBe(true);
    expect(isTaskNotificationEvent({ type: 'snapshot', snapshot })).toBe(true);
  });

  it('rejects invalid notification guard shapes', () => {
    expect(isTaskNotificationRecord({ ...notificationRecord(), notificationId: '' })).toBe(false);
    expect(isTaskNotificationRecord({ ...notificationRecord(), severity: 'info' })).toBe(false);
    expect(isTaskNotificationRecord({ ...notificationRecord(), createdAt: null })).toBe(false);
    expect(isTaskNotificationSnapshot({
      action: 'taskNotifications.read',
      mode: 'updated',
      unseenCount: 1,
      notifications: [],
      generatedAt: '2026-05-25T10:00:00.000Z',
      message: 'Loaded task notifications.',
    })).toBe(false);
    expect(isTaskNotificationMutationResponse({
      action: 'taskNotifications.read',
      mode: 'updated',
      unseenCount: 0,
      notifications: [],
      generatedAt: '2026-05-25T10:00:00.000Z',
      message: 'Updated.',
    })).toBe(false);
    expect(isTaskNotificationEvent({
      type: 'upsert',
      snapshot: {
        action: 'taskNotifications.read',
        mode: 'read-only',
        unseenCount: 0,
        notifications: [],
        generatedAt: '2026-05-25T10:00:00.000Z',
        message: 'Loaded task notifications.',
      },
    })).toBe(false);
  });
});

function notificationRecord(): TaskNotificationRecord {
  return {
    notificationId: 'a'.repeat(64),
    dedupeKey: 'task:TASK-001:failed',
    type: 'task-failed',
    severity: 'error',
    taskId: 'TASK-001',
    taskGuid: null,
    taskTitle: 'Fix failure',
    taskFileName: 'TASK-001.md',
    contextPackId: 'platform',
    contextPackDir: '/tmp/context-packs/platform',
    contextPackLabel: 'platform',
    archivePath: null,
    errorItemPath: '/tmp/error-items/TASK-001.md',
    createdAt: '2026-05-25T10:00:00.000Z',
    seenAt: null,
    dismissedAt: null,
    message: 'Task failed.',
  };
}
