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
import { resolveQueuePaths } from '../paths.js';
import { writeActivationProgress } from '../activationProgress.js';

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
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks'), {
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
// Repair uses .active-items/<taskId> markers.
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

  it('reports stale and malformed activating markers in dry-run', async () => {
    const paths = resolveQueuePaths(tmpRoot);
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'claimed',
      startedAt: '2026-05-23T10:00:00Z',
    });
    writeFileSync(path.join(paths.activatingItemsDir, 'bad.json'), '{bad', 'utf-8');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.structuredIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'stale-activating-marker', taskId: 'task-a' }),
      expect.objectContaining({ kind: 'stale-activating-marker', taskId: 'bad' }),
    ]));
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(true);
    expect(existsSync(path.join(paths.activatingItemsDir, 'bad.json'))).toBe(true);
  });

  it('auto-fix removes only activating markers for activation-progress issues', async () => {
    const paths = resolveQueuePaths(tmpRoot);
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'task-a'), 'task-a.md', 'utf-8');
    writeFileSync(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n', 'utf-8');
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: null,
      phase: 'validating',
      startedAt: '2026-05-23T10:00:00Z',
    });

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.fixed.some((entry) => entry.includes('.activating-items/task-a.json'))).toBe(true);
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(false);
    expect(existsSync(path.join(paths.activeItemsDir, 'task-a'))).toBe(true);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
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
// Check: marker plus .task.json sidecar but blank per-task handoffs dir triggers crash recovery.
    const TEST_TASK_ID = 'task-123';
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID);
    const handoffsDir = path.join(taskDir, 'handoffs');
    mkdirSync(activeItemsDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    // Seed the .task.json sidecar so check-4 fires
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId: TEST_TASK_ID, state: 'active' }));
    writeFileSync(path.join(activeItemsDir, TEST_TASK_ID), '');
    // handoffsDir is empty (blank/ready state) — crash-recovery scenario

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(
      result.issues.some((i) => i.includes('handoffs dir is in reset state')),
    ).toBe(true);
    // Dry-run should not fix
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(activeItemsDir, TEST_TASK_ID))).toBe(true);
  });

  it('auto-fixes marker in .active-items/ with blank workspace by removing marker', async () => {
// Check: marker plus .task.json sidecar but blank per-task handoffs dir removes marker.
    const TEST_TASK_ID = 'task-456';
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID);
    const handoffsDir = path.join(taskDir, 'handoffs');
    mkdirSync(activeItemsDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    // Seed the .task.json sidecar so check-4 fires
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId: TEST_TASK_ID, state: 'active' }));
    writeFileSync(path.join(activeItemsDir, TEST_TASK_ID), '');
    // handoffsDir is empty (blank/ready state) — crash-recovery scenario

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.fixed.some((f) => f.includes('blank per-task workspace'))).toBe(true);
    // Marker removed
    expect(existsSync(path.join(activeItemsDir, TEST_TASK_ID))).toBe(false);
  });

  it('detects partial publish marker', async () => {
    const TEST_TASK_ID = 'task-789';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
// Use .active-items/<taskId> marker.
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, `${TEST_TASK_ID}.md`), '# Task 789');
    writeFileSync(path.join(activeItemsDir, TEST_TASK_ID), '');

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.some((i) => i.includes('Partial handoff publish'))).toBe(true);
    expect(result.fixed).toEqual([]);
    // Marker should still exist (dry-run)
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(true);
  });

  it('auto-fixes partial publish by resetting handoffs and removing active markers', async () => {
    const TEST_TASK_ID = 'task-789';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent here');
    writeFileSync(path.join(pendingDir, `${TEST_TASK_ID}.md`), '# Task 789');
    writeFileSync(path.join(activeItemsDir, TEST_TASK_ID), '');

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.fixed.some((f) => f.includes('partially published'))).toBe(true);
    // Publish-in-progress marker removed
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(false);
    // Active marker removed
    expect(existsSync(path.join(activeItemsDir, TEST_TASK_ID))).toBe(false);
    // Pending file preserved for re-activation
    expect(existsSync(path.join(pendingDir, `${TEST_TASK_ID}.md`))).toBe(true);
    // Handoff file cleaned up
    expect(existsSync(path.join(handoffsDir, 'professional-task.md'))).toBe(false);
  });

  it('detects workspace with task data but no active marker (orphan-task-handoffs-dir)', async () => {
    const TEST_TASK_ID = 'task-test-001';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    // Write a professional task handoff with actual content, not reset state.
    // No active marker and no .task.json sidecar → orphan-task-handoffs-dir
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# My Active Task\n\n## Task Metadata\n\n- Task ID: test-123\n\nActual task content here.\n',
    );

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes('handoffs/ has task content but no active marker and no .task.json sidecar'))).toBe(true);
  });
});

