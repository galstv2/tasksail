// @vitest-environment node

import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusedRepoResult } from '../../../backend/platform/context-pack/focusedRepo';
import type { PlannerParentBranchViewRequest } from '../src/shared/desktopContract';

let repoRoot: string;
const withOriginLock = vi.fn(async (_root: string, fn: () => Promise<unknown>) => fn());
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };

vi.mock('./paths', () => ({ get REPO_ROOT() { return repoRoot; } }));
vi.mock('./log/logger', () => ({ createLogger: vi.fn(() => logger) }));
vi.mock('../../../backend/platform/core/worktreeMaterialization.js', () => ({ withOriginLock }));

function focused(root: string, childRoot = path.join(root, 'child-added')): FocusedRepoResult {
  return {
    primaryRepoRoot: root,
    visibleRepoRoots: [root, childRoot],
    declaredRepoRoots: [root, childRoot],
    estateType: 'distributed-platform',
    primaryRepoId: 'platform',
    selectedRepoIds: ['platform'],
    selectedFocusIds: [],
    authoritySource: 'manifest-primary',
    deepFocusEnabled: true,
    primaryFocusTargets: [
      { path: 'src', kind: 'directory', repoLocalPath: path.join(root, 'src'), role: 'anchor' },
    ],
    selectedTestTarget: { path: 'test', kind: 'directory', repoLocalPath: path.join(root, 'test') },
    supportTargets: [
      { path: 'docs', kind: 'directory', repoLocalPath: path.join(root, 'docs'), effectiveScope: 'full-directory' },
    ],
    readonlyContextRoots: [
      { path: 'docs', kind: 'directory', repoLocalPath: path.join(root, 'docs'), reason: 'support-target' },
    ],
    writableRoots: [
      { path: 'src', kind: 'directory', repoLocalPath: path.join(root, 'src'), reason: 'selected-primary' },
    ],
  };
}

function request(root: string): PlannerParentBranchViewRequest {
  return {
    schemaVersion: 1,
    parentTaskId: 'PARENT-1',
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    branchChainAvailability: { status: 'ready', message: 'ready' },
    branchHandoffs: [{
      repoRoot: root,
      repoLabel: 'Platform Repo',
      branch: 'task/root',
      baseCommitSha: 'abc123',
      headCommitSha: 'def4567890',
      commitsAhead: 2,
      status: 'committed',
      autoMerge: { enabled: true, status: 'ready', targetBranch: 'main', detail: 'ignored' },
    }],
  };
}

