import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { markChildTaskChainTaskFailed } from '../childTaskChainFailure.js';
import { writeChildTaskChains, readChildTaskChains, type ChildTaskChainsState } from '../childTaskChains.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';
import { resolveQueuePaths } from '../paths.js';

const { activateNextPendingItemIfReadyMock, finalizeTaskWorktreesWithReportMock } = vi.hoisted(() => ({
  activateNextPendingItemIfReadyMock: vi.fn().mockResolvedValue({ activated: false }),
  finalizeTaskWorktreesWithReportMock: vi.fn().mockResolvedValue({
    chainRollbackReport: null,
    skipNextActivation: false,
  }),
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktreesWithReport: finalizeTaskWorktreesWithReportMock,
  discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../operations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../operations.js')>();
  return {
    ...actual,
    activateNextPendingItemIfReady: activateNextPendingItemIfReadyMock,
  };
});

import { moveErrorItemToDropbox, moveFailedItemToErrorItems } from '../errorItems.js';

const now = '2026-05-22T12:00:00.000Z';

describe('error item child-chain failure state', () => {
  let repoRoot: string;

  beforeEach(async () => {
    activateNextPendingItemIfReadyMock.mockClear();
    finalizeTaskWorktreesWithReportMock.mockReset();
    finalizeTaskWorktreesWithReportMock.mockResolvedValue({
      chainRollbackReport: null,
      skipNextActivation: false,
    });
    repoRoot = await mkdtemp(path.join(tmpdir(), 'error-child-chain-failure-'));
    await mkdir(path.join(repoRoot, '.platform-state'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('records failed current tip without advancing chain state', async () => {
    await writeChildTaskChains(repoRoot, stateFixture());

    await markChildTaskChainTaskFailed({ repoRoot, taskId: 'child', now });
    const state = await readChildTaskChains(repoRoot);

    expect(state.tasks.child.state).toBe('failed');
    expect(state.chains.root.currentTipTaskId).toBe('child');
  });

  it('moves failed child-chain item and skips next activation when rollback failed', async () => {
    await writeChildTaskChains(repoRoot, stateFixture());
    finalizeTaskWorktreesWithReportMock.mockResolvedValue({
      chainRollbackReport: {
        taskId: 'child',
        status: 'preflight-failed',
        rolledBackBindings: 0,
        failedBinding: {
          repoRoot,
          branch: 'task/root',
          worktreeRoot: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child', 'worktrees', 'repo'),
        },
        errorMessage: 'preflight failed',
      },
      skipNextActivation: true,
    });
    const queuePaths = resolveQueuePaths(repoRoot);
    await mkdir(queuePaths.pendingDir, { recursive: true });
    await mkdir(queuePaths.activeItemsDir, { recursive: true });
    await writeFile(path.join(queuePaths.pendingDir, 'child.md'), '# Child\n', 'utf-8');
    await writeFile(path.join(queuePaths.activeItemsDir, 'child'), 'child.md', 'utf-8');
    await writeQueueOrderManifest(queuePaths.queueOrderPath, ['child.md']);

    const result = await moveFailedItemToErrorItems({ repoRoot, taskId: 'child' });
    const state = await readChildTaskChains(repoRoot);
    const movedBody = await readFile(path.join(queuePaths.errorItemsDir, 'child.md'), 'utf-8');

    expect(result.movedItem).toBe('child.md');
    expect(result.nextActiveItem).toBeNull();
    expect(movedBody).toContain('# Child');
    expect(state.tasks.child.state).toBe('failed');
    expect(state.chains.root.currentTipTaskId).toBe('child');
    expect(activateNextPendingItemIfReadyMock).not.toHaveBeenCalled();
  });

  it('resets failed current-tip child-chain state when moving error item back to open', async () => {
    const failedState = stateFixture();
    failedState.tasks.child.state = 'failed';
    await writeChildTaskChains(repoRoot, failedState);
    const queuePaths = resolveQueuePaths(repoRoot);
    await mkdir(queuePaths.pendingDir, { recursive: true });
    await mkdir(queuePaths.errorItemsDir, { recursive: true });
    await mkdir(queuePaths.dropboxDir, { recursive: true });
    await writeFile(path.join(queuePaths.errorItemsDir, 'child.md'), '# Child\n', 'utf-8');

    const result = await moveErrorItemToDropbox({ repoRoot, fileName: 'child.md' });
    const state = await readChildTaskChains(repoRoot);

    expect(result).toEqual({ movedItem: 'child.md' });
    expect(state.tasks.child.state).toBe('planned');
    expect(state.chains.root.currentTipTaskId).toBe('child');
    await expect(readFile(path.join(queuePaths.dropboxDir, 'child.md'), 'utf-8'))
      .resolves.toContain('# Child');
  });
});

function stateFixture(): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId: 'child',
        contextPackId: null,
        contextPackDir: null,
        taskIds: ['root', 'child'],
        createdAt: now,
        updatedAt: now,
      },
    },
    tasks: {
      root: {
        taskId: 'root',
        rootTaskId: 'root',
        parentTaskId: null,
        previousTaskId: null,
        depth: 0,
        state: 'completed',
        archivePath: 'archive.md',
        archiveArtifactDir: null,
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: null,
        childExecutionScope: null,
        branchChain: null,
        completedBranchHandoffs: null,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      child: {
        taskId: 'child',
        rootTaskId: 'root',
        parentTaskId: 'root',
        previousTaskId: 'root',
        depth: 1,
        state: 'active',
        archivePath: null,
        archiveArtifactDir: null,
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: null,
        childExecutionScope: null,
        branchChain: null,
        completedBranchHandoffs: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}
