/**
 * deleteErrorItem disposal contract:
 *
 * A failed task in error-items/ has retained forensic state from
 * moveFailedItemToErrorItems → finalizeTaskWorktrees with
 * retain_failed_task_worktrees=true:
 *   - AgentWorkSpace/tasks/<taskId>/ (worktree dir + .task.json)
 *   - task/<taskId> branch in each binding's originalRoot
 *   - .platform-state/runtime/tasks/<taskId>/ (guardrail receipts, runtime state)
 *
 * When the operator deletes the error item from the Task Board, the failed
 * task is gone for good — the forensic affordance is no longer needed and
 * must be retired. Mirrors the requeueErrorItem and moveErrorItemToDropbox
 * disposal contracts.
 *
 * The discard helper itself is comprehensively unit-tested in
 * worktreeFinalize.test.ts (`describe('discardRetainedTaskWorktrees', …)`).
 * This file proves only the integration: deleteErrorItem invokes the helper
 * with the correct taskId and repoRoot, AFTER the rename succeeds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../core/worktreeFinalize.js', () => ({
  discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));

import { discardRetainedTaskWorktrees } from '../../core/worktreeFinalize.js';
import { deleteErrorItem } from '../deleteErrorItem.js';

const mockDiscardRetainedTaskWorktrees = vi.mocked(discardRetainedTaskWorktrees);

describe('deleteErrorItem retained-state disposal', () => {
  let repoRoot: string;
  let errorItemsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscardRetainedTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'delete-error-item-'));
    errorItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'error-items');
    mkdirSync(errorItemsDir, { recursive: true });
    // queueLockDir lives under pendingitems/.queue-lock.d; acquireDirLock uses
    // a non-recursive mkdir, so the parent must exist or every acquire attempt
    // fails ENOENT and the retry loop burns through the test timeout.
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('removes the .md file and discards retained forensic state', async () => {
    const taskId = 'task-failed-001';
    writeFileSync(path.join(errorItemsDir, `${taskId}.md`), '# Failed\n', 'utf-8');

    await deleteErrorItem({ repoRoot, queueName: `${taskId}.md` });

    // Task file gone.
    expect(existsSync(path.join(errorItemsDir, `${taskId}.md`))).toBe(false);

    // Discard helper called exactly once with the failed task's ID
    expect(mockDiscardRetainedTaskWorktrees).toHaveBeenCalledTimes(1);
    expect(mockDiscardRetainedTaskWorktrees).toHaveBeenCalledWith(taskId, repoRoot);
  });

  it('does NOT call the discard helper when the file is missing (rename throws)', async () => {
    // Do not seed the error item — unlink will throw with the
    // "does not exist in error-items/" guard message.
    await expect(
      deleteErrorItem({ repoRoot, queueName: 'task-missing.md' }),
    ).rejects.toThrow(/does not exist in error-items/);

    // Discard MUST NOT run — preserves the contract that retained state is
    // only retired AFTER a successful operator-initiated transition.
    expect(mockDiscardRetainedTaskWorktrees).not.toHaveBeenCalled();
  });
});
