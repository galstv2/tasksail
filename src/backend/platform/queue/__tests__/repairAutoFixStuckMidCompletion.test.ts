import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CompletePendingItemOptions } from '../completePendingItem.js';

const mocks = vi.hoisted(() => ({
  completePendingItem: vi.fn(),
  acquireDirLockOrThrow: vi.fn(),
}));

vi.mock('../completePendingItem.js', () => ({
  completePendingItem: mocks.completePendingItem,
}));

vi.mock('../operations.js', async () => {
  const actual = await vi.importActual<typeof import('../operations.js')>('../operations.js');
  return {
    ...actual,
    acquireDirLockOrThrow: mocks.acquireDirLockOrThrow,
  };
});

import { runRepairCommand } from '../cli.js';

describe('repair --auto-fix stuck mid-completion recovery', () => {
  let repoRoot: string;
  let stdout: string;
  let stderr: string;
  let events: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = '';
    stderr = '';
    events = [];
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-repair-recovery-'));
    mkdirSync(path.join(repoRoot, '.git'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks'), { recursive: true });

    mocks.acquireDirLockOrThrow.mockImplementation(async () => {
      events.push('repair-lock-acquired');
      return async () => {
        events.push('repair-lock-released');
      };
    });
    mocks.completePendingItem.mockImplementation(async (options: CompletePendingItemOptions) => {
      events.push(`recover:${options.taskId}`);
      const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
      rmSync(path.join(activeItemsDir, options.taskId), { force: true });
      rmSync(path.join(activeItemsDir, `${options.taskId}.completing`), { force: true });
    });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('checkpointed sentinel with archiveSucceeded true and retrospectiveSynced true re-drives closeout and clears marker/sentinel', async () => {
    seedStuckTask('task-checkpointed', {
      ts: Date.now(),
      archiveSucceeded: true,
      archivePath: '/archive/tasks/task-checkpointed.md',
      contextPackDir: '/packs/pack-a',
      retrospectiveSynced: true,
    });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(mocks.completePendingItem).toHaveBeenCalledWith({
      taskId: 'task-checkpointed',
      repoRoot,
      skipArchive: true,
      skipValidation: true,
      recoveryArchivePath: '/archive/tasks/task-checkpointed.md',
      contextPackDir: '/packs/pack-a',
      skipRetrospectiveSync: true,
    });
    expect(activeMarkerExists('task-checkpointed')).toBe(false);
    expect(sentinelExists('task-checkpointed')).toBe(false);
    expect(stdout).toContain("FIXED: re-drove closeout for stuck task 'task-checkpointed'");
  });

  it('archiveSucceeded true without retrospectiveSynced re-runs retrospective sync idempotently and clears task', async () => {
    seedStuckTask('task-resync', {
      ts: Date.now(),
      archiveSucceeded: true,
      archivePath: '/archive/tasks/task-resync.md',
      contextPackDir: '/packs/pack-a',
    });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(mocks.completePendingItem).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-resync',
        skipArchive: true,
        skipValidation: true,
        skipRetrospectiveSync: false,
      }),
    );
    expect(activeMarkerExists('task-resync')).toBe(false);
    expect(sentinelExists('task-resync')).toBe(false);
  });

  it('legacy { ts } without archive evidence prints SKIPPED and mutates nothing', async () => {
    seedStuckTask('task-legacy', { ts: Date.now() });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(mocks.completePendingItem).not.toHaveBeenCalled();
    expect(activeMarkerExists('task-legacy')).toBe(true);
    expect(sentinelExists('task-legacy')).toBe(true);
    expect(stdout).toContain(
      "SKIPPED: stuck task 'task-legacy' was not auto-fixed because archive success is not proven by sentinel or archive records.",
    );
    expect(stdout).toContain('manual recovery requires operator confirmation before using --skip-archive.');
  });


  it('legacy sentinel with authoritative nested archive record re-drives closeout', async () => {
    const taskId = 'task-archive-evidence';
    const contextPackDir = path.join(repoRoot, 'context-pack');
    const archiveDir = path.join(contextPackDir, 'qmd', 'context-packs', 'context-pack', 'archive', 'tasks', '2026');
    mkdirSync(archiveDir, { recursive: true });
    const archiveJsonPath = path.join(archiveDir, `${taskId}.json`);
    const archiveMdPath = path.join(archiveDir, `${taskId}.md`);
    writeFileSync(archiveJsonPath, JSON.stringify({ task_id: taskId }));
    writeFileSync(archiveMdPath, `# ${taskId}`);
    seedStuckTask(taskId, { ts: Date.now(), contextPackDir });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(mocks.completePendingItem).toHaveBeenCalledWith(expect.objectContaining({
      taskId,
      repoRoot,
      skipArchive: true,
      skipValidation: true,
      recoveryArchivePath: archiveMdPath,
      contextPackDir,
      skipRetrospectiveSync: false,
    }));
    expect(stdout).toContain(`FIXED: re-drove closeout for stuck task '${taskId}'`);
  });

  it('dry-run reports issue and does not invoke recovery', async () => {
    seedStuckTask('task-dry-run', {
      ts: Date.now(),
      archiveSucceeded: true,
      retrospectiveSynced: true,
    });

    await runRepairCommand(commandOptions({ autoFix: true, dryRun: true }));

    expect(stdout).toContain("ISSUE: Task 'task-dry-run' is stuck mid-completion");
    expect(mocks.completePendingItem).not.toHaveBeenCalled();
    expect(mocks.acquireDirLockOrThrow).not.toHaveBeenCalled();
    expect(activeMarkerExists('task-dry-run')).toBe(true);
    expect(sentinelExists('task-dry-run')).toBe(true);
  });

  it('recovery throw for one task prints FAILED and does not prevent second stuck task', async () => {
    seedStuckTask('task-fails', {
      ts: Date.now(),
      archiveSucceeded: true,
      retrospectiveSynced: true,
    });
    seedStuckTask('task-recovers', {
      ts: Date.now(),
      archiveSucceeded: true,
      retrospectiveSynced: true,
    });
    mocks.completePendingItem.mockImplementation(async (options: CompletePendingItemOptions) => {
      if (options.taskId === 'task-fails') {
        throw new Error('boom');
      }
      rmSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', options.taskId), { force: true });
      rmSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', `${options.taskId}.completing`), { force: true });
    });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(stderr).toContain("FAILED: re-drive closeout for 'task-fails' threw: boom");
    expect(stderr).toContain('manual recovery: inspect .active-items/task-fails.completing and rerun repair after fixing the failing closeout step');
    expect(stdout).toContain("FIXED: re-drove closeout for stuck task 'task-recovers'");
    expect(mocks.completePendingItem).toHaveBeenCalledTimes(2);
  });

  it('lock ordering proves repair lock released before recovery reacquires queue lock', async () => {
    seedStuckTask('task-lock-order', {
      ts: Date.now(),
      archiveSucceeded: true,
      retrospectiveSynced: true,
    });
    mocks.completePendingItem.mockImplementation(async (options: CompletePendingItemOptions) => {
      events.push('recovery-lock-acquired');
      rmSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', options.taskId), { force: true });
      rmSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', `${options.taskId}.completing`), { force: true });
    });

    await runRepairCommand(commandOptions({ autoFix: true }));

    expect(events).toEqual([
      'repair-lock-acquired',
      'repair-lock-released',
      'recovery-lock-acquired',
    ]);
  });

  it('active marker fixtures are non-empty', async () => {
    const { markerPath } = seedStuckTask('task-non-empty-marker', { ts: Date.now() });

    expect(readFileSync(markerPath, 'utf8').length).toBeGreaterThan(0);
  });

  describe('stale counter-lock reclamation', () => {
    const counterDirOf = () =>
      path.join(repoRoot, '.platform-state', 'task-counters');

    function seedCounterLock(packId: string, ageMs: number): string {
      const counterDir = counterDirOf();
      mkdirSync(counterDir, { recursive: true });
      const lockDir = path.join(counterDir, `${packId}.lock`);
      mkdirSync(lockDir);
      const targetSeconds = Math.floor((Date.now() - ageMs) / 1000);
      utimesSync(lockDir, targetSeconds, targetSeconds);
      return lockDir;
    }

    it('reclaims a counter lock whose mtime is older than 5 minutes', async () => {
      const stalePath = seedCounterLock('pack-stale', 10 * 60 * 1000);

      await runRepairCommand(commandOptions({ autoFix: true }));

      expect(stdout).toContain("FIXED: reclaimed stale counter lock 'pack-stale.lock'");
      expect(existsSync(stalePath)).toBe(false);
    });

    it('does not reclaim a counter lock whose mtime is fresh', async () => {
      const freshPath = seedCounterLock('pack-fresh', 0);

      await runRepairCommand(commandOptions({ autoFix: true }));

      expect(stdout).not.toContain("reclaimed stale counter lock 'pack-fresh.lock'");
      expect(existsSync(freshPath)).toBe(true);
    });

    it('reclaims only stale entries when stale and fresh locks coexist', async () => {
      const stalePath = seedCounterLock('pack-x', 10 * 60 * 1000);
      const freshPath = seedCounterLock('pack-y', 0);

      await runRepairCommand(commandOptions({ autoFix: true }));

      expect(stdout).toContain("FIXED: reclaimed stale counter lock 'pack-x.lock'");
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(freshPath)).toBe(true);
    });

    it('is a no-op when the task-counters directory does not exist', async () => {
      await runRepairCommand(commandOptions({ autoFix: true }));

      expect(stdout).not.toContain('reclaimed stale counter lock');
      expect(stderr).not.toContain('counter lock');
    });
  });

  function commandOptions(options: { autoFix?: boolean; dryRun?: boolean }) {
    return {
      repoRoot,
      autoFix: options.autoFix,
      dryRun: options.dryRun,
      stdout: { write: (chunk: string | Uint8Array) => { stdout += String(chunk); return true; } },
      stderr: { write: (chunk: string | Uint8Array) => { stderr += String(chunk); return true; } },
    };
  }

  function seedStuckTask(taskId: string, sentinelPayload: unknown): { markerPath: string; sentinelPath: string } {
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    const handoffsDir = path.join(taskDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId, state: 'active' }));
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), `# Active Task\n\n${taskId}`);

    const markerPath = path.join(activeItemsDir, taskId);
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    writeFileSync(markerPath, `${taskId}.md`);
    writeFileSync(sentinelPath, JSON.stringify(sentinelPayload));
    return { markerPath, sentinelPath };
  }

  function activeMarkerExists(taskId: string): boolean {
    return existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', taskId));
  }

  function sentinelExists(taskId: string): boolean {
    return existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', `${taskId}.completing`));
  }
});
