import path from 'node:path';
import os from 'node:os';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePlannerHistoryPath } from '../paths.js';
import {
  getPlannerHistoryRecord,
  listPlannerHistoryForPack,
  readPlannerHistory,
  upsertPlannerHistoryRecord,
} from '../store.js';
import {
  PlannerHistoryValidationError,
  TRANSCRIPT_MESSAGE_CAP,
  type PlannerConversationRecord,
  type PlannerStagingSidecar,
} from '../types.js';

describe('planner conversation history store', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(os.tmpdir(), 'planner-history-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('resolves the normalized absolute history path without creating the file', () => {
    const historyPath = resolvePlannerHistoryPath(path.join(repoRoot, '.'));

    expect(historyPath).toBe(path.normalize(path.join(repoRoot, '.platform-state', 'planner-conversation-history.json')));
    expect(path.isAbsolute(historyPath)).toBe(true);
    expect(existsSync(historyPath)).toBe(false);
  });

  it('returns the empty version 1 shape when the file is missing', async () => {
    await expect(readPlannerHistory({ repoRoot })).resolves.toEqual({
      version: 1,
      conversationsByContextPackDir: {},
    });
  });

  it('inserts beyond cap and evicts the oldest record by createdAt', async () => {
    const contextPackDir = contextPackPath('cap-pack');

    for (let index = 0; index < 11; index += 1) {
      await upsertPlannerHistoryRecord({
        repoRoot,
        record: recordFixture({
          id: `record-${index}`,
          contextPackDir,
          createdAt: isoMinute(index),
        }),
      });
    }

    const records = await listPlannerHistoryForPack({ repoRoot, contextPackDir });
    expect(records).toHaveLength(10);
    expect(records.map((record) => record.id)).toEqual([
      'record-10',
      'record-9',
      'record-8',
      'record-7',
      'record-6',
      'record-5',
      'record-4',
      'record-3',
      'record-2',
      'record-1',
    ]);
  });

  it('replaces the same id while preserving the original createdAt', async () => {
    const contextPackDir = contextPackPath('replace-pack');
    await upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({
        id: 'same-id',
        title: 'Original title',
        contextPackDir,
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    });

    await upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({
        id: 'same-id',
        title: 'Replacement title',
        contextPackDir,
        createdAt: '2025-01-02T00:00:00.000Z',
        transcript: [messageFixture({ id: 'replacement-message' })],
      }),
    });

    const record = await getPlannerHistoryRecord({
      repoRoot,
      contextPackDir,
      recordId: 'same-id',
    });
    expect(record).toMatchObject({
      id: 'same-id',
      title: 'Replacement title',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(record?.transcript).toEqual([messageFixture({ id: 'replacement-message' })]);
  });

  it('writes atomically and leaves no tmp file behind on success', async () => {
    const contextPackDir = contextPackPath('atomic-pack');

    await upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({ contextPackDir }),
    });

    const historyPath = resolvePlannerHistoryPath(repoRoot);
    expect(existsSync(historyPath)).toBe(true);
    expect(existsSync(`${historyPath}.tmp`)).toBe(false);
    expect(readdirSync(path.dirname(historyPath)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('throws on corrupt JSON without silently overwriting it', async () => {
    const historyPath = resolvePlannerHistoryPath(repoRoot);
    mkdirSync(path.dirname(historyPath), { recursive: true });
    writeFileSync(historyPath, '{not-json', 'utf-8');

    await expect(readPlannerHistory({ repoRoot })).rejects.toThrow(/Invalid JSON/);
    await expect(upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({ contextPackDir: contextPackPath('corrupt-pack') }),
    })).rejects.toThrow(/Invalid JSON/);
    expect(existsSync(`${historyPath}.tmp`)).toBe(false);
  });

  it('rejects records with transcripts longer than the cap with a typed error', async () => {
    const transcript = Array.from({ length: TRANSCRIPT_MESSAGE_CAP + 1 }, (_value, index) => (
      messageFixture({ id: `message-${index}` })
    ));

    await expect(upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({
        contextPackDir: contextPackPath('oversized-pack'),
        transcript,
      }),
    })).rejects.toBeInstanceOf(PlannerHistoryValidationError);

    await expect(readPlannerHistory({ repoRoot })).resolves.toEqual({
      version: 1,
      conversationsByContextPackDir: {},
    });
  });

  it('uses exact context-pack-dir matches before contextPackId fallback records', async () => {
    const exactDir = contextPackPath('current-pack');
    const renamedDir = contextPackPath('renamed-pack');

    await upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({
        id: 'fallback-record',
        contextPackDir: renamedDir,
        contextPackId: 'shared-pack-id',
        createdAt: '2025-01-03T00:00:00.000Z',
      }),
    });
    await upsertPlannerHistoryRecord({
      repoRoot,
      record: recordFixture({
        id: 'exact-record',
        contextPackDir: exactDir,
        contextPackId: 'shared-pack-id',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    });

    await expect(listPlannerHistoryForPack({
      repoRoot,
      contextPackDir: exactDir,
      contextPackId: 'shared-pack-id',
    })).resolves.toMatchObject([{ id: 'exact-record' }]);

    await expect(listPlannerHistoryForPack({
      repoRoot,
      contextPackDir: contextPackPath('missing-current-pack'),
      contextPackId: 'shared-pack-id',
    })).resolves.toMatchObject([
      { id: 'fallback-record' },
      { id: 'exact-record' },
    ]);
  });

  function contextPackPath(name: string): string {
    return path.join(repoRoot, 'contextpacks', name);
  }
});

