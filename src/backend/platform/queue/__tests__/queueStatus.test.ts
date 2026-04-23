import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getQueueStatus } from '../queueStatus.js';

describe('getQueueStatus', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-status-'));
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

  it('reports an empty queue', async () => {
    const status = await getQueueStatus(tmpRoot);

    expect(status.dropboxItems).toEqual([]);
    expect(status.pendingItems).toEqual([]);
    expect(status.activeItem).toBeNull();
    expect(status.workspaceReady).toBe(true);
  });

  it('reports pending items in sorted order', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, 'b-task.md'), '# B Task');
    writeFileSync(path.join(pendingDir, 'a-task.md'), '# A Task');
    writeFileSync(path.join(pendingDir, 'c-task.md'), '# C Task');

    const status = await getQueueStatus(tmpRoot);

    expect(status.pendingItems).toEqual([
      'a-task.md',
      'b-task.md',
      'c-task.md',
    ]);
  });

  it('reports dropbox items', async () => {
    const dropboxDir = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox');
    writeFileSync(path.join(dropboxDir, 'new-task.md'), '# New Task');

    const status = await getQueueStatus(tmpRoot);

    expect(status.dropboxItems).toEqual(['new-task.md']);
  });

  it('reports activeTasks when active marker exists in .active-items/', async () => {
    // §4.1B: active state tracked via .active-items/<taskId>, not singleton .active-item
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(activeItemsDir, 'active-task'), '');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(1);
    expect(status.activeTasks[0]!.taskId).toBe('active-task');
  });

  it('detects active marker with blank workspace as degraded state', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(activeItemsDir, 'active-task'), '');
    // handoffs/ is empty (blank/ready state) — crash-recovery scenario

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(1);
    expect(status.workspaceReady).toBe(true);
    expect(status.activeItemWithBlankWorkspace).toBe(true);
  });

  it('reports activeItemWithBlankWorkspace false when workspace has task content', async () => {
    const TEST_TASK_ID = 'active-task';
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(activeItemsDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(activeItemsDir, TEST_TASK_ID), '');
    // Write task content so workspace is NOT in ready/reset state
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# Task\n\n## Task Metadata\n\n- Task ID: test-123\n\nActual task content here.\n',
    );

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(1);
    expect(status.workspaceReady).toBe(false);
    expect(status.activeItemWithBlankWorkspace).toBe(false);
  });

  it('partialPublish is always false (per-task partial publishes handled by repairQueue)', async () => {
    // Under the per-task workbench, queueStatus no longer checks the singleton
    // handoffs directory for .publish-in-progress markers. repairQueue check-5
    // iterates each active task's handoffs dir instead. partialPublish is always false.
    const TEST_TASK_ID = 'task-test-001';
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');

    const status = await getQueueStatus(tmpRoot);

    expect(status.partialPublish).toBe(false);
  });

  it('reports partialPublish false when no marker exists', async () => {
    const status = await getQueueStatus(tmpRoot);

    expect(status.partialPublish).toBe(false);
  });

  it('reports empty activeTasks when .active-items/ is absent', async () => {
    // §4.1B: no .active-items/ directory → no active tasks
    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(0);
    expect(status.activeItem).toBeNull();
  });

  it('reports error items count', async () => {
    const errorItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'error-items');
    mkdirSync(errorItemsDir, { recursive: true });
    writeFileSync(path.join(errorItemsDir, 'failed-task-001.md'), '# Failed');
    writeFileSync(path.join(errorItemsDir, 'failed-task-002.md'), '# Failed 2');

    const status = await getQueueStatus(tmpRoot);

    expect(status.errorItemsCount).toBe(2);
  });

  it('reports zero error items when error-items/ is empty', async () => {
    const errorItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'error-items');
    mkdirSync(errorItemsDir, { recursive: true });

    const status = await getQueueStatus(tmpRoot);

    expect(status.errorItemsCount).toBe(0);
  });
});

// ── §4.1B / §4.5 — activeItemsDir-based active task reporting ────────────────

describe('getQueueStatus §4.1B — activeTasks array from .active-items/', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-status-mg10-'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('two active markers → activeTasks has two entries', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a'), '');
    writeFileSync(path.join(activeItemsDir, 'task-b'), '');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(2);
    const ids = status.activeTasks.map((t) => t.taskId).sort();
    expect(ids).toEqual(['task-a', 'task-b']);
    expect(status.activeTasks.every((t) => t.state === 'active')).toBe(true);
  });

  it('sentinel-only directory {a, a.completing, b} → exactly 2 activeTasks (a, b), sentinel excluded', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a'), '');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');
    writeFileSync(path.join(activeItemsDir, 'task-b'), '');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(2);
    const ids = status.activeTasks.map((t) => t.taskId).sort();
    expect(ids).toEqual(['task-a', 'task-b']);
  });

  it('only .completing sentinels → activeTasks is empty', async () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeTasks).toHaveLength(0);
  });

  it('empty .active-items/ → activeTasks is empty', async () => {
    const status = await getQueueStatus(tmpRoot);
    expect(status.activeTasks).toHaveLength(0);
  });
});