describe('plannerParentBranchView', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tasksail-parent-view-'));
    await mkdir(repoRoot, { recursive: true });
  });

  it('creates detached worktrees at handoff head sha and rewrites Lily read roots only', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const childRoot = path.join(repoRoot, 'child');
    await mkdir(originalRoot, { recursive: true });
    const normalizedOriginalRoot = await realpath(originalRoot);
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    const result = await createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot, childRoot),
      request: request(originalRoot),
      execFile,
      now: () => new Date('2026-05-21T12:00:00.000Z'),
    });

    const worktreeRoot = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-12/Platform-Repo');
    expect(execFile).toHaveBeenCalledWith('git', ['-C', normalizedOriginalRoot, 'cat-file', '-e', 'def4567890^{commit}'], expect.objectContaining({ timeout: 45_000 }));
    expect(execFile).toHaveBeenCalledWith('git', ['-C', normalizedOriginalRoot, 'worktree', 'add', '--detach', worktreeRoot, 'def4567890'], expect.objectContaining({
      env: expect.objectContaining({ GIT_LFS_SKIP_SMUDGE: '1' }),
    }));
    expect(result.status).toEqual(expect.objectContaining({ mode: 'created', worktreeCount: 1 }));
    expect(result.focused?.visibleRepoRoots).toEqual([worktreeRoot, childRoot]);
    expect(result.focused?.writableRoots?.[0]?.repoLocalPath).toBe(path.join(originalRoot, 'src'));
    expect(result.focused?.readonlyContextRoots?.[0]?.repoLocalPath).toBe(path.join(worktreeRoot, 'docs'));
    const manifest = JSON.parse(await readFile(path.join(worktreeRoot, '..', 'manifest.json'), 'utf-8'));
    expect(manifest.bindings[0]).toEqual(expect.objectContaining({
      repoRoot: normalizedOriginalRoot,
      sourceBranch: 'task/root',
      headCommitSha: 'def4567890',
      worktreeRoot,
    }));
  });

  it('fails duplicate normalized handoffs before git calls', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const payload = request(originalRoot);
    payload.branchHandoffs = [payload.branchHandoffs![0]!, { ...payload.branchHandoffs![0]!, repoLabel: 'Other' }];
    const execFile = vi.fn();
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: payload,
      execFile,
    })).rejects.toThrow('Parent branch view failed: archived parent has duplicate branch handoffs for repo');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('fails invalid handoff status before git calls', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const payload = request(originalRoot);
    payload.branchChainAvailability = { status: 'invalid-branch-handoffs', message: 'invalid' };
    const execFile = vi.fn();
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: payload,
      execFile,
    })).rejects.toThrow('Parent branch view failed: archived parent branch handoffs are invalid.');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('fails when ready handoffs match no Lily focused root', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const unrelatedRoot = path.join(repoRoot, 'tools');
    await mkdir(originalRoot, { recursive: true });
    await mkdir(unrelatedRoot, { recursive: true });
    const execFile = vi.fn();
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(unrelatedRoot),
      request: request(originalRoot),
      execFile,
    })).rejects.toThrow('Parent branch view failed: branch handoff repo does not match the selected parent scope.');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('reports missing commits before worktree creation', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('missing object'));
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: request(originalRoot),
      execFile,
    })).rejects.toThrow('Parent branch view failed: commit def4567890 from parent task PARENT-1 is missing');
    expect(execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['cat-file']), expect.anything());
    expect(execFile).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything());
  });

  it('validates source branch before commit lookup and does not fall back to head sha', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const execFile = vi.fn().mockRejectedValueOnce(new Error('missing ref'));
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: request(originalRoot),
      execFile,
    })).rejects.toThrow('Parent branch view failed: source branch task/root no longer exists in Platform-Repo. Restore the branch or choose another parent task.');

    expect(execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['rev-parse', '--verify', 'refs/heads/task/root']), expect.anything());
    expect(execFile).not.toHaveBeenCalledWith('git', expect.arrayContaining(['cat-file']), expect.anything());
    expect(execFile).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything());
  });

  it('reports worktree creation timeouts and cleans partial runtime state', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('operation timed out'), { killed: true }));
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: request(originalRoot),
      execFile,
    })).rejects.toThrow('Parent branch view failed: timed out while creating read-only worktree for Platform-Repo.');
    await expect(readFile(path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-12/manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('cleans an earlier worktree when a later source branch validation fails', async () => {
    const firstRoot = path.join(repoRoot, 'platform');
    const secondRoot = path.join(repoRoot, 'tools');
    await mkdir(firstRoot, { recursive: true });
    await mkdir(secondRoot, { recursive: true });
    const payload = request(firstRoot);
    payload.branchHandoffs = [
      payload.branchHandoffs![0]!,
      { ...payload.branchHandoffs![0]!, repoRoot: secondRoot, repoLabel: 'Tools Repo', branch: 'task/tools', headCommitSha: 'abc987' },
    ];
    const multiFocused = {
      ...focused(firstRoot),
      visibleRepoRoots: [firstRoot, secondRoot],
      declaredRepoRoots: [firstRoot, secondRoot],
    };
    const calls: string[][] = [];
    const execFile = vi.fn().mockImplementation(async (_git: string, args: string[]) => {
      calls.push(args);
      if (args.includes('refs/heads/task/tools')) {
        throw new Error('missing tools ref');
      }
      return { stdout: '', stderr: '' };
    });
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: multiFocused,
      request: payload,
      execFile,
    })).rejects.toThrow('Parent branch view failed: source branch task/tools no longer exists in Tools-Repo. Restore the branch or choose another parent task.');

    expect(calls.some((args) => args.includes('remove'))).toBe(true);
    expect(calls.some((args) => args.includes('prune'))).toBe(true);
  });

  it('skips legacy missing handoffs without mkdir or git calls', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const execFile = vi.fn();
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');
    const result = await createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/parent',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'missing-branch-handoffs', message: 'missing' },
      },
      execFile,
    });

    expect(result.status?.mode).toBe('skipped-missing-handoffs');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('cleans runtime worktrees and prunes once per repo during startup recovery', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-old');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-old',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [{ repoRoot: originalRoot, repoLabel: 'Platform', sourceBranch: 'task/root', headCommitSha: 'abc', worktreeRoot, elapsedMs: 1 }],
    }));
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { cleanupPlannerParentBranchViewSession } = await import('./plannerParentBranchView');
    await cleanupPlannerParentBranchViewSession({
      plannerSessionId: 'planner-old',
      parentTaskId: 'PARENT-1',
      sessionDir,
      manifest: JSON.parse(await readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')),
      execFile,
    });

    expect(execFile).toHaveBeenCalledWith('git', ['-C', originalRoot, 'worktree', 'remove', '--force', worktreeRoot], expect.not.objectContaining({
      env: expect.objectContaining({ GIT_LFS_SKIP_SMUDGE: '1' }),
    }));
    expect(execFile).toHaveBeenCalledWith('git', ['-C', originalRoot, 'worktree', 'prune'], expect.anything());
    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('preserves manifest for startup retry when worktree cleanup fails', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-retry');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-retry',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [{ repoRoot: originalRoot, repoLabel: 'Platform', sourceBranch: 'task/root', headCommitSha: 'abc', worktreeRoot, elapsedMs: 1 }],
    }));
    const execFile = vi.fn().mockRejectedValue(new Error('busy'));
    const { cleanupPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await cleanupPlannerParentBranchViewSession({
      plannerSessionId: 'planner-retry',
      parentTaskId: 'PARENT-1',
      sessionDir,
      manifest: JSON.parse(await readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')),
      execFile,
    });

    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).resolves.toContain('planner-retry');
  });

  it('startup recovery removes stale manifest sessions under the runtime root', async () => {
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-stale');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-stale',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [],
    }));
    const { recoverPlannerParentBranchViewsOnStartup } = await import('./plannerParentBranchView');

    await recoverPlannerParentBranchViewsOnStartup();

    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('writes a creating manifest binding before git worktree add and updates it to created', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const manifestPath = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-12/manifest.json');
    let statusAtWorktreeAdd: string | undefined;
    const execFile = vi.fn().mockImplementation(async (_git: string, args: string[]) => {
      if (args.includes('add')) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
        statusAtWorktreeAdd = manifest.bindings[0]?.status;
      }
      return { stdout: '', stderr: '' };
    });
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: request(originalRoot),
      execFile,
    });

    expect(statusAtWorktreeAdd).toBe('creating');
    const finalManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    expect(finalManifest.bindings[0].status).toBe('created');
    expect(finalManifest.bindings[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('cleans through git using the creating manifest when worktree add throws', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    await mkdir(originalRoot, { recursive: true });
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-12');
    const calls: string[][] = [];
    const execFile = vi.fn().mockImplementation(async (_git: string, args: string[]) => {
      calls.push(args);
      if (args.includes('add')) {
        throw new Error('disk full');
      }
      return { stdout: '', stderr: '' };
    });
    const { createPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await expect(createPlannerParentBranchViewSession({
      plannerSessionId: 'planner-12',
      focused: focused(originalRoot),
      request: request(originalRoot),
      execFile,
    })).rejects.toThrow('Parent branch view failed: could not create read-only worktree');

    expect(calls.some((args) => args.includes('remove'))).toBe(true);
    expect(calls.some((args) => args.includes('prune'))).toBe(true);
    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('startup recovery cleans stale sessions with creating bindings', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-creating');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-creating',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [{ repoRoot: originalRoot, repoLabel: 'Platform', sourceBranch: 'task/root', headCommitSha: 'abc', worktreeRoot, elapsedMs: 0, status: 'creating' }],
    }));
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { recoverPlannerParentBranchViewsOnStartup } = await import('./plannerParentBranchView');

    await recoverPlannerParentBranchViewsOnStartup(execFile);

    expect(execFile).toHaveBeenCalledWith('git', ['-C', originalRoot, 'worktree', 'remove', '--force', worktreeRoot], expect.anything());
    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('startup recovery cleans stale sessions with created bindings', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-created');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-created',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [{ repoRoot: originalRoot, repoLabel: 'Platform', sourceBranch: 'task/root', headCommitSha: 'abc', worktreeRoot, elapsedMs: 5, status: 'created' }],
    }));
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { recoverPlannerParentBranchViewsOnStartup } = await import('./plannerParentBranchView');

    await recoverPlannerParentBranchViewsOnStartup(execFile);

    expect(execFile).toHaveBeenCalledWith('git', ['-C', originalRoot, 'worktree', 'prune'], expect.anything());
    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  it('startup recovery preserves a manifestless directory that holds a git worktree checkout', async () => {
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-crashed');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(worktreeRoot, { recursive: true });
    await writeFile(path.join(worktreeRoot, '.git'), 'gitdir: /somewhere/.git/worktrees/Platform\n');
    const { recoverPlannerParentBranchViewsOnStartup } = await import('./plannerParentBranchView');

    await recoverPlannerParentBranchViewsOnStartup();

    await expect(readFile(path.join(worktreeRoot, '.git'), 'utf-8')).resolves.toContain('gitdir:');
    expect(logger.warn).toHaveBeenCalledWith(
      'planner.parent-branch-view.recovery.preserved-unsafe-directory',
      expect.objectContaining({ sessionDir }),
    );
  });

  it('startup recovery removes a manifestless non-worktree directory inside the runtime root', async () => {
    const runtimeRoot = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views');
    const sessionDir = path.join(runtimeRoot, 'planner-empty');
    await mkdir(path.join(sessionDir, 'nested'), { recursive: true });
    const { recoverPlannerParentBranchViewsOnStartup } = await import('./plannerParentBranchView');

    await recoverPlannerParentBranchViewsOnStartup();

    await expect(readdir(runtimeRoot)).resolves.not.toContain('planner-empty');
  });

  it('treats an already-removed worktree as idempotent cleanup success and removes the session directory', async () => {
    const originalRoot = path.join(repoRoot, 'platform');
    const sessionDir = path.join(repoRoot, '.platform-state/runtime/planner-parent-branch-views/planner-gone');
    const worktreeRoot = path.join(sessionDir, 'Platform');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      plannerSessionId: 'planner-gone',
      parentTaskId: 'PARENT-1',
      contextPackDir: '/packs/parent',
      createdAt: '2026-05-21T12:00:00.000Z',
      bindings: [{ repoRoot: originalRoot, repoLabel: 'Platform', sourceBranch: 'task/root', headCommitSha: 'abc', worktreeRoot, elapsedMs: 1, status: 'creating' }],
    }));
    const execFile = vi.fn().mockImplementation(async (_git: string, args: string[]) => {
      if (args.includes('remove')) {
        throw new Error(`fatal: '${worktreeRoot}' is not a working tree`);
      }
      return { stdout: '', stderr: '' };
    });
    const { cleanupPlannerParentBranchViewSession } = await import('./plannerParentBranchView');

    await cleanupPlannerParentBranchViewSession({
      plannerSessionId: 'planner-gone',
      parentTaskId: 'PARENT-1',
      sessionDir,
      manifest: JSON.parse(await readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')),
      execFile,
    });

    expect(execFile).toHaveBeenCalledWith('git', ['-C', originalRoot, 'worktree', 'prune'], expect.anything());
    await expect(readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')).rejects.toThrow();
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });
});
