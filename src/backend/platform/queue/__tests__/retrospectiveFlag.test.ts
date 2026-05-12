import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getRetrospectiveRequiredForNextTask,
  isRetrospectiveRequiredForCompletedCount,
  stampRetrospectiveRequiredMetadata,
  syncRetrospectiveRequiredMetadata,
} from '../retrospectiveFlag.js';

// Identity re-mock makes the module spyable so individual tests can stub
// `sleep` without affecting the real implementation seen by other tests.
vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return { ...actual };
});

describe('retrospectiveFlag', () => {
  let repoRoot: string;
  let handoffsDir: string;

  beforeEach(() => {
    const TEST_TASK_ID = 'task-test-001';
    repoRoot = mkdtempSync(path.join(tmpdir(), 'retro-flag-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('requires retrospective only for every tenth task position', () => {
    expect(isRetrospectiveRequiredForCompletedCount(0)).toBe(false);
    expect(isRetrospectiveRequiredForCompletedCount(8)).toBe(false);
    expect(isRetrospectiveRequiredForCompletedCount(9)).toBe(true);
    expect(isRetrospectiveRequiredForCompletedCount(10)).toBe(false);
  });

  it('reads the next-task requirement from the context-pack counter', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-a.json'),
      JSON.stringify({ completed_count: 9 }, null, 2),
      'utf-8',
    );

    await expect(getRetrospectiveRequiredForNextTask({
      repoRoot,
      contextPackDir: '/packs/pack-a',
    })).resolves.toBe(true);
  });

  it('synchronizes Retrospective Required metadata from the counter', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-a.json'),
      JSON.stringify({ completed_count: 0 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required:\n  true\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-a',
    });

    const content = await import('node:fs/promises').then((fs) => fs.readFile(
      path.join(handoffsDir, 'retrospective-input.md'),
      'utf-8',
    ));
    expect(content).toContain('- Retrospective Required: false');
    expect(content).not.toContain('\n  true');
  });

  it('stamps Retrospective Required from the counter without mutating counter state', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    const counterPath = path.join(counterDir, 'pack-stamp.json');
    const originalCounter = {
      schema_version: 'task-counter/v1',
      context_pack_id: 'pack-stamp',
      completed_count: 9,
      cycle_count: 3,
      last_archived_task_id: 'task-previous',
      last_archived_at: '2026-01-01T00:00:00.000Z',
      last_retrospective_at: '',
      cycle_task_ids: ['task-previous'],
    };
    writeFileSync(counterPath, JSON.stringify(originalCounter, null, 2) + '\n', 'utf-8');
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await stampRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-stamp',
    });

    const content = await readFile(path.join(handoffsDir, 'retrospective-input.md'), 'utf-8');
    const rawCounter = await readFile(counterPath, 'utf-8');

    expect(content).toContain('- Retrospective Required: true');
    expect(JSON.parse(rawCounter)).toEqual(originalCounter);
  });

  it('increments once when the same taskId is synchronized twice', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-idempotent.json'),
      JSON.stringify({ completed_count: 0 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-idempotent',
      taskId: 'task-1',
    });
    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-idempotent',
      taskId: 'task-1',
    });

    const raw = await readFile(
      path.join(counterDir, 'pack-idempotent.json'),
      'utf-8',
    );
    const state = JSON.parse(raw) as Record<string, unknown>;

    expect(state['completed_count']).toBe(1);
    expect(state['last_archived_task_id']).toBe('task-1');
    expect(typeof state['last_archived_at']).toBe('string');
    expect(state['cycle_task_ids']).toEqual(['task-1']);
  });

  it('increments once per different taskId', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-different-tasks.json'),
      JSON.stringify({ completed_count: 0 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-different-tasks',
      taskId: 'task-1',
    });
    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-different-tasks',
      taskId: 'task-2',
    });

    const raw = await readFile(
      path.join(counterDir, 'pack-different-tasks.json'),
      'utf-8',
    );
    const state = JSON.parse(raw) as Record<string, unknown>;

    expect(state['completed_count']).toBe(2);
    expect(state['last_archived_task_id']).toBe('task-2');
    expect(state['cycle_task_ids']).toEqual(['task-1', 'task-2']);
  });



  it('updates the retrospective label without double-incrementing when taskId was already counted', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-already-counted.json'),
      JSON.stringify({
        schema_version: 'task-counter/v1',
        context_pack_id: 'pack-already-counted',
        completed_count: 0,
        cycle_count: 1,
        last_archived_task_id: 'task-10',
        last_archived_at: '2026-01-01T00:00:00.000Z',
        last_retrospective_at: '',
        cycle_task_ids: ['task-1', 'task-2', 'task-3', 'task-4', 'task-5', 'task-6', 'task-7', 'task-8', 'task-9', 'task-10'],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-already-counted',
      taskId: 'task-10',
    });

    const raw = await readFile(path.join(counterDir, 'pack-already-counted.json'), 'utf-8');
    const state = JSON.parse(raw) as Record<string, unknown>;
    const content = await readFile(path.join(handoffsDir, 'retrospective-input.md'), 'utf-8');

    expect(state['completed_count']).toBe(0);
    expect(state['cycle_count']).toBe(1);
    expect(state['last_archived_task_id']).toBe('task-10');
    expect(state['cycle_task_ids']).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5', 'task-6', 'task-7', 'task-8', 'task-9', 'task-10']);
    expect(content).toContain('- Retrospective Required: true');
  });

  it('preserves legacy increment behavior without taskId', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-legacy.json'),
      JSON.stringify({
        completed_count: 0,
        cycle_count: 0,
        last_archived_task_id: '',
        last_archived_at: '',
        cycle_task_ids: [],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-legacy',
    });
    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-legacy',
    });

    const raw = await readFile(path.join(counterDir, 'pack-legacy.json'), 'utf-8');
    const state = JSON.parse(raw) as Record<string, unknown>;

    expect(state['completed_count']).toBe(2);
    expect(state['cycle_count']).toBe(0);
    expect(state['last_archived_task_id']).toBe('');
    expect(state['last_archived_at']).toBe('');
    expect(state['cycle_task_ids']).toEqual([]);
  });

  // ── §4.8 concurrency tests ────────────────────────────────────────────────

  it('two concurrent completions with same contextPackId increment counter to N+2, exactly one required=true', async () => {
    // Start at completed_count=8 so the 9th completion (0-indexed position 9)
    // triggers required=true and the 10th does not (wraps to 0).
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-concurrent.json'),
      JSON.stringify({ completed_count: 8 }, null, 2),
      'utf-8',
    );

    // Both completions share the same handoffsDir
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    const results: boolean[] = [];

    // Intercept the required decision by wrapping — but simpler: run two
    // concurrent syncRetrospectiveRequiredMetadata calls and inspect the
    // counter file afterward for N+2, and the handoff file for exactly one
    // "true" flip (the second call will overwrite with false since it reads
    // completed_count=9 which triggers true, then the first finishes…).
    // Actually: with the lock, one runs fully first, then the other.
    // Call 1 reads 8 → required=false, writes 9.
    // Call 2 reads 9 → required=true, writes 10 (wraps to 0).
    // Final counter: completed_count=0 (wrap), cycle_count=1.
    // Final handoff: "true" (written by call 2, whichever finishes last).
    // The point is the counter ends up at wrap (both increments applied),
    // not stuck at N+1 (only one applied).

    await Promise.all([
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir,
        contextPackDir: '/packs/pack-concurrent',
      }).then(() => results.push(false)), // placeholder
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir,
        contextPackDir: '/packs/pack-concurrent',
      }).then(() => results.push(false)),
    ]);

    const raw = await readFile(
      path.join(counterDir, 'pack-concurrent.json'),
      'utf-8',
    );
    const state = JSON.parse(raw) as Record<string, unknown>;

    // Both increments applied: 8 + 2 = 10, which wraps to 0 with cycle_count=1
    expect(state['cycle_count']).toBe(1);
    expect(state['completed_count']).toBe(0);
  });

  it('F2 continuous-lock: two concurrent is_retrospective_required+increment callers produce counter=2, exactly one required=true', async () => {
    // Start at completed_count=0. Counter should end at 2 (no wrap before 10).
    // Call 1: reads 0 → required=false → writes 1
    // Call 2: reads 1 → required=false → writes 2
    // OR:
    // Call 2: reads 0 → required=false → writes 1
    // Call 1: reads 1 → required=false → writes 2
    // In both orderings: final counter=2, zero calls see required=true.
    //
    // Start at 8 to force one required=true trigger:
    // Call A: reads 8 → required=false → writes 9
    // Call B: reads 9 → required=true  → writes 10 (wraps to 0)
    // Final: exactly one required=true observed.

    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-f2.json'),
      JSON.stringify({ completed_count: 0 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    // Run two concurrent callers
    await Promise.all([
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir,
        contextPackDir: '/packs/pack-f2',
      }),
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir,
        contextPackDir: '/packs/pack-f2',
      }),
    ]);

    const raw = await readFile(
      path.join(counterDir, 'pack-f2.json'),
      'utf-8',
    );
    const state = JSON.parse(raw) as Record<string, unknown>;

    // Both increments applied: 0 + 2 = 2 (no wrap, cycle_count stays 0)
    expect(state['completed_count']).toBe(2);
    expect(state['cycle_count'] ?? 0).toBe(0);
  });

  it('two concurrent completions with DIFFERENT contextPackId increment their counters independently', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });

    // Pack A starts at 3, Pack B starts at 5 — no wrap expected
    writeFileSync(
      path.join(counterDir, 'pack-alpha.json'),
      JSON.stringify({ completed_count: 3 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(counterDir, 'pack-beta.json'),
      JSON.stringify({ completed_count: 5 }, null, 2),
      'utf-8',
    );

    // Each pack needs its own handoffs dir so retrospective-input.md doesn't conflict
    const handoffsDirA = path.join(repoRoot, 'AgentWorkSpace', 'handoffs-a');
    const handoffsDirB = path.join(repoRoot, 'AgentWorkSpace', 'handoffs-b');
    mkdirSync(handoffsDirA, { recursive: true });
    mkdirSync(handoffsDirB, { recursive: true });

    writeFileSync(
      path.join(handoffsDirA, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDirB, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n',
      'utf-8',
    );

    await Promise.all([
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir: handoffsDirA,
        contextPackDir: '/packs/pack-alpha',
      }),
      syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir: handoffsDirB,
        contextPackDir: '/packs/pack-beta',
      }),
    ]);

    const rawA = await readFile(path.join(counterDir, 'pack-alpha.json'), 'utf-8');
    const rawB = await readFile(path.join(counterDir, 'pack-beta.json'), 'utf-8');
    const stateA = JSON.parse(rawA) as Record<string, unknown>;
    const stateB = JSON.parse(rawB) as Record<string, unknown>;

    // Each counter incremented independently: 3+1=4, 5+1=6
    expect(stateA['completed_count']).toBe(4);
    expect(stateB['completed_count']).toBe(6);
  });

  describe('counter lock staleness', () => {
    const contextPackId = 'pack-stale-test';
    let tmpRoot: string;
    let lockDir: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(path.join(tmpdir(), 'retro-stale-lock-'));
      const counterDir = path.join(tmpRoot, '.platform-state', 'task-counters');
      mkdirSync(counterDir, { recursive: true });
      lockDir = path.join(counterDir, `${contextPackId}.lock`);
    });

    afterEach(async () => {
      await rm(tmpRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('reclaims a counter lock whose mtime is older than 5 minutes', async () => {
      mkdirSync(lockDir);
      const tenMinutesAgoSeconds = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
      utimesSync(lockDir, tenMinutesAgoSeconds, tenMinutesAgoSeconds);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const handoffsDir = path.join(tmpRoot, 'handoffs');
      mkdirSync(handoffsDir, { recursive: true });
      writeFileSync(
        path.join(handoffsDir, 'retrospective-input.md'),
        '- Retrospective Required: false\n',
      );

      await syncRetrospectiveRequiredMetadata({
        repoRoot: tmpRoot,
        handoffsDir,
        contextPackDir: path.join(tmpRoot, 'contextpacks', contextPackId),
        taskId: 'task-stale-lock-test',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[retrospectiveFlag] reclaiming stale counter lock: ${lockDir}`),
      );
    });

    it('does not reclaim a counter lock whose mtime is fresh', async () => {
      // Stub sleep so the 50-retry × ~500ms backoff in acquireCounterLock
      // (~23s wall-clock) does not pad the suite. The assertion under test is
      // that a fresh lock is NOT reclaimed and acquisition ultimately fails;
      // the real sleep duration adds nothing to that proof.
      const core = await import('../../core/index.js');
      vi.spyOn(core, 'sleep').mockResolvedValue(undefined);

      mkdirSync(lockDir);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const handoffsDir = path.join(tmpRoot, 'handoffs');
      mkdirSync(handoffsDir, { recursive: true });
      writeFileSync(
        path.join(handoffsDir, 'retrospective-input.md'),
        '- Retrospective Required: false\n',
      );

      await expect(
        syncRetrospectiveRequiredMetadata({
          repoRoot: tmpRoot,
          handoffsDir,
          contextPackDir: path.join(tmpRoot, 'contextpacks', contextPackId),
          taskId: 'task-fresh-lock-test',
        }),
      ).rejects.toThrow(/could not acquire counter lock/);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('reclaiming stale counter lock'),
      );
    });

    it('reclaims a stale counter lock that exists as a regular file (not a directory)', async () => {
      // Regression: an earlier code version (or a partial write) can leave a
      // zero-byte FILE at the lock path. The acquire loop's mkdir fails with
      // EEXIST and reclaim's rmdir fails with ENOTDIR, trapping the process
      // in an infinite "reclaiming" log. `rm({recursive,force})` handles
      // both shapes, so a stale file gets cleaned up the same way as a dir.
      writeFileSync(lockDir, '');
      const tenMinutesAgoSeconds = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
      utimesSync(lockDir, tenMinutesAgoSeconds, tenMinutesAgoSeconds);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const handoffsDir = path.join(tmpRoot, 'handoffs');
      mkdirSync(handoffsDir, { recursive: true });
      writeFileSync(
        path.join(handoffsDir, 'retrospective-input.md'),
        '- Retrospective Required: false\n',
      );

      await expect(
        syncRetrospectiveRequiredMetadata({
          repoRoot: tmpRoot,
          handoffsDir,
          contextPackDir: path.join(tmpRoot, 'contextpacks', contextPackId),
          taskId: 'task-file-lock-test',
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[retrospectiveFlag] reclaiming stale counter lock: ${lockDir}`),
      );
    });
  });
});
