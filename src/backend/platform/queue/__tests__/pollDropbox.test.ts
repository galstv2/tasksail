/**
 * §4.2 pollDropbox caller-side while-loop tests.
 *
 * Verifies that a single runCycle (one pollDropbox iteration with
 * maxIterations=1) activates up to `max_parallel_tasks` pending items — not
 * just 1 — so the caller-side while-loop in pollDropbox is exercised.
 *
 * A regression where runCycle makes only a single bare activateNextPendingItemIfReady
 * call (pre-refactor behavior) would activate exactly 1 item per cycle and
 * MUST fail the cap=3/5-pendings assertion below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pollDropbox } from '../pollDropbox.js';
import { resolveQueuePaths, HANDOFF_FILES, SLICE_TEMPLATE_FILENAME } from '../paths.js';
import { getActiveTaskIds } from '../operations.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';

/**
 * Seed the canonical AgentWorkSpace structure and write N pending .md files.
 */
function seedPendingItems(repoRoot: string, count: number): void {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
  const templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
  const dropboxDir = path.join(repoRoot, 'AgentWorkSpace', 'dropbox');

  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(handoffsDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });

  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

  // Write files with alphabetical names so queue-order is deterministic.
  for (let i = 0; i < count; i++) {
    const taskId = `poll-task-${String(i).padStart(3, '0')}`;
    writeFileSync(path.join(pendingDir, `${taskId}.md`), `# Task ${i}\n`);
  }
}

/**
 * Write a minimal .platform-state/platform.json with the given max_parallel_tasks.
 */
function writePlatformConfig(repoRoot: string, maxParallelTasks: number): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify({
      schema_version: 1,
      container_runtime: 'docker',
      max_parallel_tasks: maxParallelTasks,
    }, null, 2) + '\n',
    'utf-8',
  );
}

describe('pollDropbox caller-side while-loop (§4.2)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-poll-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it('cap=3, 3 pendings: one runCycle activates all 3 in a single iteration', async () => {
    writePlatformConfig(repoRoot, 3);
    seedPendingItems(repoRoot, 3);

    // maxIterations=1 executes exactly one runCycle.
    await pollDropbox({ repoRoot, watchMode: 'poll', maxIterations: 1 });

    const queuePaths = resolveQueuePaths(repoRoot);
    expect(getActiveTaskIds(queuePaths)).toHaveLength(3);

    // No pending .md files should remain.
    const remainingPending = readdirSync(queuePaths.pendingDir).filter(
      (f) => f.endsWith('.md') && !f.startsWith('.'),
    );
    expect(remainingPending).toHaveLength(0);
  });

  it('cap=2, 5 pendings: one runCycle activates exactly 2, 3 remain in pending', async () => {
    writePlatformConfig(repoRoot, 2);
    seedPendingItems(repoRoot, 5);

    await pollDropbox({ repoRoot, watchMode: 'poll', maxIterations: 1 });

    const queuePaths = resolveQueuePaths(repoRoot);
    expect(getActiveTaskIds(queuePaths)).toHaveLength(2);

    // 3 pending files must remain.
    const remainingPending = readdirSync(queuePaths.pendingDir).filter(
      (f) => f.endsWith('.md') && !f.startsWith('.'),
    );
    expect(remainingPending).toHaveLength(3);
  });
});
