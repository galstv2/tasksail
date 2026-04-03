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

  it('reports the active item when set', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(pendingDir, '.active-item'), 'active-task.md');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeItem).toBe('active-task.md');
  });

  it('detects active item with blank workspace as degraded state', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(pendingDir, '.active-item'), 'active-task.md');
    // handoffs/ is empty (blank/ready state) — crash-recovery scenario

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeItem).toBe('active-task.md');
    expect(status.workspaceReady).toBe(true);
    expect(status.activeItemWithBlankWorkspace).toBe(true);
  });

  it('reports activeItemWithBlankWorkspace false for normal active state', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    writeFileSync(path.join(pendingDir, 'active-task.md'), '# Active');
    writeFileSync(path.join(pendingDir, '.active-item'), 'active-task.md');
    // Write task content so workspace is NOT in ready/reset state
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# Task\n\n## Task Metadata\n\n- Task ID: test-123\n\nActual task content here.\n',
    );

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeItem).toBe('active-task.md');
    expect(status.workspaceReady).toBe(false);
    expect(status.activeItemWithBlankWorkspace).toBe(false);
  });

  it('detects partial publish marker', async () => {
    const handoffsDir = path.join(tmpRoot, 'AgentWorkSpace', 'handoffs');
    writeFileSync(path.join(handoffsDir, '.publish-in-progress'), '/tmp/staging');

    const status = await getQueueStatus(tmpRoot);

    expect(status.partialPublish).toBe(true);
  });

  it('reports partialPublish false when no marker exists', async () => {
    const status = await getQueueStatus(tmpRoot);

    expect(status.partialPublish).toBe(false);
  });

  it('reports null active item when .active-item references missing file', async () => {
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    writeFileSync(path.join(pendingDir, '.active-item'), 'missing.md');

    const status = await getQueueStatus(tmpRoot);

    expect(status.activeItem).toBeNull();
  });

  it('reports error items count', async () => {
    const errorItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'erroritems');
    mkdirSync(errorItemsDir, { recursive: true });
    writeFileSync(path.join(errorItemsDir, 'failed-task-001.md'), '# Failed');
    writeFileSync(path.join(errorItemsDir, 'failed-task-002.md'), '# Failed 2');

    const status = await getQueueStatus(tmpRoot);

    expect(status.errorItemsCount).toBe(2);
  });

  it('reports zero error items when erroritems/ is empty', async () => {
    const errorItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'erroritems');
    mkdirSync(errorItemsDir, { recursive: true });

    const status = await getQueueStatus(tmpRoot);

    expect(status.errorItemsCount).toBe(0);
  });
});
