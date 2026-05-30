import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

describe('taskBoard.readChildChainBranchInventory validation', () => {
  it('accepts a request with only taskId', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'task-1' },
    })).toEqual([]);
  });

  it('accepts expectedRootTaskId as a non-empty string', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'task-1', expectedRootTaskId: 'root-1' },
    })).toEqual([]);
  });

  it('accepts expectedRootTaskId as null', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'task-1', expectedRootTaskId: null },
    })).toEqual([]);
  });

  it('rejects an empty taskId', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: '' },
    })).toContain('payload.taskId must be a non-empty string.');
  });

  it('rejects an empty expectedRootTaskId string', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'task-1', expectedRootTaskId: '' },
    })).toContain('payload.expectedRootTaskId must be a non-empty string or null when provided.');
  });

  it('rejects a non-object payload', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readChildChainBranchInventory',
      payload: null,
    })).toContain('payload must be an object.');
  });
});