function recordFixture(overrides: Partial<PlannerConversationRecord> = {}): PlannerConversationRecord {
  const contextPackDir = overrides.contextPackDir ?? path.join(process.cwd(), 'contextpacks', 'default-pack');
  const contextPackId = overrides.contextPackId ?? path.basename(contextPackDir);
  const id = overrides.id ?? 'record-1';
  const title = overrides.title ?? 'Planner conversation';
  return {
    id,
    contextPackDir,
    contextPackId,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    title,
    finalizedDestinationPath: overrides.finalizedDestinationPath ?? path.join(contextPackDir, 'dropbox', `${id}.md`),
    sidecarSnapshot: overrides.sidecarSnapshot ?? sidecarFixture({
      sessionId: id,
      title,
      contextPackDir,
      contextPackId,
    }),
    transcript: overrides.transcript ?? [messageFixture()],
  };
}

function sidecarFixture(overrides: {
  sessionId: string;
  title: string;
  contextPackDir: string;
  contextPackId: string;
}): PlannerStagingSidecar {
  return {
    version: 1,
    ownership: 'planner-session',
    sessionId: overrides.sessionId,
    draftFilename: `${overrides.sessionId}.md`,
    draftPath: path.join(overrides.contextPackDir, '.staging', `${overrides.sessionId}.md`),
    createdAt: '2025-01-01T00:00:00.000Z',
    title: overrides.title,
    primaryRepoId: 'primary-repo',
    primaryRepoRoot: path.join(overrides.contextPackDir, 'repo'),
    primaryFocusRelativePath: null,
    deepFocusEnabled: false,
    primaryFocusTargetKind: null,
    primaryFocusTargets: [],
    selectedTestTarget: null,
    supportTargets: [],
    lineage: {
      taskKind: 'standard',
      parentTaskId: '',
      rootTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      followUpReason: '',
    },
    contextPackBinding: {
      contextPackDir: overrides.contextPackDir,
      contextPackId: overrides.contextPackId,
      scopeMode: 'context-pack',
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  };
}

function messageFixture(overrides: Partial<PlannerConversationRecord['transcript'][number]> = {}) {
  return {
    id: overrides.id ?? 'message-1',
    role: overrides.role ?? 'operator',
    text: overrides.text ?? 'Please plan the work.',
    timestamp: overrides.timestamp ?? '2025-01-01T00:00:00.000Z',
  };
}

function isoMinute(minute: number): string {
  return `2025-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`;
}
