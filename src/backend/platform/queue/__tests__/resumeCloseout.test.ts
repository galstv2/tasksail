import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../dirLock.js', () => ({
  acquireDirLockOrThrow: vi.fn(),
}));

vi.mock('../retrospectiveFlag.js', () => ({
  syncRetrospectiveRequiredMetadata: vi.fn(),
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn(),
}));

vi.mock('../taskRegistry.js', () => ({
  transitionTask: vi.fn(),
}));

vi.mock('../operations.js', () => ({
  completeActiveItem: vi.fn(),
  activateNextPendingItemIfReady: vi.fn(),
}));

import { acquireDirLockOrThrow } from '../dirLock.js';
import { syncRetrospectiveRequiredMetadata } from '../retrospectiveFlag.js';
import { finalizeTaskWorktrees } from '../../core/worktreeFinalize.js';
import { transitionTask } from '../taskRegistry.js';
import { completeActiveItem, activateNextPendingItemIfReady } from '../operations.js';
import { resumeCloseoutFromSentinel } from '../resumeCloseout.js';

const mockAcquireDirLockOrThrow = vi.mocked(acquireDirLockOrThrow);
const mockSyncRetrospectiveRequiredMetadata = vi.mocked(syncRetrospectiveRequiredMetadata);
const mockFinalizeTaskWorktrees = vi.mocked(finalizeTaskWorktrees);
const mockTransitionTask = vi.mocked(transitionTask);
const mockCompleteActiveItem = vi.mocked(completeActiveItem);
const mockActivateNextPendingItemIfReady = vi.mocked(activateNextPendingItemIfReady);

function activeDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
}

function seedSentinel(repoRoot: string, taskId: string, payload: Record<string, unknown>): void {
  const dir = activeDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, taskId), `${taskId}.md`);
  writeFileSync(path.join(dir, `${taskId}.completing`), JSON.stringify(payload));
}

describe('resumeCloseoutFromSentinel', () => {
  let repoRoot: string;
  const taskId = 'resume-task';
  const archivePath = '/archives/resume-task.md';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-resume-closeout-'));
    mockAcquireDirLockOrThrow.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);
    mockTransitionTask.mockResolvedValue(undefined);
    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId });
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns no-sentinel without side effects when sentinel is absent', async () => {
    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result).toEqual({ status: 'no-sentinel', drove: [] });
    expect(mockAcquireDirLockOrThrow).not.toHaveBeenCalled();
    expect(mockFinalizeTaskWorktrees).not.toHaveBeenCalled();
  });

  it('returns no-archive-record without driving steps for archive-failed sentinel', async () => {
    seedSentinel(repoRoot, taskId, { archiveSucceeded: false });

    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result).toEqual({ status: 'no-archive-record', drove: [] });
    expect(mockAcquireDirLockOrThrow).not.toHaveBeenCalled();
    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });

  it('drives retrospective sync, finalization, marker unlink, and sentinel unlink', async () => {
    seedSentinel(repoRoot, taskId, {
      archiveSucceeded: true,
      archivePath,
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: false,
    });

    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result).toEqual({
      status: 'completed',
      drove: ['retrospective-sync', 'finalize-worktrees', 'unlink-marker', 'unlink-sentinel'],
    });
    expect(mockSyncRetrospectiveRequiredMetadata).toHaveBeenCalledWith(expect.objectContaining({
      repoRoot,
      contextPackDir: '/packs/pack-a',
      taskId,
    }));
    expect(mockTransitionTask).toHaveBeenCalledWith(repoRoot, taskId, 'active', 'completed', expect.objectContaining({ archivePath }));
    expect(mockTransitionTask).toHaveBeenCalledWith(repoRoot, taskId, 'failed', 'completed', expect.objectContaining({ archivePath }));
    expect(mockCompleteActiveItem).toHaveBeenCalled();
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith(taskId, 'completed', repoRoot);
    expect(mockActivateNextPendingItemIfReady).toHaveBeenCalled();
    expect(existsSync(path.join(activeDir(repoRoot), taskId))).toBe(false);
    expect(existsSync(path.join(activeDir(repoRoot), `${taskId}.completing`))).toBe(false);
  });

  it('skips retrospective sync when sentinel is already synced', async () => {
    seedSentinel(repoRoot, taskId, {
      archiveSucceeded: true,
      archivePath,
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: true,
    });

    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result.status).toBe('completed');
    expect(result.drove).toEqual(['finalize-worktrees', 'unlink-marker', 'unlink-sentinel']);
    expect(mockSyncRetrospectiveRequiredMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent on a second call', async () => {
    seedSentinel(repoRoot, taskId, {
      archiveSucceeded: true,
      archivePath,
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: true,
    });

    await expect(resumeCloseoutFromSentinel(taskId, repoRoot)).resolves.toMatchObject({ status: 'completed' });
    await expect(resumeCloseoutFromSentinel(taskId, repoRoot)).resolves.toEqual({ status: 'no-sentinel', drove: [] });
  });

  it('tolerates a missing worktree (finalize is idempotent on already-removed dirs)', async () => {
    seedSentinel(repoRoot, taskId, {
      archiveSucceeded: true,
      archivePath,
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: true,
    });
    // finalize behaves identically whether or not the worktree dir exists; we
    // simulate the missing-worktree path by letting the mock resolve normally.
    // The contract under test is that resume MUST NOT throw and MUST still
    // unlink the marker + sentinel.
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result.status).toBe('completed');
    expect(result.drove).toContain('finalize-worktrees');
    expect(result.drove).toContain('unlink-marker');
    expect(result.drove).toContain('unlink-sentinel');
    expect(existsSync(path.join(activeDir(repoRoot), taskId))).toBe(false);
    expect(existsSync(path.join(activeDir(repoRoot), `${taskId}.completing`))).toBe(false);
  });

  it('continues finalization and writes deferred marker when retrospective sync fails', async () => {
    // Bug 1 regression guard: a thrown sync MUST NOT strand finalize/unlinks.
    // Spec §4 Fix B step 5 — "Tolerate failure (re-stamp sentinel as Fix A does)".
    seedSentinel(repoRoot, taskId, {
      archiveSucceeded: true,
      archivePath,
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: false,
    });
    mockSyncRetrospectiveRequiredMetadata.mockRejectedValueOnce(new Error('counter lock corrupt'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);

    expect(result.status).toBe('completed');
    // The retrospective-sync step did not enter `drove` (it threw), but the
    // tail steps MUST appear:
    expect(result.drove).toContain('finalize-worktrees');
    expect(result.drove).toContain('unlink-marker');
    expect(result.drove).toContain('unlink-sentinel');
    expect(result.drove).not.toContain('retrospective-sync');
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith(taskId, 'completed', repoRoot);
    expect(existsSync(path.join(activeDir(repoRoot), taskId))).toBe(false);
    expect(existsSync(path.join(activeDir(repoRoot), `${taskId}.completing`))).toBe(false);

    // Deferred marker MUST be written so next activate retries the sync.
    const markerPath = path.join(
      repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'closeout-deferred-retro.json',
    );
    expect(existsSync(markerPath)).toBe(true);
    warnSpy.mockRestore();
  });
});
