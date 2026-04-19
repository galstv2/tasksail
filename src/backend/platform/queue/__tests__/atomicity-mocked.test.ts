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

  it('preserves pending file and .active-item when reset fails', async () => {
    mockReset.mockRejectedValue(new Error('Simulated reset failure'));

    // Set up: pending file + .active-item
    const pendingFile = 'task-001.md';
    writeFileSync(path.join(pendingDir, pendingFile), '# Task');
    writeFileSync(path.join(pendingDir, '.active-item'), pendingFile);

    await expect(
      completeActiveItem({
        pendingDir,
        handoffsDir,
        templatesDir,
      }),
    ).rejects.toThrow('Simulated reset failure');

    // Pending file must still exist (not deleted before reset)
    expect(existsSync(path.join(pendingDir, pendingFile))).toBe(true);
    // .active-item must still exist
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(true);
  });
});

// ── Test 3: activateNextPendingItemIfReady rolls pmck .active-item on init failure ──

describe('activateNextPendingItemIfReady claim rollback', () => {
  let repoRoot: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use canonical AgentWorkSpace structure so resolveQueuePaths works correctly.
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-activate-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rolls pmck .active-item when initializeTaskArtifacts fails', async () => {
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

    // .active-item should NOT exist (rolled pmck)
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(false);
    // handoffsDir should remain empty
    const handoffFiles = readdirSync(handoffsDir);
    expect(handoffFiles).toEqual([]);
  });
});
