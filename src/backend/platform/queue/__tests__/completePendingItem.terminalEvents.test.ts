import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { flushLoggers } from '../../core/index.js';
import { resolveQueuePaths } from '../paths.js';

const verifyTaskBranches = vi.fn().mockResolvedValue({ ok: true, failures: [] });
const finalizeTaskWorktrees = vi.fn().mockResolvedValue(undefined);

vi.mock('../branchVerification.js', () => ({ verifyTaskBranches }));
vi.mock('../../core/worktreeFinalize.js', () => ({ finalizeTaskWorktrees }));
vi.mock('../retrospectiveFlag.js', async () => {
  const actual = await vi.importActual<typeof import('../retrospectiveFlag.js')>('../retrospectiveFlag.js');
  return {
    ...actual,
    syncRetrospectiveRequiredMetadata: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../taskRegistry.js', () => ({ transitionTask: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../taskJson.js', () => ({
  resolveTaskJsonPath: (taskId: string, repoRoot: string) => path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'),
  readTaskJson: vi.fn().mockReturnValue({ contextPackBinding: { repoBindings: [] } }),
}));
vi.mock('../../platform-config/get.js', () => ({ getPlatformConfig: vi.fn().mockResolvedValue({ auto_merge: true }) }));
vi.mock('../autoMerge.js', () => ({ stageAutoMergeCloseout: vi.fn().mockResolvedValue({ enabled: false, applied: false, results: [] }) }));
vi.mock('../../agent-runner/guardrails.js', () => ({ evictPolicyResultCache: vi.fn() }));
vi.mock('../../context-pack/active.js', () => ({ requireAuthorizedActiveContextPack: vi.fn().mockResolvedValue('/context-pack') }));
vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(''),
  ADVISORY_FINDING_HEADING: '## Advisory Finding',
}));
vi.mock('../operations.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../operations.js')>(),
  activateNextPendingItemIfReady: vi.fn().mockResolvedValue({ activated: false }),
}));

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'complete-terminal-events-'));
  verifyTaskBranches.mockResolvedValue({ ok: true, failures: [] });
  finalizeTaskWorktrees.mockResolvedValue(undefined);
  flushLoggers();
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.clearAllMocks();
  flushLoggers();
});

describe('completePendingItem terminal events', () => {
  it('emits snapshot, branch verification, and finalizing-worktrees events at closeout boundaries', async () => {
    const taskId = 'task-complete';
    seedActiveTask(taskId);
    const { completePendingItem } = await import('../completePendingItem.js');

    await completePendingItem({ taskId, skipArchive: true, skipValidation: true, repoRoot });

    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'closeout.snapshot_committing', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.snapshot_committed', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.branch_verification.started', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.branch_verification.completed', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.finalizing_worktrees', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'queue.task.completed', source: 'runtime.queue' }),
      expect.objectContaining({ eventId: 'closeout.finalized' }),
    ]));
  });

  it('emits branch verification failed when verifyTaskBranches throws', async () => {
    const taskId = 'task-branch-throws';
    seedActiveTask(taskId);
    verifyTaskBranches.mockRejectedValueOnce(new Error('verification failed'));
    const { completePendingItem } = await import('../completePendingItem.js');

    await expect(completePendingItem({ taskId, skipArchive: true, skipValidation: true, repoRoot }))
      .rejects.toThrow('verification failed');

    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'closeout.branch_verification.failed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
      }),
    ]));
  });
});

function seedActiveTask(taskId: string): void {
  const paths = resolveQueuePaths(repoRoot);
  mkdirSync(paths.pendingDir, { recursive: true });
  mkdirSync(paths.activeItemsDir, { recursive: true });
  mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId), { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
  writeFileSync(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
  writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'), '{}');
}

function readRuntimeTerminalEvents(taskId: string): Array<Record<string, unknown>> {
  const filePath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, 'utf-8')).events;
}
