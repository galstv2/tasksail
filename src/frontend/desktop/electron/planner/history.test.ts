// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const upsertPlannerHistoryRecord = vi.fn();
const listPlannerHistoryForPack = vi.fn();
const getPlannerHistoryRecord = vi.fn();

// Per-test override for REPO_ROOT, so the staging-path writer targets the
// test's tmpdir instead of the real repo root.
let mockRepoRoot = '/repo';

vi.mock('../../../../backend/platform/planner-history/store.js', () => ({
  upsertPlannerHistoryRecord,
  listPlannerHistoryForPack,
  getPlannerHistoryRecord,
}));

vi.mock('../paths', () => ({
  get REPO_ROOT() { return mockRepoRoot; },
  get DESKTOP_ROOT() { return mockRepoRoot; },
}));

vi.mock('../contextPack/catalog', () => ({
  readWorkspaceSyncStateSnapshot: vi.fn(async () => ({
    activeContextPackDir: '/contextpacks/orders',
    activeContextPackId: 'orders',
  })),
}));

function buildSidecar() {
  return {
    version: 1 as const,
    ownership: 'planner-session' as const,
    sessionId: 'planner-source',
    draftFilename: 'draft.md',
    draftPath: '/repo/AgentWorkSpace/dropbox/.staging/draft.md',
    createdAt: '2026-03-21T04:00:00Z',
    title: 'orders / api',
    primaryRepoId: 'orders-api',
    primaryRepoRoot: '/repos/orders-api',
    primaryFocusRelativePath: 'src/api',
    deepFocusEnabled: true,
    primaryFocusTargetKind: 'directory' as const,
    primaryFocusTargets: [
      { path: 'src/api', kind: 'directory' as const, role: 'anchor' as const },
    ],
    selectedTestTarget: null,
    supportTargets: [],
    lineage: {
      taskKind: 'standard' as const,
      parentTaskId: '',
      rootTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      followUpReason: '',
    },
    contextPackBinding: {
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
      scopeMode: 'focus-selection',
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/api',
      selectedFocusTargetKind: 'directory' as const,
      selectedFocusTargets: [
        { path: 'src/api', kind: 'directory' as const, role: 'anchor' as const },
      ],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  };
}

describe('plannerHistory pending buffer', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRepoRoot = '/repo';
    upsertPlannerHistoryRecord.mockResolvedValue(undefined);
    listPlannerHistoryForPack.mockResolvedValue([]);
    getPlannerHistoryRecord.mockResolvedValue(null);
    const history = await import('./history');
    history.discardPendingRecord();
  });

  it('commits only after finalize and writes the buffered transcript once', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-101', '/contextpacks/orders', buildSidecar());
    history.appendPendingMessage('operator', 'First operator message.', '2026-03-21T04:01:00Z');
    history.appendPendingMessage('planner', 'First planner reply.', '2026-03-21T04:02:00Z');

    expect(upsertPlannerHistoryRecord).not.toHaveBeenCalled();

    await expect(
      history.commitPendingRecordToHistory('/repo/AgentWorkSpace/dropbox/final.md'),
    ).resolves.toEqual(expect.objectContaining({
      id: 'planner-101',
      finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/final.md',
    }));

    expect(upsertPlannerHistoryRecord).toHaveBeenCalledOnce();
    const { record } = upsertPlannerHistoryRecord.mock.calls[0]![0] as { record: { transcript: unknown[]; createdAt: string } };
    expect(record.transcript).toEqual([
      expect.objectContaining({ role: 'operator', text: 'First operator message.' }),
      expect.objectContaining({ role: 'planner', text: 'First planner reply.' }),
    ]);
    expect(record.createdAt).not.toBe('2026-03-21T04:00:00Z');
  });

  it('writes a planner focus snapshot envelope to the staging directory keyed by taskId', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'planner-history-'));
    mockRepoRoot = tmpRoot;
    try {
      const history = await import('./history');
      history.beginPendingRecord('planner-105', '/contextpacks/orders', buildSidecar());
      const finalPath = join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'final.md');

      await history.commitPendingRecordToHistory(finalPath);

      // Sibling write must NOT happen.
      expect(() => readFileSync(join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'final.planner-focus-snapshot.json'), 'utf-8')).toThrow();

      const stagingPath = join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'final', 'planner-focus-snapshot.json');
      const envelope = JSON.parse(readFileSync(stagingPath, 'utf-8'));
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.bindingKey).toBe('final');
      expect(typeof envelope.stagedAt).toBe('string');
      expect(envelope.markdownDestination).toBe(finalPath);
      const snapshot = envelope.snapshot;
      expect(snapshot).toEqual(expect.objectContaining({
        version: 1,
        contextPackDir: '/contextpacks/orders',
        contextPackId: 'orders',
        title: 'orders / api',
        primaryRepoId: 'orders-api',
        primaryRepoRoot: '/repos/orders-api',
        primaryFocusRelativePath: 'src/api',
        primaryFocusTargetKind: 'directory',
        deepFocusEnabled: true,
        contextPackBinding: expect.objectContaining({
          contextPackDir: '/contextpacks/orders',
          selectedFocusPath: 'src/api',
        }),
      }));
      expect(snapshot.primaryFocusTargets).toEqual([
        { path: 'src/api', kind: 'directory', role: 'anchor' },
      ]);
      expect(snapshot).not.toHaveProperty('sessionId');
      expect(snapshot).not.toHaveProperty('draftFilename');
      expect(snapshot).not.toHaveProperty('draftPath');
      expect(snapshot).not.toHaveProperty('createdAt');
      expect(snapshot).not.toHaveProperty('ownership');
      expect(snapshot).not.toHaveProperty('lineage');
      expect(snapshot).not.toHaveProperty('transcript');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('does not fail finalize when planner focus snapshot writing fails', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-106', '/contextpacks/orders', buildSidecar());

    await expect(history.commitPendingRecordToHistory('/missing-parent/final.md')).resolves.toEqual(
      expect.objectContaining({ id: 'planner-106' }),
    );

    expect(upsertPlannerHistoryRecord).toHaveBeenCalledOnce();
  });

  it('discards abandoned sessions without writing a disk record', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-102', '/contextpacks/orders', buildSidecar());
    history.appendPendingMessage('operator', 'Abandoned message.');
    history.discardPendingRecord();

    await expect(history.commitPendingRecordToHistory('/repo/dropbox/final.md')).resolves.toBeNull();
    expect(upsertPlannerHistoryRecord).not.toHaveBeenCalled();
  });

  it('trims transcripts from the head at the 400 message cap', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-103', '/contextpacks/orders', buildSidecar());
    for (let index = 0; index < 405; index += 1) {
      history.appendPendingMessage('operator', `message-${index}`);
    }

    await history.commitPendingRecordToHistory('/repo/dropbox/final.md');

    const { record } = upsertPlannerHistoryRecord.mock.calls[0]![0] as { record: { transcript: Array<{ text: string }> } };
    expect(record.transcript).toHaveLength(400);
    expect(record.transcript[0]?.text).toBe('message-5');
    expect(record.transcript[399]?.text).toBe('message-404');
  });

  it('rejects appended messages whose sessionId does not match the pending buffer', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-current', '/contextpacks/orders', buildSidecar());
    history.appendPendingMessage('operator', 'Live operator message.', '2026-03-21T04:01:00Z', 'planner-current');
    history.appendPendingMessage('planner', 'Stale planner stream message.', '2026-03-21T04:02:00Z', 'planner-stale');
    history.appendPendingMessage('operator', 'Operator with no guard.', '2026-03-21T04:03:00Z');

    await history.commitPendingRecordToHistory('/repo/dropbox/final.md');

    const { record } = upsertPlannerHistoryRecord.mock.calls[0]![0] as {
      record: { transcript: Array<{ text: string; role: string }> };
    };
    expect(record.transcript).toHaveLength(2);
    expect(record.transcript[0]!.text).toBe('Live operator message.');
    expect(record.transcript[1]!.text).toBe('Operator with no guard.');
  });

  it('keeps the pending buffer when history upsert fails so finalize can retry', async () => {
    const history = await import('./history');
    history.beginPendingRecord('planner-104', '/contextpacks/orders', buildSidecar());
    history.appendPendingMessage('operator', 'Retryable message.');
    upsertPlannerHistoryRecord.mockRejectedValueOnce(new Error('disk full'));

    await expect(history.commitPendingRecordToHistory('/repo/dropbox/final.md')).rejects.toThrow('disk full');
    expect(upsertPlannerHistoryRecord).toHaveBeenCalledOnce();

    upsertPlannerHistoryRecord.mockResolvedValueOnce(undefined);
    await expect(history.commitPendingRecordToHistory('/repo/dropbox/final.md')).resolves.toEqual(
      expect.objectContaining({ id: 'planner-104' }),
    );
    expect(upsertPlannerHistoryRecord).toHaveBeenCalledTimes(2);
  });
});
