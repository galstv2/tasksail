import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn(),
}));

vi.mock('../operations.js', () => ({
  completeActiveItem: vi.fn(),
  acquireDirLockOrThrow: vi.fn(),
  activateNextPendingItemIfReady: vi.fn(),
}));

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
}));

vi.mock('../../context-pack/index.js', () => ({
  requireAuthorizedActiveContextPack: vi.fn(),
}));

vi.mock('../retrospectiveFlag.js', () => ({
  syncRetrospectiveRequiredMetadata: vi.fn(),
}));

vi.mock('../errorItems.js', () => ({
  commitTaskSnapshot: vi.fn().mockResolvedValue(true),
}));

vi.mock('../taskRegistry.js', () => ({
  transitionTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(null),
  ADVISORY_FINDING_HEADING: '## Advisory Findings',
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { fileTaskArchive } from '../archive.js';
import {
  completeActiveItem,
  acquireDirLockOrThrow,
  activateNextPendingItemIfReady,
} from '../operations.js';
import { completePendingItem } from '../completePendingItem.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/index.js';
import { syncRetrospectiveRequiredMetadata } from '../retrospectiveFlag.js';
import { commitTaskSnapshot } from '../errorItems.js';
import { finalizeTaskWorktrees } from '../../core/worktreeFinalize.js';

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockFileTaskArchive = vi.mocked(fileTaskArchive);
const mockCompleteActiveItem = vi.mocked(completeActiveItem);
const mockAcquireDirLockOrThrow = vi.mocked(acquireDirLockOrThrow);
const mockActivateNextPendingItemIfReady = vi.mocked(activateNextPendingItemIfReady);
const mockRequireAuthorizedActiveContextPack = vi.mocked(requireAuthorizedActiveContextPack);
const mockSyncRetrospectiveRequiredMetadata = vi.mocked(syncRetrospectiveRequiredMetadata);
const mockCommitTaskSnapshot = vi.mocked(commitTaskSnapshot);
const mockFinalizeTaskWorktrees = vi.mocked(finalizeTaskWorktrees);

const FAKE_TASK_ID = 'test-task-001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a real filesystem fixture: create activeItemsDir + marker + sentinel
 * directories for a given repoRoot & taskId, and return key paths.
 */
function seedSentinelFixture(repoRoot: string, taskId: string) {
  const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
  mkdirSync(activeItemsDir, { recursive: true });
  const markerPath = path.join(activeItemsDir, taskId);
  writeFileSync(markerPath, JSON.stringify({ ts: Date.now() }));
  return {
    activeItemsDir,
    markerPath,
    sentinelPath: path.join(activeItemsDir, `${taskId}.completing`),
  };
}

// ---------------------------------------------------------------------------
// Archive integration tests (using fake/repo with fs mocked for sentinels)
// ---------------------------------------------------------------------------

describe('completePendingItem archive integration', () => {
  let repoRoot: string;
  let mockRelease: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use a real tmp dir so sentinel writeFileSync works.
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-cpi-'));
    seedSentinelFixture(repoRoot, FAKE_TASK_ID);

    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId: FAKE_TASK_ID });
    mockFileTaskArchive.mockResolvedValue({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
    mockCommitTaskSnapshot.mockResolvedValue(true);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('calls archive when skipArchive is not set and the active context pack is authorized', async () => {
    await completePendingItem({
      taskId: FAKE_TASK_ID,
      skipValidation: true,
      repoRoot,
    });

    expect(mockFileTaskArchive).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      taskId: FAKE_TASK_ID,
      repoRoot,
    });
    expect(mockSyncRetrospectiveRequiredMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot,
        contextPackDir: '/packs/pack-a',
      }),
    );
    expect(mockCompleteActiveItem).toHaveBeenCalled();
  });

  it('skips archive when skipArchive is true', async () => {
    await completePendingItem({
      taskId: FAKE_TASK_ID,
      skipValidation: true,
      skipArchive: true,
      repoRoot,
    });

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
    expect(mockCompleteActiveItem).toHaveBeenCalled();
  });

  it('throws when no authorized active context pack is available', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('No active context pack is configured in repo .env. Activate a context pack before running write operations.'),
    );

    await expect(
      completePendingItem({
        taskId: FAKE_TASK_ID,
        skipValidation: true,
        repoRoot,
      }),
    ).rejects.toThrow('No active context pack is configured in repo .env');

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
  });

  it('throws and blocks completion when archive fails', async () => {
    mockFileTaskArchive.mockResolvedValue({
      passed: false,
      stdout: '',
      stderr: 'archive error',
      exitCode: 1,
    });

    await expect(
      completePendingItem({
        taskId: FAKE_TASK_ID,
        skipValidation: true,
        repoRoot,
      }),
    ).rejects.toThrow('Completion blocked: task archival failed');

    expect(mockFinalizeTaskWorktrees).not.toHaveBeenCalled();
  });

  it('throws when queue lock cannot be acquired', async () => {
    mockAcquireDirLockOrThrow.mockRejectedValue(
      new Error('Completion blocked: could not acquire queue lock. Another operation may be in progress.'),
    );

    await expect(
      completePendingItem({
        taskId: FAKE_TASK_ID,
        skipValidation: true,
        repoRoot,
      }),
    ).rejects.toThrow('could not acquire queue lock');

    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });

  it('blocks archival when ACTIVE_CONTEXT_PACK_DIR disagrees with repo .env', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack. Refusing write operation.'),
    );

    await expect(
      completePendingItem({
        taskId: FAKE_TASK_ID,
        skipValidation: true,
        repoRoot,
      }),
    ).rejects.toThrow('ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack');

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §4.3 Sentinel ordering: five-step sequence test via filesystem state probes
// ---------------------------------------------------------------------------

