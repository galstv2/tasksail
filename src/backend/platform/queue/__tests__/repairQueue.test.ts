import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repairQueue } from '../repairQueue.js';

describe('repairQueue', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-repair-'));
    mkdirSync(path.join(tmpRoot, '.git'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'dropbox'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'handoffs'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'templates'), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reports no issues for a consistent state', async () => {
    const result = await repairQueue({ repoRoot: tmpRoot });

    expect(result.issues).toEqual([]);
    expect(result.fixed).toEqual([]);
  });

  it('detects stale .active-item referencing missing file', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, '.active-item'), 'nonexistent.md');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toContain('nonexistent.md');
    // Dry-run should not fix anything
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(true);
  });

  it('auto-fix removes stale .active-item', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, '.active-item'), 'nonexistent.md');

    const result = await repairQueue({
      repoRoot: tmpRoot,
      autoFix: true,
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.fixed).toContain('Removed stale .active-item');
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(false);
  });

  it('reports queue lock directory as advisory without auto-removing', async () => {
    const lockDir = path.join(
      tmpRoot,
      'AgentWorkSpace',
      'pendingitems',
      '.queue-lock.d',
    );
    mkdirSync(lockDir);

    // Without autoFix: reports the lock as an issue
    const result = await repairQueue({ repoRoot: tmpRoot });

    expect(result.issues.some((i) => i.includes('Queue lock directory found'))).toBe(true);
    expect(result.fixed).toEqual([]);
    // Lock dir should NOT be removed
    expect(existsSync(lockDir)).toBe(true);
  });

  it('does not report lock directory as issue when autoFix is true (repair holds it)', async () => {
    const lockDir = path.join(
      tmpRoot,
      'AgentWorkSpace',
      'pendingitems',
      '.queue-lock.d',
    );
    mkdirSync(lockDir);

    // With autoFix: repair itself holds the lock, so the existing lock dir
    // is expected and should not be reported as an issue
    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.issues.every((i) => !i.includes('Queue lock directory'))).toBe(true);
  });

  it('detects .active-item with blank workspace (crash-recovery state)', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    // .active-item references a valid pending file, but handoffs/ is blank
    writeFileSync(path.join(pendingDir, 'task-123.md'), '# Task 123');
    writeFileSync(path.join(pendingDir, '.active-item'), 'task-123.md');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(
      result.issues.some((i) => i.includes('handoffs/ is in reset state')),
    ).toBe(true);
    // Dry-run should not fix
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(true);
  });

  it('auto-fixes .active-item with blank workspace by removing claim', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, 'task-456.md'), '# Task 456');
    writeFileSync(path.join(pendingDir, '.active-item'), 'task-456.md');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.fixed.some((f) => f.includes('blank workspace'))).toBe(true);
    // .active-item removed, pending file preserved
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(false);
    expect(existsSync(path.join(pendingDir, 'task-456.md'))).toBe(true);
  });

  it('detects partial publish marker', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    // Simulate crash mid-publish: marker + some files + .active-item
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, 'task-789.md'), '# Task 789');
    writeFileSync(path.join(pendingDir, '.active-item'), 'task-789.md');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.some((i) => i.includes('Partial handoff publish'))).toBe(true);
    expect(result.fixed).toEqual([]);
    // Marker should still exist (dry-run)
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(true);
  });

  it('auto-fixes partial publish by resetting handoffs and removing claim', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, 'task-789.md'), '# Task 789');
    writeFileSync(path.join(pendingDir, '.active-item'), 'task-789.md');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.fixed.some((f) => f.includes('partially published'))).toBe(true);
    // Marker removed
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(false);
    // .active-item removed
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(false);
    // Pending file preserved for re-activation
    expect(existsSync(path.join(pendingDir, 'task-789.md'))).toBe(true);
    // Handoff file cleaned up
    expect(existsSync(path.join(handoffsDir, 'professional-task.md'))).toBe(false);
  });

  it('detects workspace with task data but no .active-item', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    // Write a professional-task.md with actual content (not reset state)
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# My Active Task\n\n## Task Metadata\n\n- Task ID: test-123\n\nActual task content here.\n',
    );

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes('handoffs/ has task data'))).toBe(true);
  });
});