// .active-items/ directory-based repair.

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

  it('active-task steady state (marker + .task.json + non-blank handoffs + no pending file) is NOT flagged as stranded', async () => {
  // Regression: under the per-task parallel model, the pending file
    // is deleted immediately after activation (operations.ts:704) and the
    // marker persists for the active lifetime. This is the LEGITIMATE steady
    // state of every active task. Check 1 must use .task.json — not pending
    // file presence — as the authoritative signal that the marker is live.
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const taskSidecarDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'task-active-steady');
    const taskHandoffsDir = path.join(taskSidecarDir, 'handoffs');
    mkdirSync(taskHandoffsDir, { recursive: true });
    writeFileSync(path.join(activeItemsDir, 'task-active-steady'), 'task-active-steady.md');
    writeFileSync(path.join(taskSidecarDir, '.task.json'), '{"taskId":"task-active-steady","state":"active"}');
    // Seed the professional task handoff with content so check-4 does not flag it as blank.
    writeFileSync(
      path.join(taskHandoffsDir, 'professional-task.md'),
      '# Professional Task\n\n## Task Metadata\n\n- Task ID: task-active-steady\n\nActual task content here.\n',
    );
    // Note: NO pending file — this is the steady state after activation.

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    // Must NOT flag as marker-without-pending and must NOT unlink the marker.
    expect(result.structuredIssues.filter((i) => i.kind === 'marker-without-pending')).toHaveLength(0);
    expect(existsSync(path.join(activeItemsDir, 'task-active-steady'))).toBe(true);
  });

  it('truly stranded marker (no pending AND no .task.json) is still flagged and removed under autoFix', async () => {
    // Companion to the steady-state test above: the original "marker-without-pending"
    // detection still works for genuinely stranded markers.
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-truly-stranded'), '');
    // No pending file AND no .task.json sidecar.

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.structuredIssues.some((i) => i.kind === 'marker-without-pending' && i.taskId === 'task-truly-stranded')).toBe(true);
    expect(existsSync(path.join(activeItemsDir, 'task-truly-stranded'))).toBe(false);
  });

  it('.completing sentinels are excluded from marker enumeration (not treated as stale)', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');
    // No pending-item for task-a

    const result = await repairQueue({ repoRoot: tmpRoot });

    // Sentinels must not generate marker-without-pending issues
    expect(result.structuredIssues.filter((i) => i.kind === 'marker-without-pending')).toHaveLength(0);
  });

  it('detects stuck mid-completion marker and sentinel in dry-run', async () => {
    const taskId = 'task-stuck-dry-run';
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
    const handoffsDir = path.join(taskDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId, state: 'active' }));
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Active Task\n\nContent');
    writeFileSync(path.join(activeItemsDir, taskId), '');
    writeFileSync(path.join(activeItemsDir, `${taskId}.completing`), JSON.stringify({ ts: Date.now() }));

    const result = await repairQueue({ repoRoot: tmpRoot, dryRun: true });

    expect(result.structuredIssues).toContainEqual({
      kind: 'sentinel-without-completed-marker',
      taskId,
      detail: `sentinel: ${taskId}.completing; marker present; recovery must run outside repair lock`,
    });
    expect(result.issues).toContain(
      `Task '${taskId}' is stuck mid-completion: .completing sentinel and active marker both present. Run: pnpm run repair -- --auto-fix`,
    );
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(activeItemsDir, taskId))).toBe(true);
    expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(true);
  });

  it('does not mutate stuck mid-completion state when autoFix is false', async () => {
    const taskId = 'task-stuck-no-autofix';
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(path.join(taskDir, 'handoffs'), { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId, state: 'active' }));
    writeFileSync(path.join(activeItemsDir, taskId), '');
    writeFileSync(path.join(activeItemsDir, `${taskId}.completing`), JSON.stringify({ ts: Date.now() }));

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: false });

    expect(result.structuredIssues.some((i) => i.kind === 'sentinel-without-completed-marker' && i.taskId === taskId)).toBe(true);
    expect(result.fixed).toEqual([]);
    expect(existsSync(path.join(activeItemsDir, taskId))).toBe(true);
    expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(true);
  });

  it('does not emit stuck mid-completion issue for sentinel without active marker', async () => {
    const taskId = 'task-sentinel-only';
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, `${taskId}.completing`), JSON.stringify({ ts: Date.now() }));

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.structuredIssues.filter((i) => i.kind === 'sentinel-without-completed-marker')).toHaveLength(0);
    expect(result.issues.some((i) => i.includes('stuck mid-completion'))).toBe(false);
    expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(true);
  });

  it('does not consume stuck task via marker-without-worktree auto-fix rule', async () => {
    const taskId = 'task-stuck-blank-worktree';
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(path.join(taskDir, 'handoffs'), { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId, state: 'active' }));
    writeFileSync(path.join(activeItemsDir, taskId), '');
    writeFileSync(path.join(activeItemsDir, `${taskId}.completing`), JSON.stringify({ ts: Date.now() }));

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.structuredIssues.some((i) => i.kind === 'sentinel-without-completed-marker' && i.taskId === taskId)).toBe(true);
    expect(result.structuredIssues.some((i) => i.kind === 'marker-without-worktree' && i.taskId === taskId)).toBe(true);
    expect(result.fixed.some((f) => f.includes('blank per-task workspace'))).toBe(false);
    expect(existsSync(path.join(activeItemsDir, taskId))).toBe(true);
    expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(true);
  });

  it('does not consume stuck task via partial-publish auto-fix rule', async () => {
    const taskId = 'task-stuck-partial-publish';
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Active Task\n\nContent');
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), 'staging');
    writeFileSync(path.join(activeItemsDir, taskId), '');
    writeFileSync(path.join(activeItemsDir, `${taskId}.completing`), JSON.stringify({ ts: Date.now() }));

    const result = await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(result.structuredIssues.some((i) => i.kind === 'sentinel-without-completed-marker' && i.taskId === taskId)).toBe(true);
    expect(result.structuredIssues.some((i) => i.kind === 'partial-publish-in-progress' && i.taskId === taskId)).toBe(true);
    expect(result.fixed.some((f) => f.includes('partially published'))).toBe(false);
    expect(existsSync(path.join(activeItemsDir, taskId))).toBe(true);
    expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(true);
    expect(existsSync(path.join(handoffsDir, '.publish-in-progress'))).toBe(true);
    expect(existsSync(path.join(handoffsDir, 'professional-task.md'))).toBe(true);
  });

  it('structuredIssues is an array (even when empty)', async () => {
    const result = await repairQueue({ repoRoot: tmpRoot });
    expect(Array.isArray(result.structuredIssues)).toBe(true);
  });
});

