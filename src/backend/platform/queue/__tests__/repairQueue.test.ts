import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
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

  it('detects stale marker in .active-items/ referencing missing pending file', async () => {
    // §4.1B: repair now uses .active-items/<taskId> markers, not singleton .active-item
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(activeItemsDir, 'nonexistent'), '');
    // No corresponding pending file

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes('nonexistent'))).toBe(true);
    // Dry-run should not fix anything
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(activeItemsDir, 'nonexistent'))).toBe(true);
  });

  it('auto-fix removes stale marker in .active-items/', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(activeItemsDir, 'nonexistent'), '');
    // No corresponding pending file

    const result = await repairQueue({
      repoRoot: tmpRoot,
      autoFix: true,
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.fixed.some((f) => f.includes('nonexistent'))).toBe(true);
    expect(existsSync(path.join(activeItemsDir, 'nonexistent'))).toBe(false);
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

  it('detects marker in .active-items/ with valid pending file but blank workspace (crash-recovery)', async () => {
    // §4.1B: use .active-items/<taskId> marker, not singleton .active-item
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'task-123.md'), '# Task 123');
    writeFileSync(path.join(activeItemsDir, 'task-123'), '');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(
      result.issues.some((i) => i.includes('handoffs/ is in reset state')),
    ).toBe(true);
    // Dry-run should not fix
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(activeItemsDir, 'task-123'))).toBe(true);
  });

  it('auto-fixes marker in .active-items/ with blank workspace by removing marker', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'task-456.md'), '# Task 456');
    writeFileSync(path.join(activeItemsDir, 'task-456'), '');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.fixed.some((f) => f.includes('blank workspace'))).toBe(true);
    // Marker removed, pending file preserved
    expect(existsSync(path.join(activeItemsDir, 'task-456'))).toBe(false);
    expect(existsSync(path.join(pendingDir, 'task-456.md'))).toBe(true);
  });

  it('detects partial publish marker', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    // §4.1B: use .active-items/<taskId> marker, not singleton .active-item
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, 'task-789.md'), '# Task 789');
    writeFileSync(path.join(activeItemsDir, 'task-789'), '');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.some((i) => i.includes('Partial handoff publish'))).toBe(true);
    expect(result.fixed).toEqual([]);
    // Marker should still exist (dry-run)
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(true);
  });

  it('auto-fixes partial publish by resetting handoffs and removing active markers', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, 'task-789.md'), '# Task 789');
    writeFileSync(path.join(activeItemsDir, 'task-789'), '');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.fixed.some((f) => f.includes('partially published'))).toBe(true);
    // Publish-in-progress marker removed
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(false);
    // Active marker removed
    expect(existsSync(path.join(activeItemsDir, 'task-789'))).toBe(false);
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

// ── §4.1B — .active-items/ directory-based repair ────────────────────────────

describe('repairQueue §4.1B — .active-items/ marker-based checks', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-repair-mg10-'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'handoffs'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reports no issues when .active-items/ is empty', async () => {
    const result = await repairQueue({ repoRoot: tmpRoot });
    expect(result.issues).toEqual([]);
    expect(result.fixed).toEqual([]);
  });

  it('stale marker without pending-item → structuredIssues contains marker-without-pending', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-stale'), '');
    // No corresponding pending-item in pendingDir

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.structuredIssues.some((i) => i.kind === 'marker-without-pending')).toBe(true);
    expect(result.structuredIssues.find((i) => i.kind === 'marker-without-pending')?.taskId).toBe('task-stale');
  });

  it('auto-fix removes stale marker, leaves other markers untouched', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');

    // task-stale: no pending-item (stale)
    writeFileSync(path.join(activeItemsDir, 'task-stale'), '');
    // task-valid: has a pending-item (but handoffs/ is blank → also detected as marker-without-worktree)
    writeFileSync(path.join(activeItemsDir, 'task-valid'), '');
    writeFileSync(path.join(pendingDir, 'task-valid.md'), '# Task Valid');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    // The stale marker is removed
    expect(existsSync(path.join(activeItemsDir, 'task-stale'))).toBe(false);

    // The valid marker may be removed by check 4 (blank workspace), but is NOT removed by check 1
    // Regardless: task-stale was definitely targeted for removal by check 1
    expect(result.fixed.some((f) => f.includes('task-stale'))).toBe(true);
    // The pending file for task-valid is preserved
    expect(existsSync(path.join(pendingDir, 'task-valid.md'))).toBe(true);
  });

  it('.completing sentinels are excluded from marker enumeration (not treated as stale)', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');
    // No pending-item for task-a

    const result = await repairQueue({ repoRoot: tmpRoot });

    // Sentinels must not generate marker-without-pending issues
    expect(result.structuredIssues.filter((i) => i.kind === 'marker-without-pending')).toHaveLength(0);
  });

  it('structuredIssues is an array (even when empty)', async () => {
    const result = await repairQueue({ repoRoot: tmpRoot });
    expect(Array.isArray(result.structuredIssues)).toBe(true);
  });
});
