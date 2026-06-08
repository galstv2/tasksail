import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deletePendingItem } from '../deletePendingItem.js';

describe('deletePendingItem', () => {
  let repoRoot: string;
  let pendingDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'delete-pending-item-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('removes an unclaimed pending task', async () => {
    writeFileSync(path.join(pendingDir, 'task-002.md'), '# Pending\n', 'utf-8');

    await deletePendingItem({ repoRoot, queueName: 'task-002.md' });

    expect(existsSync(path.join(pendingDir, 'task-002.md'))).toBe(false);
  });

  it('blocks deleting the active item', async () => {
    // Active state is tracked via .active-items/<taskId> marker.
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(pendingDir, 'task-002.md'), '# Pending\n', 'utf-8');
    writeFileSync(path.join(activeItemsDir, 'task-002'), '', 'utf-8');

    await expect(
      deletePendingItem({ repoRoot, queueName: 'task-002.md' }),
    ).rejects.toThrow('Delete pending item blocked: "task-002.md" is the active task.');
  });

  it('removes the staged planner focus snapshot when present', async () => {
    writeFileSync(path.join(pendingDir, 'task-002.md'), '# Pending\n', 'utf-8');
    const stagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-002', 'planner-focus-snapshot.json');
    mkdirSync(path.dirname(stagingPath), { recursive: true });
    writeFileSync(stagingPath, '{}\n', 'utf-8');

    await deletePendingItem({ repoRoot, queueName: 'task-002.md' });

    expect(existsSync(path.join(pendingDir, 'task-002.md'))).toBe(false);
    expect(existsSync(stagingPath)).toBe(false);
  });
});
