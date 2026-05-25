import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import {
  ACTIVATION_PROGRESS_PHASES,
  clearActivationProgress,
  listActivationProgressMarkerFileNames,
  readActivationProgressRecord,
  readActivationProgressRecords,
  sweepActivationProgressMarkers,
  writeActivationProgress,
} from '../activationProgress.js';
import { resolveQueuePaths } from '../paths.js';

describe('activation progress markers', () => {
  let repoRoot: string;
  let paths: ReturnType<typeof resolveQueuePaths>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'activation-progress-'));
    paths = resolveQueuePaths(repoRoot);
    mkdirSync(paths.pendingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes atomically and reads valid records', async () => {
    const record = await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: 'Task A',
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:01Z',
    });

    expect(record).toMatchObject({
      schemaVersion: 1,
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: 'Task A',
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:01Z',
    });
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(true);
    expect(readFileSync(path.join(paths.activatingItemsDir, 'task-a.json'), 'utf-8')).toContain('"schemaVersion": 1');
    await expect(readActivationProgressRecord(paths, 'task-a')).resolves.toEqual(record);
    await expect(readActivationProgressRecords(paths)).resolves.toEqual([record]);
  });

  it('accepts exactly the supported phases', async () => {
    for (const phase of ACTIVATION_PROGRESS_PHASES) {
      await writeActivationProgress(paths, {
        taskId: `task-${phase}`,
        queueName: `task-${phase}.md`,
        title: null,
        phase,
        startedAt: '2026-05-23T10:00:00Z',
      });
    }

    const records = await readActivationProgressRecords(paths);
    expect(records.map((record) => record.phase).sort()).toEqual([...ACTIVATION_PROGRESS_PHASES].sort());
  });

  it('rejects invalid records before writing', async () => {
    const base = {
      queueName: 'task-a.md',
      title: null,
      phase: 'claimed' as const,
      startedAt: '2026-05-23T10:00:00Z',
    };
    await expect(writeActivationProgress(paths, { ...base, taskId: '' }))
      .rejects.toThrow('invalid activation progress record');
    await expect(writeActivationProgress(paths, { ...base, taskId: '../task' }))
      .rejects.toThrow('invalid activation progress record');
    await expect(writeActivationProgress(paths, { ...base, taskId: 'nested/task' }))
      .rejects.toThrow('invalid activation progress record');
    await expect(writeActivationProgress(paths, { ...base, taskId: '.task-a' }))
      .rejects.toThrow('invalid activation progress record');

    await expect(writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: '../task-a.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
    })).rejects.toThrow('invalid activation progress record');

    await expect(writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'unknown' as never,
      startedAt: '2026-05-23T10:00:00Z',
    })).rejects.toThrow('invalid activation progress record');
  });

  it('ignores marker body and filename identity mismatches', async () => {
    mkdirSync(paths.activatingItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activatingItemsDir, 'task-a.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'task-b',
      queueName: 'task-b.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:00Z',
    }), 'utf-8');

    await expect(readActivationProgressRecords(paths)).resolves.toEqual([]);
    await expect(readActivationProgressRecord(paths, 'task-a')).resolves.toBeNull();
  });

  it('lists only safe marker filenames with valid task-id stems', async () => {
    mkdirSync(paths.activatingItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activatingItemsDir, 'task-a.json'), '{}', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, '.hidden.json'), '{}', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, 'nested-task.txt'), '{}', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, 'bad task.json'), '{}', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, '-bad.json'), '{}', 'utf-8');

    await expect(listActivationProgressMarkerFileNames(paths)).resolves.toEqual(['task-a.json']);
  });

  it('ignores malformed markers during reads', async () => {
    mkdirSync(paths.activatingItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activatingItemsDir, 'bad.json'), '{bad json', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, 'wrong.json'), JSON.stringify({
      schemaVersion: 2,
      taskId: 'wrong',
      queueName: 'wrong.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:00Z',
    }), 'utf-8');
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'validating',
      startedAt: '2026-05-23T10:00:00Z',
    });

    const records = await readActivationProgressRecords(paths);
    expect(records.map((record) => record.taskId)).toEqual(['task-a']);
  });

  it('clears one marker idempotently without touching peers', async () => {
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
    });
    await writeActivationProgress(paths, {
      taskId: 'task-b',
      queueName: 'task-b.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
    });

    await clearActivationProgress(paths, 'task-a');
    await clearActivationProgress(paths, 'task-a');

    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(false);
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-b.json'))).toBe(true);
  });

  it('sweeps markers without mutating pending markdown or active markers', async () => {
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n', 'utf-8');
    writeFileSync(path.join(paths.activeItemsDir, 'task-a'), 'task-a.md', 'utf-8');
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'materializing-worktree',
      startedAt: '2026-05-23T10:00:00Z',
    });
    writeFileSync(path.join(paths.activatingItemsDir, 'malformed.json'), '{bad', 'utf-8');

    const result = await sweepActivationProgressMarkers({
      paths,
      repoRoot,
      reason: 'startup-recovery',
    });

    expect(result.removed.sort()).toEqual(['malformed.json', 'task-a']);
    expect(result.ignoredMalformed).toEqual(['malformed.json']);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
    expect(existsSync(path.join(paths.activeItemsDir, 'task-a'))).toBe(true);
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(false);
  });

  it('does not path-join unvalidated sweep names outside .activating-items', async () => {
    mkdirSync(paths.activatingItemsDir, { recursive: true });
    const outsidePath = path.join(paths.pendingDir, 'outside.json');
    writeFileSync(outsidePath, 'outside', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, '..%2foutside.json'), '{}', 'utf-8');
    writeFileSync(path.join(paths.activatingItemsDir, 'task-a.json'), '{bad', 'utf-8');

    const result = await sweepActivationProgressMarkers({
      paths,
      repoRoot,
      reason: 'repair-auto-fix',
    });

    expect(result.removed).toEqual(['task-a.json']);
    expect(readFileSync(outsidePath, 'utf-8')).toBe('outside');
    expect(existsSync(path.join(paths.activatingItemsDir, '..%2foutside.json'))).toBe(true);
  });
});
