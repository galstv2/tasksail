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
  isTaskBoardReadChildChainBranchInventoryResponse,
  isTaskBoardKillTaskResponse,
  isTaskBoardRetryKillCleanupResponse,
  isTaskNotificationEvent,
  isTaskNotificationMutationResponse,
  isTaskNotificationRecord,
  isTaskNotificationSnapshot,
} from './desktopContractTypeGuards';
import type { TaskNotificationRecord } from './desktopContractTaskNotifications';

describe('isTaskBoardReadChildChainBranchInventoryResponse', () => {
  const validRow = {
    repoRoot: '/repos/app',
    repoLabel: 'app',
    chainSourceBranch: 'feature/x',
    sourceKind: 'parent-handoff',
    introducedAtTaskId: 'task-1',
    introducedAtDepth: 0,
    targetBranch: 'main',
  };
  const loaded = {
    action: 'taskBoard.readChildChainBranchInventory',
    mode: 'loaded',
    message: 'ok',
    inventory: {
      schemaVersion: 1,
      rootTaskId: 'root-1',
      selectedTaskId: 'task-1',
      currentTipTaskId: 'task-2',
      taskCount: 2,
      rows: [validRow],
      generatedAt: '2026-05-30T00:00:00.000Z',
    },
  };

  it('accepts a well-formed loaded response', () => {
    expect(isTaskBoardReadChildChainBranchInventoryResponse(loaded)).toBe(true);
  });

  it('accepts not-chain-task and invalid-state without inventory', () => {
    expect(isTaskBoardReadChildChainBranchInventoryResponse({
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'not-chain-task',
      message: 'no',
    })).toBe(true);
    expect(isTaskBoardReadChildChainBranchInventoryResponse({
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'invalid-state',
      message: 'bad',
    })).toBe(true);
  });

  it('rejects a loaded response with a malformed row sourceKind', () => {
    expect(isTaskBoardReadChildChainBranchInventoryResponse({
      ...loaded,
      inventory: { ...loaded.inventory, rows: [{ ...validRow, sourceKind: 'bogus' }] },
    })).toBe(false);
  });

  it('enforces per-field row validity (and permits an empty repoLabel)', () => {
    const withRow = (over: Record<string, unknown>) => ({
      ...loaded,
      inventory: { ...loaded.inventory, rows: [{ ...validRow, ...over }] },
    });
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ repoRoot: '' }))).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ chainSourceBranch: '' }))).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ introducedAtTaskId: '' }))).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ introducedAtDepth: Number.POSITIVE_INFINITY }))).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ introducedAtDepth: Number.NaN }))).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ targetBranch: 5 }))).toBe(false);
    // repoLabel is a plain string per the contract; empty is allowed.
    expect(isTaskBoardReadChildChainBranchInventoryResponse(withRow({ repoLabel: '' }))).toBe(true);
  });

  it('rejects loaded without inventory and non-loaded carrying inventory', () => {
    expect(isTaskBoardReadChildChainBranchInventoryResponse({
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'loaded',
      message: 'ok',
    })).toBe(false);
    expect(isTaskBoardReadChildChainBranchInventoryResponse({
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'not-chain-task',
      message: 'no',
      inventory: loaded.inventory,
    })).toBe(false);
  });

  it('rejects a different action', () => {
    expect(isTaskBoardReadChildChainBranchInventoryResponse({ action: 'taskBoard.readBoard' })).toBe(false);
  });
});

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
  function validBoard(overrides: Record<string, unknown> = {}) {
    return {
      action: 'taskBoard.readBoard',
      boardSnapshotSequence: 1,
      dropboxItems: [],
      pendingItems: [],
      errorItems: [],
      completedItems: [],
      ...overrides,
    };
  }

  it('accepts valid cleanup-failed pending rows and rejects malformed cleanup fields', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
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
    }))).toBe(true);
    expect(isTaskBoardReadBoardResponse(validBoard({
      pendingItems: [{
        fileName: 'task-a.md',
        taskId: 'task-a',
        title: 'Task A',
        state: 'stopping',
        stopCleanupStatus: 'retrying',
      }],
    }))).toBe(false);
    expect(isTaskBoardReadBoardResponse(validBoard({
      pendingItems: [{
        fileName: 'task-a.md',
        taskId: 'task-a',
        title: 'Task A',
        state: 'stopping',
        stopCleanupStatus: 'failed',
        stopCleanupErrorCode: 'wrong-code',
      }],
    }))).toBe(false);
  });

  it('rejects missing boardSnapshotSequence', () => {
    expect(isTaskBoardReadBoardResponse({
      action: 'taskBoard.readBoard',
      dropboxItems: [],
      pendingItems: [],
      errorItems: [],
      completedItems: [],
    })).toBe(false);
  });

  it('rejects non-finite boardSnapshotSequence', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({ boardSnapshotSequence: NaN }))).toBe(false);
    expect(isTaskBoardReadBoardResponse(validBoard({ boardSnapshotSequence: Infinity }))).toBe(false);
    expect(isTaskBoardReadBoardResponse(validBoard({ boardSnapshotSequence: 'one' }))).toBe(false);
  });

  it('rejects malformed dropbox item shapes', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      dropboxItems: [{ fileName: '', taskId: null, title: null }],
    }))).toBe(false);
    expect(isTaskBoardReadBoardResponse(validBoard({
      dropboxItems: [{ fileName: 'open.md', taskId: 42, title: null }],
    }))).toBe(false);
  });

  it('rejects malformed error item shapes', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      errorItems: [{ fileName: '', taskId: null, title: null }],
    }))).toBe(false);
  });

  it('accepts valid dropbox, error, and completed items alongside valid pending items', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      dropboxItems: [{ fileName: 'open.md', taskId: 'open-1', title: 'Open task' }],
      errorItems: [{ fileName: 'err.md', taskId: 'err-1', title: 'Error task' }],
      completedItems: [{ taskId: 'done-1', title: 'Done', summary: '', rootTaskId: 'done-1', qmdRecordId: 'task:pack:done-1', followupReason: '', year: '2026', archivePath: '/archive/done-1/archive.md', archivedAt: '2026-01-01T00:00:00Z', contextPackName: 'pack' }],
    }))).toBe(true);
  });

  it('rejects a completed row with an empty taskId', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      completedItems: [{ taskId: '', title: 'Done', summary: '', rootTaskId: 'done-1', qmdRecordId: 'task:pack:done-1', followupReason: '', year: '2026', archivePath: '/archive/done-1/archive.md', archivedAt: null, contextPackName: 'pack' }],
    }))).toBe(false);
  });

  it('rejects a completed row with a non-string archivePath', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      completedItems: [{ taskId: 'done-1', title: 'Done', summary: '', rootTaskId: 'done-1', qmdRecordId: 'task:pack:done-1', followupReason: '', year: '2026', archivePath: 42, archivedAt: null, contextPackName: 'pack' }],
    }))).toBe(false);
  });

  it('rejects a completed row with a numeric archivedAt (must be string or null)', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      completedItems: [{ taskId: 'done-1', title: 'Done', summary: '', rootTaskId: 'done-1', qmdRecordId: 'task:pack:done-1', followupReason: '', year: '2026', archivePath: '/archive/done-1/archive.md', archivedAt: 1234567890, contextPackName: 'pack' }],
    }))).toBe(false);
  });

  it('accepts a valid completed row that also carries optional childChain and branchHandoffs metadata', () => {
    const completedWithMeta = {
      taskId: 'done-1',
      title: 'Done',
      summary: '',
      rootTaskId: 'done-1',
      qmdRecordId: 'task:pack:done-1',
      followupReason: '',
      year: '2026',
      archivePath: '/archive/done-1/archive.md',
      archivedAt: '2026-01-01T00:00:00Z',
      contextPackName: 'pack',
      // Optional metadata fields that may be present on chain tasks
      childChain: {
        rootTaskId: 'done-1',
        parentTaskId: null,
        previousTaskId: null,
        depth: 0,
        state: 'completed',
        currentTipTaskId: 'done-1',
        isCurrentTip: true,
        archivePath: '/archive/done-1/archive.md',
        archiveArtifactDir: '/archive/done-1',
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
      },
      branchHandoffs: [],
    };
    expect(isTaskBoardReadBoardResponse(validBoard({
      completedItems: [completedWithMeta],
    }))).toBe(true);
  });

  it('rejects duplicate fileName identities across columns', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      dropboxItems: [{ fileName: 'task.md', taskId: 'task-1', title: 'Task' }],
      errorItems: [{ fileName: 'task.md', taskId: 'task-2', title: 'Task 2' }],
    }))).toBe(false);
  });

  it('rejects duplicate taskId identities across columns', () => {
    expect(isTaskBoardReadBoardResponse(validBoard({
      dropboxItems: [{ fileName: 'task-a.md', taskId: 'task-1', title: 'Task A' }],
      pendingItems: [{ fileName: 'task-b.md', taskId: 'task-1', title: 'Task B', state: 'pending' }],
    }))).toBe(false);
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