describe('completePendingItem sentinel ordering (five-step test)', () => {
  let repoRoot: string;
  const taskId = 'ordering-task';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-sentinel-order-'));
    seedSentinelFixture(repoRoot, taskId);

    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockCommitTaskSnapshot.mockResolvedValue(true);
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('fires sentinel-write → archival → finalize → marker-delete → sentinel-delete in order', async () => {
    const callOrder: string[] = [];
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    const markerPath = path.join(activeItemsDir, taskId);

    // Verify sentinel exists before archival, and marker exists before finalize.
    mockFileTaskArchive.mockImplementation(async () => {
      // Sentinel MUST exist at archival time (written in step 1 before step 2).
      callOrder.push(existsSync(sentinelPath) ? 'sentinel-before-archival:ok' : 'sentinel-before-archival:MISSING');
      callOrder.push('archival');
      return { passed: true, stdout: '{}', stderr: '', exitCode: 0 };
    });

    mockFinalizeTaskWorktrees.mockImplementation(async () => {
      // Sentinel MUST exist at finalize time (step 3 before sentinel-delete step 5).
      // Marker MUST exist at finalize time (step 3 before marker-delete step 4).
      callOrder.push(existsSync(sentinelPath) ? 'sentinel-before-finalize:ok' : 'sentinel-before-finalize:MISSING');
      callOrder.push(existsSync(markerPath) ? 'marker-before-finalize:ok' : 'marker-before-finalize:MISSING');
      callOrder.push('finalize');
    });

    // completeActiveItem does NOT delete the marker (marker-delete is step 4 in completePendingItem).
    mockCompleteActiveItem.mockImplementation(async () => {
      callOrder.push('completeActiveItem');
      return { status: 'completed' as const, taskId };
    });

    await completePendingItem({ taskId, skipValidation: true, repoRoot });

    // After completion: sentinel and marker must be deleted.
    callOrder.push(existsSync(sentinelPath) ? 'sentinel-after:STILL_EXISTS' : 'sentinel-after:deleted');
    callOrder.push(existsSync(markerPath) ? 'marker-after:STILL_EXISTS' : 'marker-after:deleted');

    // Verify call order of the five observable events.
    expect(callOrder).toContain('sentinel-before-archival:ok');
    expect(callOrder).toContain('archival');
    expect(callOrder).toContain('sentinel-before-finalize:ok');
    expect(callOrder).toContain('marker-before-finalize:ok');
    expect(callOrder).toContain('finalize');
    expect(callOrder).toContain('sentinel-after:deleted');
    expect(callOrder).toContain('marker-after:deleted');

    // Strict ordering assertions via index.
    const idx = (x: string) => callOrder.indexOf(x);
    expect(idx('sentinel-before-archival:ok')).toBeLessThan(idx('archival'));
    expect(idx('archival')).toBeLessThan(idx('finalize'));
    expect(idx('finalize')).toBeLessThan(idx('sentinel-after:deleted'));
    // completeActiveItem (which resets handoffs) runs after archival.
    expect(idx('archival')).toBeLessThan(idx('completeActiveItem'));
  });
});

