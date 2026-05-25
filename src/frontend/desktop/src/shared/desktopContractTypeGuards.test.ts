import { describe, expect, it } from 'vitest';

import {
  isContextPackListResponse,
  isContextPackSwitchResponse,
  isContextPackReseedResponse,
  isPickDirectoryResponse,
  isDiscoverPrefillResponse,
  isCreateResponse,
  isTaskBoardReadBoardResponse,
  isTaskBoardKillTaskResponse,
  isTaskBoardRetryKillCleanupResponse,
} from './desktopContractTypeGuards';

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
