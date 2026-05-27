import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { flushLoggers } from '../../core/index.js';
import { resolveQueuePaths } from '../paths.js';
import { readTaskJson } from '../taskJson.js';

const verifyTaskBranches = vi.fn().mockResolvedValue({ ok: true, failures: [] });
const finalizeTaskWorktrees = vi.fn().mockResolvedValue(undefined);
const stageAutoMergeCloseout = vi.fn().mockResolvedValue({ enabled: false, applied: false, results: [] });
const readTaskJsonMock = vi.mocked(readTaskJson);

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
vi.mock('../autoMerge.js', () => ({ stageAutoMergeCloseout }));
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
  stageAutoMergeCloseout.mockResolvedValue({ enabled: false, applied: false, results: [] });
  readTaskJsonMock.mockReturnValue({ contextPackBinding: { repoBindings: [] } });
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

    const events = readRuntimeTerminalEvents(taskId);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'closeout.snapshot_committing', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.snapshot_committed', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.branch_verification.started', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.branch_verification.completed', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'closeout.finalizing_worktrees', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'pipeline.completed', source: 'runtime.pipeline' }),
      expect.objectContaining({ eventId: 'queue.task.completed', source: 'runtime.queue' }),
      expect.objectContaining({ eventId: 'closeout.finalized' }),
    ]));
    const eventIds = events.map((event) => event.eventId);
    expect(eventIds.filter((eventId) => eventId === 'pipeline.completed')).toHaveLength(1);
    expect(eventIds.indexOf('pipeline.completed')).toBeLessThan(eventIds.indexOf('queue.task.completed'));
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
    expect(readRuntimeTerminalEvents(taskId).some((event) => event.eventId === 'pipeline.completed')).toBe(false);
    expect(readRuntimeTerminalEvents(taskId).some((event) => event.eventId === 'queue.task.completed')).toBe(false);
  });

  it('does not emit pipeline completed when closeout finalization fails', async () => {
    const taskId = 'task-finalize-throws';
    seedActiveTask(taskId);
    finalizeTaskWorktrees.mockRejectedValueOnce(new Error('finalize failed'));
    const { completePendingItem } = await import('../completePendingItem.js');

    await expect(completePendingItem({ taskId, skipArchive: true, skipValidation: true, repoRoot }))
      .rejects.toThrow('finalize failed');

    const events = readRuntimeTerminalEvents(taskId);
    expect(events.some((event) => event.eventId === 'pipeline.completed')).toBe(false);
    expect(events.some((event) => event.eventId === 'queue.task.completed')).toBe(false);
  });

  it('omits skipped auto-merge results from applied repos and emits skipped detail after applied', async () => {
    const taskId = 'task-auto-merge-mixed';
    seedActiveTask(taskId);
    stageAutoMergeCloseout.mockResolvedValueOnce({
      enabled: true,
      applied: true,
      results: [
        {
          originalRoot: '/repos/platform',
          repoLabel: 'platform',
          targetBranch: 'main',
          sourceBranch: 'task/platform',
          status: 'applied',
          detail: 'Applied task branch patch.',
        },
        {
          originalRoot: '/repos/tools',
          repoLabel: 'tools',
          targetBranch: 'main',
          sourceBranch: 'task/tools',
          status: 'skipped-merge-not-needed',
          detail: 'No merge needed.',
        },
      ],
    });
    const { completePendingItem } = await import('../completePendingItem.js');

    await completePendingItem({ taskId, skipArchive: true, skipValidation: true, repoRoot });

    const events = readRuntimeTerminalEvents(taskId);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'closeout.target_branch_update:platform:task/platform:applied:main',
        severity: 'success',
        visible: true,
        message: 'Code changes from task branch task/platform were successfully staged on target branch main in target repo platform at /repos/platform.',
        extra: expect.objectContaining({ targetRepoRoot: '/repos/platform' }),
      }),
      expect.objectContaining({
        eventId: 'closeout.target_branch_update:tools:task/tools:skipped:main',
        severity: 'warning',
        visible: true,
        message: 'Target branch was not updated for tools at /repos/tools: No merge needed. Task branch task/tools is ready for operator review.',
        extra: expect.objectContaining({ targetRepoRoot: '/repos/tools' }),
      }),
      expect.objectContaining({
        eventId: 'auto_merge.applied',
        visible: false,
        extra: { repos: 'platform:task/platform->main' },
        message: 'Auto-merge applied platform:task/platform->main.',
      }),
      expect.objectContaining({
        eventId: 'auto_merge.skipped',
        visible: false,
        extra: { detail: 'tools:task/tools->main skipped-merge-not-needed: No merge needed' },
        message: 'Auto-merge skipped: tools:task/tools->main skipped-merge-not-needed: No merge needed.',
      }),
    ]));
    const applied = events.find((event) => event.eventId === 'auto_merge.applied');
    expect(String(applied?.message ?? '')).not.toContain('tools');
    const eventIds = events.map((event) => event.eventId);
    expect(eventIds.indexOf('auto_merge.applied')).toBeLessThan(eventIds.indexOf('auto_merge.skipped'));
  });

  it('passes only branch-owned repoBindings to auto-merge when readonly context bindings exist', async () => {
    const taskId = 'task-readonly-auto-merge';
    seedActiveTask(taskId);
    const branchBinding = {
      originalRoot: '/repos/platform',
      worktreeRoot: '/worktrees/platform',
      worktreeBranch: 'task/platform',
      baseCommitSha: 'base-platform',
    };
    readTaskJsonMock
      .mockReturnValueOnce({
        contextPackBinding: {
          repoBindings: [branchBinding],
          readonlyContextBindings: [{
            originalRoot: '/repos/tools',
            worktreeRoot: '/worktrees/tools',
            baseCommitSha: 'base-tools',
            repoId: 'tools',
            role: 'support',
          }],
        },
      })
      .mockReturnValueOnce({ contextPackBinding: { repoBindings: [] } });
    const { completePendingItem } = await import('../completePendingItem.js');

    await completePendingItem({ taskId, skipArchive: true, skipValidation: true, repoRoot });

    expect(stageAutoMergeCloseout).toHaveBeenCalledWith({
      enabled: true,
      bindings: [branchBinding],
    });
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