// ---------------------------------------------------------------------------
// F9: completeActiveItem returns { status: 'no-active-marker', taskId }
// ---------------------------------------------------------------------------

describe('completeActiveItem F9 — no-active-marker (real module)', () => {
  it('returns { status: no-active-marker, taskId } when marker is absent', async () => {
    // Import the real (un-mocked) function.
    const { completeActiveItem: realCompleteActiveItem } =
      await vi.importActual<typeof import('../operations.js')>('../operations.js');

    const tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-f9-'));
    try {
      const pendingDir = path.join(tmpDir, 'pending');
      const handoffsDir = path.join(tmpDir, 'handoffs');
      const templatesDir = path.join(tmpDir, 'templates');
      const activeItemsDir = path.join(pendingDir, '.active-items');
      mkdirSync(activeItemsDir, { recursive: true });
      mkdirSync(handoffsDir, { recursive: true });
      mkdirSync(templatesDir, { recursive: true });
      // No marker written — marker is absent.

      const result = await realCompleteActiveItem({
        pendingDir,
        taskId: 'missing-task',
        handoffsDir,
        templatesDir,
      });

      expect(result).toEqual({ status: 'no-active-marker', taskId: 'missing-task' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Crash-recovery: mid-archival
// ---------------------------------------------------------------------------

describe('completePendingItem crash-recovery: mid-archival', () => {
  let repoRoot: string;
  const taskId = 'crash-archival-task';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-crash-arch-'));
    seedSentinelFixture(repoRoot, taskId);
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockCommitTaskSnapshot.mockResolvedValue(true);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);
    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId });
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('sentinel and marker survive crash mid-archival; re-drive completes idempotently', async () => {
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    const markerPath = path.join(activeItemsDir, taskId);

    // First run: archive fails (simulates crash mid-archival).
    mockFileTaskArchive.mockRejectedValue(new Error('Crash during archival'));

    await expect(
      completePendingItem({ taskId, skipValidation: true, repoRoot }),
    ).rejects.toThrow('Crash during archival');

    // Both sentinel and marker must survive the crash (written before archival).
    expect(existsSync(sentinelPath)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);

    // Re-drive: archive succeeds.
    mockFileTaskArchive.mockResolvedValue({ passed: true, stdout: '{}', stderr: '', exitCode: 0 });

    await completePendingItem({ taskId, skipValidation: true, repoRoot });

    // After successful re-drive, sentinel and marker must be gone.
    expect(existsSync(sentinelPath)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith(taskId, 'completed', repoRoot);
  });
});

// ---------------------------------------------------------------------------
// Crash-recovery: mid-finalize
// ---------------------------------------------------------------------------

describe('completePendingItem crash-recovery: mid-finalize', () => {
  let repoRoot: string;
  const taskId = 'crash-finalize-task';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-crash-fin-'));
    seedSentinelFixture(repoRoot, taskId);
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockFileTaskArchive.mockResolvedValue({ passed: true, stdout: '{}', stderr: '', exitCode: 0 });
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockCommitTaskSnapshot.mockResolvedValue(true);
    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId });
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('sentinel and marker survive crash mid-finalize; re-drive finalize idempotently', async () => {
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    const markerPath = path.join(activeItemsDir, taskId);

    // First run: finalize throws.
    mockFinalizeTaskWorktrees.mockRejectedValue(new Error('Crash during finalize'));

    await expect(
      completePendingItem({ taskId, skipValidation: true, repoRoot }),
    ).rejects.toThrow('Crash during finalize');

    // Sentinel must survive; marker survives because finalize is step 3, marker-delete is step 4.
    expect(existsSync(sentinelPath)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);

    // Re-drive: finalize succeeds.
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    await completePendingItem({ taskId, skipValidation: true, repoRoot });

    expect(existsSync(sentinelPath)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
    // finalize called once per run.
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Crash-recovery: between marker-delete and sentinel-delete
// ---------------------------------------------------------------------------

describe('completePendingItem crash-recovery: sentinel-without-marker', () => {
  let repoRoot: string;
  const taskId = 'crash-between-task';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-crash-btw-'));
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockFileTaskArchive.mockResolvedValue({ passed: true, stdout: '{}', stderr: '', exitCode: 0 });
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockCommitTaskSnapshot.mockResolvedValue(true);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('recovery with sentinel-without-marker: finalize NOT re-driven; sentinel unlinked', async () => {
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    // State after crash between step 4 (marker deleted) and step 5 (sentinel deleted):
    // sentinel present, marker absent.
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    writeFileSync(sentinelPath, JSON.stringify({ ts: Date.now() }));
    // marker is absent.

    // completeActiveItem sees absent marker → returns no-active-marker.
    mockCompleteActiveItem.mockResolvedValue({ status: 'no-active-marker', taskId });

    await completePendingItem({ taskId, skipValidation: true, repoRoot, skipArchive: true });

    // Sentinel must be deleted.
    expect(existsSync(sentinelPath)).toBe(false);
    // finalize must NOT be re-driven when completeActiveItem returned no-active-marker.
    expect(mockFinalizeTaskWorktrees).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F38: idempotent snapshot
// ---------------------------------------------------------------------------

describe('completePendingItem F38 — idempotent snapshot', () => {
  let repoRoot: string;
  const taskId = 'snapshot-task';

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-snapshot-'));
    seedSentinelFixture(repoRoot, taskId);
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockFileTaskArchive.mockResolvedValue({ passed: true, stdout: '{}', stderr: '', exitCode: 0 });
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    mockActivateNextPendingItemIfReady.mockResolvedValue({ activated: false, reason: 'no-pending-items' });
    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId });
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('commitTaskSnapshot called each drive; false return treated as success (not thrown)', async () => {
    // First drive: snapshot returns true (changes committed).
    mockCommitTaskSnapshot.mockResolvedValue(true);
    await completePendingItem({ taskId, skipValidation: true, repoRoot, skipArchive: true });
    expect(mockCommitTaskSnapshot).toHaveBeenCalledWith(repoRoot, taskId, 'completed');

    // Recreate marker for second drive.
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(activeItemsDir, taskId), JSON.stringify({ ts: Date.now() }));

    // Second drive: snapshot returns false ("nothing to commit") — must be treated as success.
    mockCommitTaskSnapshot.mockResolvedValue(false);
    mockCompleteActiveItem.mockResolvedValue({ status: 'completed', taskId });

    await expect(
      completePendingItem({ taskId, skipValidation: true, repoRoot, skipArchive: true }),
    ).resolves.toBeUndefined();

    expect(mockCommitTaskSnapshot).toHaveBeenCalledTimes(2);
  });
});
