import { describe, expect, it } from 'vitest';

import type {
  ArchivedParentChainArchiveBundle,
  DesktopActionRequest,
  DesktopActionResponse,
} from './desktopContract';
import { DESKTOP_ACTION_NAMES } from './desktopContract';
import { validateDesktopActionRequest } from './desktopContractValidators';

function bundle(status: ArchivedParentChainArchiveBundle['status']): ArchivedParentChainArchiveBundle {
  return {
    schemaVersion: 1,
    parentTaskId: 'TASK-002',
    rootTaskId: 'TASK-001',
    currentTipTaskId: status === 'no-chain-state' ? null : 'TASK-002',
    status,
    tasks: status === 'no-chain-state'
      ? []
      : [{
        taskId: 'TASK-001',
        title: 'Root task',
        depth: 0,
        role: 'root',
        state: 'completed',
        archivedAt: '2026-05-17T08:42:11.000Z',
        archivePath: '/archive/tasks/TASK-001/archive.md',
        sizeBytes: 12,
        content: 'Archive body',
        truncated: false,
      }],
    missingTaskIds: status === 'missing-archives' ? ['TASK-002'] : [],
    totalBytes: status === 'no-chain-state' ? 0 : 12,
    truncated: false,
  };
}

describe('desktop parent chain archive bundle contract', () => {
  it('approves and validates planner.readParentChainArchiveBundle requests', () => {
    const request: DesktopActionRequest = {
      action: 'planner.readParentChainArchiveBundle',
      payload: {
        parentTaskId: 'TASK-002',
        rootTaskId: 'TASK-001',
        contextPackDir: '/tmp/context-packs/orders',
        contextPackId: 'orders',
      },
    };

    expect(DESKTOP_ACTION_NAMES).toContain('planner.readParentChainArchiveBundle');
    expect(validateDesktopActionRequest(request)).toEqual([]);
  });

  it('rejects empty identifiers and relative context pack directory', () => {
    expect(validateDesktopActionRequest({
      action: 'planner.readParentChainArchiveBundle',
      payload: {
        parentTaskId: '',
        rootTaskId: '',
        contextPackDir: 'relative/context-pack',
        contextPackId: '',
      },
    })).toEqual([
      'payload.parentTaskId must be a non-empty string.',
      'payload.rootTaskId must be a non-empty string.',
      'payload.contextPackDir must be an absolute path string.',
      'payload.contextPackId must be a non-empty string.',
    ]);
  });

  it('types loaded responses for all bundle statuses', () => {
    const responses: DesktopActionResponse[] = [
      bundle('available'),
      bundle('no-chain-state'),
      bundle('missing-archives'),
    ].map((item) => ({
      action: 'planner.readParentChainArchiveBundle',
      mode: 'loaded',
      accepted: true,
      message: 'Loaded.',
      bundle: item,
    }));

    expect(responses.map((response) => (
      response.action === 'planner.readParentChainArchiveBundle' ? response.bundle.status : null
    ))).toEqual([
      'available',
      'no-chain-state',
      'missing-archives',
    ]);
  });
});
