// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathExists = vi.fn();
const readObservabilitySnapshot = vi.fn();
const readTaskRecoveryState = vi.fn();
const writeTaskRecoveryState = vi.fn();
const clearTaskRecoveryState = vi.fn();
const emitStreamEvent = vi.fn();
const acquireDirLockOrThrow = vi.fn();
const activateNextPendingItemIfReady = vi.fn();
const moveFailedItemToErrorItems = vi.fn();
const repairQueue = vi.fn();
const TEST_TASK_ID = 'TASK-1';
const resolveQueuePaths = vi.fn(() => ({
  queueLockDir: '/repo/.locks/queue.lock',
  pendingDir: '/repo/AgentWorkSpace/pendingitems',
  handoffsDir: `/repo/AgentWorkSpace/tasks/${TEST_TASK_ID}/handoffs`,
  templatesDir: '/repo/AgentWorkSpace/templates',
}));
const readFile = vi.fn();
const readdir = vi.fn();
const stat = vi.fn();

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
}));

vi.mock('./utils', () => ({
  pathExists,
  repoFs: {
    access: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

vi.mock('./repoObservability', () => ({
  readObservabilitySnapshot,
}));

vi.mock('./main.recoveryState', () => ({
  readTaskRecoveryState,
  writeTaskRecoveryState,
  clearTaskRecoveryState,
}));

vi.mock('./main.stream', () => ({
  emitStreamEvent,
}));

vi.mock('../../../backend/platform/queue', () => ({
  acquireDirLockOrThrow,
  activateNextPendingItemIfReady,
  moveFailedItemToErrorItems,
  repairQueue,
  resolveQueuePaths,
}));

vi.mock('node:fs/promises', () => ({
  readFile,
  readdir,
  stat,
}));

describe('startTaskRecoveryController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T23:39:28.772Z'));
    acquireDirLockOrThrow.mockResolvedValue(async () => undefined);
    activateNextPendingItemIfReady.mockResolvedValue({ activated: false });
    repairQueue.mockResolvedValue({ issues: [], fixed: [] });
    readObservabilitySnapshot.mockResolvedValue({
      action: 'observability.readSnapshot',
      mode: 'read-only',
      message: 'snapshot',
      queueDepth: 0,
      pendingReviewCount: 1,
      activeTaskId: 'TASK-1',
      activeTaskTitle: 'Task 1',
      currentState: 'active',
      pendingQueueItems: [],
      lifecycle: [],
      artifactReferences: [],
      policyBoundary: 'boundary',
      activeTask: {
        taskId: 'TASK-1',
        taskTitle: 'Task 1',
        taskKind: 'standard',
        workflowStage: 'active',
        activePath: null,
        parallelizationEnabled: false,
        startedAt: '2026-03-28T23:00:00Z',
        lastUpdatedAt: '2026-03-28T23:00:00Z',
        sourceArtifact: `AgentWorkSpace/tasks/${TEST_TASK_ID}/handoffs/professional-task.md`,
        taskHealth: {
          status: 'idle',
          summary: 'No runtime sessions observed yet.',
          observedSessionCount: 0,
          runningCount: 0,
          completedCount: 0,
          failedCount: 0,
          suspectedStuckCount: 0,
          orphanedCount: 0,
          aliveCount: 0,
          missingPidCount: 0,
          unknownPidCount: 0,
        },
      },
    });
    readTaskRecoveryState.mockResolvedValue({
      kind: 'activation-timeout',
      status: 'pending-start',
      summary: 'Waiting for pipeline activity for TASK-1.md.',
      queueName: 'TASK-1.md',
      taskId: 'TASK-1',
      activationStartedAt: '2026-03-28T23:00:00.000Z',
      deadlineAt: '2026-03-28T23:05:00.000Z',
      detectedAt: '2026-03-28T23:00:00.000Z',
      updatedAt: '2026-03-28T23:00:00.000Z',
      errorItemPath: null,
    });
    pathExists.mockImplementation(async (target: string) => {
      if (target === '/repo/AgentWorkSpace/pendingitems/.active-items') {
        return true;
      }
      return false;
    });
    readFile.mockRejectedValue(new Error('Unexpected read'));
    readdir.mockImplementation(async (target: string) => {
      if (target === '/repo/AgentWorkSpace/pendingitems/.active-items') {
        return ['TASK-1'];
      }
      throw new Error(`Unexpected readdir: ${target}`);
    });
    stat.mockImplementation(async (target: string) => {
      if (target === '/repo/AgentWorkSpace/pendingitems/.active-items/TASK-1') {
        return {
          mtime: new Date('2026-03-28T23:00:00.000Z'),
          mtimeMs: Date.parse('2026-03-28T23:00:00.000Z'),
        };
      }
      throw new Error(`Unexpected stat: ${target}`);
    });
    moveFailedItemToErrorItems.mockResolvedValue({
      movedItem: 'TASK-1.md',
      errorItemPath: '/repo/AgentWorkSpace/error-items/TASK-1.md',
      nextActiveItem: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-fails a timed-out activation with no pipeline evidence', async () => {
    const { startTaskRecoveryController } = await import('./main.recovery');
    const controller = startTaskRecoveryController({
      pollIntervalMs: 60_000,
      activationGraceMs: 5 * 60 * 1000,
      schedulePipelineAutoStart: vi.fn(),
    });

    controller.reconcileNow();

    await vi.waitFor(() => {
      expect(moveFailedItemToErrorItems).toHaveBeenCalledWith({ repoRoot: '/repo', taskId: 'TASK-1' });
    });
    expect(writeTaskRecoveryState).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'activation-timeout',
      status: 'auto-failed',
      queueName: 'TASK-1.md',
      errorItemPath: '/repo/AgentWorkSpace/error-items/TASK-1.md',
    }));
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'recovery.controller',
      severity: 'error',
    }));

    controller.stop();
  });
});
