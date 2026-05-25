import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { flushLoggers } from '../../core/index.js';
import { resolveQueuePaths } from '../paths.js';

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktreesWithReport: vi.fn().mockResolvedValue({ status: 'completed' }),
  discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../taskRegistry.js', () => ({
  transitionTask: vi.fn().mockResolvedValue(undefined),
  removeTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../operations.js', () => ({
  activateNextPendingItemIfReady: vi.fn().mockResolvedValue({ activated: false }),
  insertIntoQueueManifest: vi.fn().mockResolvedValue(undefined),
  removeFromQueueOrderManifest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../childTaskChainFailure.js', () => ({
  markChildTaskChainTaskFailed: vi.fn().mockResolvedValue({ marked: false }),
  resetFailedChildTaskChainTaskToPlanned: vi.fn().mockResolvedValue({ reset: false }),
}));

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'error-terminal-events-'));
  flushLoggers();
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.clearAllMocks();
  flushLoggers();
});

describe('moveFailedItemToErrorItems terminal events', () => {
  it('emits failed-worktree finalization before queue failure movement', async () => {
    const { moveFailedItemToErrorItems } = await import('../errorItems.js');
    const taskId = 'task-failed';
    const paths = resolveQueuePaths(repoRoot);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
    writeFileSync(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);

    await moveFailedItemToErrorItems({ repoRoot, taskId });

    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'failure.finalizing_worktrees',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
      }),
      expect.objectContaining({
        eventId: 'queue.task.failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
      }),
      expect.objectContaining({
        eventId: 'queue.error_items.moved',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
      }),
    ]));
  });

  it('emits recovered missing pending when it writes a recovered body', async () => {
    const { moveFailedItemToErrorItems } = await import('../errorItems.js');
    const taskId = 'task-recovered';
    const paths = resolveQueuePaths(repoRoot);
    mkdirSync(paths.errorItemsDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs'), { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs', 'intake.md'), '# Recovered task\n');

    await moveFailedItemToErrorItems({ repoRoot, taskId });

    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'failure.recovered_missing_pending',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        extra: { recovered: true },
      }),
    ]));
  });
});

function readRuntimeTerminalEvents(taskId: string): Array<Record<string, unknown>> {
  const filePath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, 'utf-8')).events;
}
