import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION,
  cleanupActivePlannerFocusSnapshot,
  cleanupStagedPlannerFocusSnapshot,
  moveStagedPlannerFocusSnapshot,
  plannerFocusSnapshotStagingPath,
  transferStagedSnapshotToActiveTask,
  validatePlannerFocusSnapshotEnvelope,
  writeStagedPlannerFocusSnapshot,
} from '../plannerFocusSnapshotStaging.js';

describe('plannerFocusSnapshotStaging', () => {
  let repoRoot: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'planner-staging-'));
    warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  describe('writeStagedPlannerFocusSnapshot', () => {
    it('writes the envelope atomically to the per-task staging path', async () => {
      await writeStagedPlannerFocusSnapshot({
        repoRoot,
        taskId: 'task-1',
        markdownDestination: 'AgentWorkSpace/dropbox/task-1.md',
        snapshot: { version: 1, contextPackId: 'orders' },
        now: () => new Date('2026-05-01T00:00:00.000Z'),
      });

      const target = plannerFocusSnapshotStagingPath(repoRoot, 'task-1');
      expect(existsSync(target)).toBe(true);
      const envelope = JSON.parse(readFileSync(target, 'utf-8'));
      expect(envelope).toEqual({
        schemaVersion: PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION,
        bindingKey: 'task-1',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/dropbox/task-1.md',
        snapshot: { version: 1, contextPackId: 'orders' },
      });
    });

    it('isolates concurrent writes for distinct taskIds', async () => {
      await Promise.all([
        writeStagedPlannerFocusSnapshot({
          repoRoot,
          taskId: 'task-a',
          markdownDestination: 'AgentWorkSpace/dropbox/task-a.md',
          snapshot: { version: 1, marker: 'A' },
        }),
        writeStagedPlannerFocusSnapshot({
          repoRoot,
          taskId: 'task-b',
          markdownDestination: 'AgentWorkSpace/dropbox/task-b.md',
          snapshot: { version: 1, marker: 'B' },
        }),
      ]);

      const a = JSON.parse(readFileSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-a'), 'utf-8'));
      const b = JSON.parse(readFileSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-b'), 'utf-8'));
      expect(a.bindingKey).toBe('task-a');
      expect(a.snapshot.marker).toBe('A');
      expect(b.bindingKey).toBe('task-b');
      expect(b.snapshot.marker).toBe('B');
    });
  });

  describe('moveStagedPlannerFocusSnapshot', () => {
    it('rewrites bindingKey + markdownDestination and removes the old per-task dir', async () => {
      await writeStagedPlannerFocusSnapshot({
        repoRoot,
        taskId: 'task-old',
        markdownDestination: 'AgentWorkSpace/dropbox/task-old.md',
        snapshot: { version: 1 },
      });

      await moveStagedPlannerFocusSnapshot({
        repoRoot,
        oldTaskId: 'task-old',
        newTaskId: 'task-new',
        newMarkdownDestination: 'AgentWorkSpace/pendingitems/task-new.md',
      });

      expect(existsSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-old'))).toBe(false);
      // Empty dir is cleaned up.
      expect(existsSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-old'))).toBe(false);

      const moved = JSON.parse(readFileSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-new'), 'utf-8'));
      expect(moved.bindingKey).toBe('task-new');
      expect(moved.markdownDestination).toBe('AgentWorkSpace/pendingitems/task-new.md');
    });

    it('is silent when the source staging file is absent (non-Lily task)', async () => {
      await expect(moveStagedPlannerFocusSnapshot({
        repoRoot,
        oldTaskId: 'never-staged',
        newTaskId: 'whatever',
        newMarkdownDestination: 'AgentWorkSpace/pendingitems/whatever.md',
      })).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('skips the move if the envelope bindingKey does not match the source taskId', async () => {
      // Hand-roll a corrupted envelope at the staging path.
      const corruptPath = plannerFocusSnapshotStagingPath(repoRoot, 'task-x');
      mkdirSync(path.dirname(corruptPath), { recursive: true });
      writeFileSync(corruptPath, JSON.stringify({
        schemaVersion: 1,
        bindingKey: 'WRONG-key',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/dropbox/task-x.md',
        snapshot: { version: 1 },
      }));

      await moveStagedPlannerFocusSnapshot({
        repoRoot,
        oldTaskId: 'task-x',
        newTaskId: 'task-y',
        newMarkdownDestination: 'AgentWorkSpace/pendingitems/task-y.md',
      });

      // Source is left in place for inspection; destination is not written.
      expect(existsSync(corruptPath)).toBe(true);
      expect(existsSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-y'))).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('transferStagedSnapshotToActiveTask', () => {
    it('writes the unwrapped snapshot to the active task dir and unlinks staging', async () => {
      await writeStagedPlannerFocusSnapshot({
        repoRoot,
        taskId: 'task-active',
        markdownDestination: 'AgentWorkSpace/pendingitems/task-active.md',
        snapshot: { version: 1, contextPackId: 'orders' },
      });

      await transferStagedSnapshotToActiveTask(repoRoot, 'task-active');

      const activePath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-active', '.planner-focus-snapshot.json');
      expect(existsSync(activePath)).toBe(true);
      // Unwrapped — no envelope wrapper.
      expect(JSON.parse(readFileSync(activePath, 'utf-8'))).toEqual({ version: 1, contextPackId: 'orders' });
      expect(existsSync(plannerFocusSnapshotStagingPath(repoRoot, 'task-active'))).toBe(false);
    });

    it('is silent when the staging file is absent (non-Lily / CLI-created task)', async () => {
      await expect(transferStagedSnapshotToActiveTask(repoRoot, 'no-staging')).resolves.toBeUndefined();
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'no-staging', '.planner-focus-snapshot.json'))).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('aborts and leaves the staging file in place when bindingKey does not match the active taskId', async () => {
      const stagingPath = plannerFocusSnapshotStagingPath(repoRoot, 'task-z');
      mkdirSync(path.dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, JSON.stringify({
        schemaVersion: 1,
        bindingKey: 'imposter',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/pendingitems/task-z.md',
        snapshot: { version: 1 },
      }));

      await transferStagedSnapshotToActiveTask(repoRoot, 'task-z');

      expect(existsSync(stagingPath)).toBe(true);
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-z', '.planner-focus-snapshot.json'))).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects an envelope whose schemaVersion is unknown', async () => {
      const stagingPath = plannerFocusSnapshotStagingPath(repoRoot, 'task-future');
      mkdirSync(path.dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, JSON.stringify({
        schemaVersion: 999,
        bindingKey: 'task-future',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/pendingitems/task-future.md',
        snapshot: { version: 1 },
      }));

      await transferStagedSnapshotToActiveTask(repoRoot, 'task-future');

      expect(existsSync(stagingPath)).toBe(true);
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-future', '.planner-focus-snapshot.json'))).toBe(false);
    });
  });

  describe('cleanup helpers', () => {
    it('cleanupStagedPlannerFocusSnapshot is ENOENT-safe', async () => {
      await expect(cleanupStagedPlannerFocusSnapshot(repoRoot, 'never-existed')).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('cleanupStagedPlannerFocusSnapshot removes the staging file when present', async () => {
      await writeStagedPlannerFocusSnapshot({
        repoRoot,
        taskId: 'task-bye',
        markdownDestination: 'AgentWorkSpace/dropbox/task-bye.md',
        snapshot: { version: 1 },
      });
      const target = plannerFocusSnapshotStagingPath(repoRoot, 'task-bye');
      expect(existsSync(target)).toBe(true);

      await cleanupStagedPlannerFocusSnapshot(repoRoot, 'task-bye');
      expect(existsSync(target)).toBe(false);
    });

    it('cleanupActivePlannerFocusSnapshot is ENOENT-safe and removes when present', async () => {
      const activePath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-active', '.planner-focus-snapshot.json');
      mkdirSync(path.dirname(activePath), { recursive: true });
      writeFileSync(activePath, '{}');

      await cleanupActivePlannerFocusSnapshot(repoRoot, 'task-active');
      expect(existsSync(activePath)).toBe(false);

      // Second call ENOENT-safe.
      await expect(cleanupActivePlannerFocusSnapshot(repoRoot, 'task-active')).resolves.toBeUndefined();
    });
  });

  describe('validatePlannerFocusSnapshotEnvelope', () => {
    function validEnvelope() {
      return {
        schemaVersion: PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION,
        bindingKey: 'task-1',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/dropbox/task-1.md',
        snapshot: { version: 1 },
      };
    }

    it('accepts a well-formed envelope', () => {
      expect(validatePlannerFocusSnapshotEnvelope(validEnvelope())).toEqual([]);
    });

    it('rejects non-objects', () => {
      expect(validatePlannerFocusSnapshotEnvelope(null).length).toBeGreaterThan(0);
      expect(validatePlannerFocusSnapshotEnvelope('').length).toBeGreaterThan(0);
      expect(validatePlannerFocusSnapshotEnvelope([]).length).toBeGreaterThan(0);
    });

    it('rejects schemaVersion mismatch', () => {
      const errs = validatePlannerFocusSnapshotEnvelope({ ...validEnvelope(), schemaVersion: 999 });
      expect(errs.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects bindingKey mismatch when expectedBindingKey is provided', () => {
      const errs = validatePlannerFocusSnapshotEnvelope(validEnvelope(), { expectedBindingKey: 'OTHER' });
      expect(errs.some((e) => e.includes('bindingKey'))).toBe(true);
    });

    it('rejects empty/missing required string fields', () => {
      const errs = validatePlannerFocusSnapshotEnvelope({ ...validEnvelope(), bindingKey: '', stagedAt: '' });
      expect(errs.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects snapshot that is not an object', () => {
      const errs = validatePlannerFocusSnapshotEnvelope({ ...validEnvelope(), snapshot: 'not-an-object' });
      expect(errs.some((e) => e.includes('snapshot'))).toBe(true);
    });
  });
});