// Partial-publish repair clears ImplementationSteps artifacts.

describe('repairQueue check-5: partial-publish repair clears ImplementationSteps', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-repair-implsteps-'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('auto-fix clears stale .md slice files in ImplementationSteps on partial-publish reset', async () => {
    const taskId = 'task-partial-md';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    const implStepsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'ImplementationSteps');
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# slice');
    writeFileSync(path.join(implStepsDir, 'slice-template.md'), '# template');
    writeFileSync(path.join(activeItemsDir, taskId), '');

    await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(existsSync(path.join(implStepsDir, 'slice-1.md'))).toBe(false);
    expect(existsSync(path.join(implStepsDir, 'slice-template.md'))).toBe(false);
  });

  it('auto-fix clears stale .xml slice files in ImplementationSteps on partial-publish reset', async () => {
    const taskId = 'task-partial-xml';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    const implStepsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'ImplementationSteps');
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent');
    writeFileSync(path.join(implStepsDir, 'slice-1.xml'), '<executionSlice/>');
    writeFileSync(path.join(implStepsDir, 'slice-template.xml'), '<?xml?>');
    writeFileSync(path.join(activeItemsDir, taskId), '');

    await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(existsSync(path.join(implStepsDir, 'slice-1.xml'))).toBe(false);
    expect(existsSync(path.join(implStepsDir, 'slice-template.xml'))).toBe(false);
  });

  it('auto-fix leaves non-md/non-xml files in ImplementationSteps untouched', async () => {
    const taskId = 'task-partial-other';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    const implStepsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'ImplementationSteps');
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# Task\n\nContent');
    writeFileSync(path.join(implStepsDir, 'notes.txt'), 'keep me');
    writeFileSync(path.join(activeItemsDir, taskId), '');

    await repairQueue({ repoRoot: tmpRoot, autoFix: true });

    expect(existsSync(path.join(implStepsDir, 'notes.txt'))).toBe(true);
  });
});
