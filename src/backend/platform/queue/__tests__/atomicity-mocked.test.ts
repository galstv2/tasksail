import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('../lifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lifecycle.js')>();
  return {
    ...actual,
    resetHandoffArtifacts: vi.fn(),
    initializeTaskArtifacts: vi.fn(),
    handoffWorkspaceIsReady: vi.fn().mockResolvedValue(true),
  };
});

import {
  resetHandoffArtifacts,
  initializeTaskArtifacts,
} from '../lifecycle.js';
import {
  completeActiveItem,
  activateNextPendingItemIfReady,
} from '../operations.js';
import { resolveQueuePaths } from '../paths.js';

const mockReset = vi.mocked(resetHandoffArtifacts);
const mockInit = vi.mocked(initializeTaskArtifacts);

// ── Test 2: completeActiveItem preserves pending file on reset failure ──

describe('completeActiveItem operation ordering', () => {
  let tmpDir: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-complete-'));
    pendingDir = path.join(tmpDir, 'pending');
    handoffsDir = path.join(tmpDir, 'handoffs');
    templatesDir = path.join(tmpDir, 'templates');
    mkdirSync(pendingDir);
    mkdirSync(handoffsDir);
    mkdirSync(templatesDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves pending file and per-task marker when reset fails', async () => {
    mockReset.mockRejectedValue(new Error('Simulated reset failure'));

    // Set up: per-task active-items marker (§4.1 parallel model)
    const taskId = 'task-001';
    const activeItemsDir = path.join(pendingDir, '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(path.join(activeItemsDir, taskId), JSON.stringify({ ts: Date.now() }));

    await expect(
      completeActiveItem({
        pendingDir,
        taskId,
        handoffsDir,
        templatesDir,
      }),
    ).rejects.toThrow('Simulated reset failure');

    // Per-task marker must still exist (marker-delete is step 4, after reset)
    expect(existsSync(path.join(activeItemsDir, taskId))).toBe(true);
  });
});

// ── Test 3: activateNextPendingItemIfReady rolls active marker on init failure ──

describe('activateNextPendingItemIfReady claim rollback', () => {
  let repoRoot: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use canonical AgentWorkSpace structure so resolveQueuePaths works correctly.
    // Per-task handoffs live under AgentWorkSpace/tasks/<taskId>/handoffs/ (created by activation).
    const TEST_TASK_ID = 'task-test-001';
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-activate-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rolls active marker when initializeTaskArtifacts fails', async () => {
    mockInit.mockRejectedValue(new Error('Simulated init failure'));

    // Set up: a pending item, empty workspace (ready state)
    writeFileSync(
      path.join(pendingDir, 'task-002.md'),
      '# Task\n- Task Title: Test Task',
    );

    const queuePaths = resolveQueuePaths(repoRoot);
    await expect(
      activateNextPendingItemIfReady({ paths: queuePaths, repoRoot }),
    ).rejects.toThrow('Simulated init failure');

    // Active marker should NOT exist (rolled back)
    expect(existsSync(path.join(pendingDir, '.active-items', 'task-002'))).toBe(false);
    // handoffsDir should remain empty
    const handoffFiles = readdirSync(handoffsDir);
    expect(handoffFiles).toEqual([]);
  });

  it('cleans the active-dir planner focus snapshot when initialization fails after stage-3 transfer', async () => {
    mockInit.mockRejectedValue(new Error('Simulated init failure'));
    writeFileSync(path.join(pendingDir, 'task-002.md'), '# Task');
    const stagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-002', 'planner-focus-snapshot.json');
    mkdirSync(path.dirname(stagingPath), { recursive: true });
    writeFileSync(stagingPath, JSON.stringify({
      schemaVersion: 1,
      bindingKey: 'task-002',
      stagedAt: '2026-05-01T00:00:00.000Z',
      markdownDestination: 'AgentWorkSpace/pendingitems/task-002.md',
      snapshot: { version: 1 },
    }));

    await expect(
      activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }),
    ).rejects.toThrow('Simulated init failure');

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-002', '.planner-focus-snapshot.json'))).toBe(false);
  });
});
