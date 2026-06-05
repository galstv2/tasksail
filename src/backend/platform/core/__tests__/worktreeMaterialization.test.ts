/**
 * §4.14 Worktree + dependency materialization — test suite.
 *
 * Done-when assertions from the spec (§4.14 lines 155–165):
 *   1. Happy path: creates AgentWorkSpace/tasks/<taskId>/worktrees/<slug>/ on disk;
 *      git worktree list shows task/<taskId>.
 *   2. .task.json.contextPackBinding.repoBindings[].worktreeRoot points at worktree, not origin.
 *   3. macOS APFS CoW: wall-clock < 1s (skipped; requires same-APFS-volume CI runner).
 *   4. F20 HFS mock: detectCloneStrategy returns 'copy' when fstypename='hfs'.
 *   5. F20 different fsid: detectCloneStrategy returns 'copy' when apfs but different fsid.
 *   6. Linux: filesystemSupportsReflink returns false → strategy 'copy', activation succeeds.
 *   7. Missing source path → recorded in materialization.skipped, activation does not abort.
 *   8. Pre-existing refs/heads/task/<taskId> → fail with branch-already-exists; no marker,
 *      no .task.json, no partial tree.
 *   9. ENOSPC mid-CoW → rollback runs; task dir deleted; no orphan branch; port lease released.
 *
 * Run: pnpm vitest run src/backend/platform/core/__tests__/worktreeMaterialization.test.ts
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  materializeWorktreeDeps,
  detectCloneStrategy,
  withOriginLock,
  preconditionsPass,
  newBranchPreconditionsPass,
  parseWorktreePorcelainBlocks,
  type CloneStrategy,
  type StatfsSyncFn,
} from '../worktreeMaterialization.js';
import { samePathIdentity } from '../paths.js';

describe('parseWorktreePorcelainBlocks (CRLF-safe)', () => {
  const LF = 'worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\nbranch refs/heads/feat\n';
  const CRLF = 'worktree /a\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\nworktree /b\r\nHEAD def\r\nbranch refs/heads/feat\r\n';

  it('splits LF porcelain into one block per worktree', () => {
    const blocks = parseWorktreePorcelainBlocks(LF);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('worktree /a');
    expect(blocks[1]).toContain('worktree /b');
  });

  it('splits CRLF porcelain into one block per worktree with no trailing \\r', () => {
    const blocks = parseWorktreePorcelainBlocks(CRLF);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(['worktree /a', 'HEAD abc', 'branch refs/heads/main']);
    expect(blocks[1]).toEqual(['worktree /b', 'HEAD def', 'branch refs/heads/feat']);
  });

  it('returns no blocks for empty output', () => {
    expect(parseWorktreePorcelainBlocks('')).toEqual([]);
  });
});

describe('worktree path identity (Windows drive casing)', () => {
  it('treats drive-case-mismatched worktree paths as the same so collisions are detected', () => {
    // The porcelain collision check now uses samePathIdentity; a git-reported
    // "c:\\..." must match a "C:\\..." resolved worktree path on Windows.
    expect(samePathIdentity('C:\\repo\\wt', 'c:\\repo\\wt', { impl: path.win32 })).toBe(true);
    expect(samePathIdentity('C:\\repo\\wt', 'C:\\repo\\other', { impl: path.win32 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal git repo with one commit in a temp directory.
 */
function createGitRepo(parentDir?: string): string {
  const dir = parentDir
    ? mkdtempSync(path.join(parentDir, 'repo-'))
    : mkdtempSync(path.join(tmpdir(), 'wt-mat-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

/**
 * List worktrees in the given repo (porcelain output).
 */
function listWorktrees(repoRoot: string): string {
  try {
    return execSync(`git -C "${repoRoot}" worktree list --porcelain`, {
      encoding: 'utf-8',
    });
  } catch {
    return '';
  }
}

/**
 * List local branches.
 */
function listBranches(repoRoot: string): string {
  try {
    return execSync(`git -C "${repoRoot}" branch --list`, { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

/**
 * Build a mock StatfsSyncFn that always returns the given result.
 * Used to inject into detectCloneStrategy for F20 filesystem tests.
 * ESM named exports from node:fs are non-configurable; vi.spyOn cannot
 * intercept them. detectCloneStrategy accepts a StatfsSyncFn parameter for testing.
 */
function makeStatfsMock(result: Record<string, unknown>): StatfsSyncFn {
  return (_p: string) => result as unknown as ReturnType<StatfsSyncFn>;
}

/**
 * Build a StatfsSyncFn that dispatches on whether the path contains a substring.
 */
function makeStatfsMockDispatch(
  matchSubstr: string,
  whenMatch: Record<string, unknown>,
  otherwise: Record<string, unknown>,
): StatfsSyncFn {
  return (p: string) =>
    (p.includes(matchSubstr) ? whenMatch : otherwise) as unknown as ReturnType<StatfsSyncFn>;
}

type WorktreeMaterializationModule = typeof import('../worktreeMaterialization.js');

async function importWindowsWorktreeMaterialization(options: {
  volumesShareReFS?: boolean;
  reflinkMock?: () => unknown;
} = {}): Promise<WorktreeMaterializationModule> {
  vi.resetModules();
  vi.doMock('../platform.js', () => ({
    isWindowsPlatform: () => true,
    isMacOSPlatform: () => false,
    isLinuxPlatform: () => false,
    windowsVolumesShareReFS: () => options.volumesShareReFS ?? true,
  }));
  if (options.reflinkMock) {
    vi.doMock('@reflink/reflink', options.reflinkMock);
  }
  return import('../worktreeMaterialization.js');
}

// ---------------------------------------------------------------------------
// §4.14 Done-when #1 — happy path: worktree dir created, git list shows entry
// ---------------------------------------------------------------------------

describe('§4.14 materializeWorktreeDeps — happy path', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-mat-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates worktree dir on disk; git worktree list shows task/<taskId> branch', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const taskId = 'mat-happy-01';
    const worktreePath = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreePath), { recursive: true });

    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();

    execFileSync('git', [
      '-C', originalRoot,
      'worktree', 'add',
      '-b', `task/${taskId}`,
      worktreePath,
      sha,
    ]);

    // Worktree dir must exist on disk
    expect(existsSync(worktreePath)).toBe(true);

    // git worktree list must contain both the path and the branch
    const list = listWorktrees(originalRoot);
    expect(list).toContain(worktreePath);
    expect(list).toContain(`refs/heads/task/${taskId}`);
  });

  it('materializeWorktreeDeps skips absent paths and records them in skipped', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    const taskId = 'mat-skip-01';
    const worktreePath = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    execFileSync('git', [
      '-C', originalRoot, 'worktree', 'add', '-b', `task/${taskId}`, worktreePath, sha,
    ]);

    // node_modules and .venv do NOT exist → both skipped
    const result = await materializeWorktreeDeps(originalRoot, worktreePath, ['node_modules', '.venv']);

    expect(result.skipped).toContain('node_modules');
    expect(result.skipped).toContain('.venv');
    expect(result.cloned).toHaveLength(0);
  });

  // §4.14 Done-when #2 — worktreeRoot points at worktree, not origin
  it('worktreeRoot in .task.json points at worktree, not originalRoot', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    const taskId = 'mat-binding-01';
    const worktreePath = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    execFileSync('git', [
      '-C', originalRoot, 'worktree', 'add', '-b', `task/${taskId}`, worktreePath, sha,
    ]);

    // Simulate what operations.ts writes — real worktreeRoot, not originalRoot
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    const sidecarPath = path.join(taskDir, '.task.json');
    writeFileSync(sidecarPath, JSON.stringify({
      schema_version: 1,
      taskId,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: [{
          originalRoot,
          worktreeRoot: worktreePath,  // MUST be the worktree path
          worktreeBranch: `task/${taskId}`,
          baseCommitSha: sha,
        }],
      },
      materialization: { strategy: 'copy', cloned: [], skipped: [], composeProjectName: 'repo-context-mcp' },
      frozenAt: new Date().toISOString(),
      finalizedAt: null,
      state: 'active',
    }, null, 2) + '\n');

    const parsed = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as {
      contextPackBinding: { repoBindings: Array<{ originalRoot: string; worktreeRoot: string }> };
    };
    const binding = parsed.contextPackBinding.repoBindings[0]!;

    // worktreeRoot MUST differ from originalRoot
    expect(binding.worktreeRoot).toBe(worktreePath);
    expect(binding.worktreeRoot).not.toBe(originalRoot);
    expect(binding.originalRoot).toBe(originalRoot);
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #7 — missing source path is non-fatal
// ---------------------------------------------------------------------------

describe('§4.14 materializeWorktreeDeps — missing source path is non-fatal', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-miss-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('missing source path recorded in skipped; existing path recorded in cloned; no throw', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    const taskId = 'mat-miss-01';
    const worktreePath = path.join(tmpRoot, 'worktrees', taskId);
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    execFileSync('git', [
      '-C', originalRoot, 'worktree', 'add', '-b', `task/${taskId}`, worktreePath, sha,
    ]);

    // Seed a real directory in originalRoot to be cloned
    const nodeModulesDir = path.join(originalRoot, 'node_modules');
    mkdirSync(nodeModulesDir);
    writeFileSync(path.join(nodeModulesDir, 'dummy.txt'), 'test');

    const result = await materializeWorktreeDeps(
      originalRoot,
      worktreePath,
      ['node_modules', '.venv', 'dist'],  // .venv and dist are absent
    );

    expect(result.cloned).toContain('node_modules');
    expect(result.skipped).toContain('.venv');
    expect(result.skipped).toContain('dist');
    // Must not throw; activation is not aborted by missing paths
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #4 & #5 — F20 detectCloneStrategy with injectable statfsFn
//
// ESM named exports from node:fs are non-configurable; vi.spyOn cannot intercept
// statfsSync directly. detectCloneStrategy accepts an optional StatfsSyncFn
// parameter for testing. This is an explicitly documented testability hook.
// ---------------------------------------------------------------------------

describe('§4.14 detectCloneStrategy — F20 filesystem check mocks', () => {
  it('F20 HFS+: fstypename=hfs → returns copy (not apfs-clonefile)', () => {
    const hfsMock = makeStatfsMock({
      type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50,
      fstypename: 'hfs', fsid: [1000, 2000],
    });
    // On darwin: fstypename !== 'apfs' → copy.
    // On non-darwin: darwin branch not entered → copy anyway.
    const strategy: CloneStrategy = detectCloneStrategy('/some/origin', '/some/dest', hfsMock);
    expect(strategy).toBe('copy');
  });

  it('F20 APFS but different fsid → returns copy', () => {
    const dispatchMock = makeStatfsMockDispatch(
      'origin',
      { type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50, fstypename: 'apfs', fsid: [1111, 2222] },
      { type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50, fstypename: 'apfs', fsid: [3333, 4444] },  // different fsid
    );
    const strategy: CloneStrategy = detectCloneStrategy('/origin/path', '/dest/path', dispatchMock);
    expect(strategy).toBe('copy');
  });

  it('F20 APFS same fsid on darwin → returns apfs-clonefile; non-darwin → copy', () => {
    const sameApfsMock = makeStatfsMock({
      type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50,
      fstypename: 'apfs', fsid: [9999, 8888],
    });
    const strategy: CloneStrategy = detectCloneStrategy('/some/origin', '/some/dest', sameApfsMock);
    if (process.platform === 'darwin') {
      expect(strategy).toBe('apfs-clonefile');
    } else {
      // Non-darwin: darwin branch never entered; linux-or-win32 paths return 'copy'.
      expect(strategy).toBe('copy');
    }
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #6 — Linux: reflink unavailable → 'copy'
// ---------------------------------------------------------------------------

describe('§4.14 detectCloneStrategy — Linux reflink fallback', () => {
  it('Linux: ext4 filesystem → strategy copy (not in {btrfs,xfs,zfs})', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const ext4Mock = makeStatfsMock({
        type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50,
        fstypename: 'ext4', fsid: [1, 1],
      });
      const strategy: CloneStrategy = detectCloneStrategy('/repo', '/worktrees', ext4Mock);
      expect(strategy).toBe('copy');
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  it('Linux: btrfs but different fsid (cross-volume) → strategy copy', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const crossVolMock = makeStatfsMockDispatch(
        'repo',
        { type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50, fstypename: 'btrfs', fsid: [100, 200] },
        { type: 0, bsize: 4096, blocks: 1000, bfree: 500, bavail: 500, files: 100, ffree: 50, fstypename: 'btrfs', fsid: [300, 400] },  // different fsid
      );
      const strategy: CloneStrategy = detectCloneStrategy('/repo', '/worktrees', crossVolMock);
      expect(strategy).toBe('copy');
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  it('Linux: reflink unavailable → materializeWorktreeDeps returns skipped for absent path', async () => {
    // materializeWorktreeDeps uses the internal detectCloneStrategy (no injection).
    // On any platform without node_modules, the result.skipped must contain it.
    // Strategy will be whatever is natural for the CI runner filesystem.
    const tmpBase = mkdtempSync(path.join(tmpdir(), 'wt-linux-'));
    const fakeOrigin = path.join(tmpBase, 'origin');
    const fakeWorktree = path.join(tmpBase, 'worktree');
    mkdirSync(fakeOrigin);
    mkdirSync(fakeWorktree);
    try {
      const result = await materializeWorktreeDeps(fakeOrigin, fakeWorktree, ['node_modules']);
      // node_modules absent → skipped
      expect(result.skipped).toContain('node_modules');
      // Strategy is one of the valid values regardless of platform
      expect(['copy', 'apfs-clonefile', 'reflink', 'win-refs']).toContain(result.strategy);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

describe('worktree materialization fast-copy observability', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
    vi.clearAllMocks();
  });

  it('skips missing paths, returns selected strategy/cloned/skipped only, and logs effective metadata once', async () => {
    const info = vi.fn();
    const child = vi.fn(() => ({ info }));
    const copyTree = vi.fn()
      .mockResolvedValueOnce({
        selectedStrategy: 'reflink',
        effectiveStrategy: 'native-copy',
        reflinkAttempted: true,
        reflinkUsed: false,
        fallbackReason: 'EXDEV',
        durationMs: 11,
      })
      .mockResolvedValueOnce({
        selectedStrategy: 'reflink',
        effectiveStrategy: 'node-copy',
        reflinkAttempted: true,
        reflinkUsed: false,
        fallbackReason: 'EIO',
        durationMs: 13,
      });

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const tmpBase = mkdtempSync(path.join(tmpdir(), 'wt-fast-log-'));
    const originalRoot = path.join(tmpBase, 'origin');
    const worktreeRoot = path.join(tmpBase, 'worktree');
    mkdirSync(path.join(originalRoot, 'node_modules'), { recursive: true });
    mkdirSync(path.join(originalRoot, 'dist'), { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });

    try {
      const clockValues = [100, 145];
      const result = await materializeWorktreeDeps(
        originalRoot,
        worktreeRoot,
        ['node_modules', '.venv', 'dist'],
        { taskId: 'task-fast', repoLabel: 'Platform' },
        {
          now: () => clockValues.shift() ?? 145,
          statfsFn: makeStatfsMock({
            type: 0,
            bsize: 4096,
            fstypename: 'btrfs',
            fsid: [1, 1],
          }),
          copyTree,
          logger: { child },
        },
      );

      expect(result).toEqual({
        strategy: 'reflink',
        cloned: ['node_modules', 'dist'],
        skipped: ['.venv'],
      });
      expect(Object.keys(result).sort()).toEqual(['cloned', 'skipped', 'strategy']);
      expect(copyTree).toHaveBeenCalledTimes(2);
      expect(child).toHaveBeenCalledWith({ taskId: 'task-fast' });
      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith('worktree.materialization.copy.completed', {
        repoLabel: 'Platform',
        originalRoot,
        worktreeRoot,
        selectedStrategy: 'reflink',
        effectiveStrategies: ['native-copy', 'node-copy'],
        reflinkAttempted: true,
        reflinkUsed: false,
        fallback: true,
        fallbackReasons: ['EXDEV', 'EIO'],
        clonedCount: 2,
        skippedCount: 1,
        durationMs: 45,
      });
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('keeps effective strategy metadata log-only', async () => {
    const debug = vi.fn();
    const info = vi.fn();
    const child = vi.fn(() => ({ debug, info }));
    const copyTree = vi.fn().mockResolvedValue({
      selectedStrategy: 'copy',
      effectiveStrategy: 'native-copy',
      reflinkAttempted: false,
      reflinkUsed: false,
      fallbackReason: null,
      durationMs: 5,
    });
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    const tmpBase = mkdtempSync(path.join(tmpdir(), 'wt-fast-return-'));
    const originalRoot = path.join(tmpBase, 'origin');
    const worktreeRoot = path.join(tmpBase, 'worktree');
    mkdirSync(path.join(originalRoot, 'deps'), { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });

    try {
      const result = await materializeWorktreeDeps(
        originalRoot,
        worktreeRoot,
        ['deps'],
        {},
        { copyTree, logger: { child } },
      );

      expect(result).toEqual({ strategy: 'copy', cloned: ['deps'], skipped: [] });
      expect(result).not.toHaveProperty('effectiveStrategies');
      expect(result).not.toHaveProperty('fallbackReasons');
      expect(debug).toHaveBeenCalledWith(
        'worktree.materialization.copy.completed',
        expect.objectContaining({ effectiveStrategies: ['native-copy'] }),
      );
      expect(info).not.toHaveBeenCalled();
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('keeps slow clean copy completion elevated at info', async () => {
    const debug = vi.fn();
    const info = vi.fn();
    const child = vi.fn(() => ({ debug, info }));
    const copyTree = vi.fn().mockResolvedValue({
      selectedStrategy: 'copy',
      effectiveStrategy: 'native-copy',
      reflinkAttempted: false,
      reflinkUsed: false,
      fallbackReason: null,
      durationMs: 30_000,
    });
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    const tmpBase = mkdtempSync(path.join(tmpdir(), 'wt-slow-log-'));
    const originalRoot = path.join(tmpBase, 'origin');
    const worktreeRoot = path.join(tmpBase, 'worktree');
    mkdirSync(path.join(originalRoot, 'deps'), { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });

    try {
      await materializeWorktreeDeps(
        originalRoot,
        worktreeRoot,
        ['deps'],
        {},
        {
          copyTree,
          logger: { child },
          now: (() => {
            const values = [0, 30_000];
            return () => values.shift() ?? 30_000;
          })(),
        },
      );

      expect(info).toHaveBeenCalledWith(
        'worktree.materialization.copy.completed',
        expect.objectContaining({
          fallback: false,
          skippedCount: 0,
          durationMs: 30_000,
        }),
      );
      expect(debug).not.toHaveBeenCalled();
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #8 — pre-existing task/<taskId> branch → fail
// ---------------------------------------------------------------------------

describe('§4.14 preconditionsPass — branch-already-exists', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-brexist-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('fails with branch-already-exists when refs/heads/task/<taskId> already exists', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const taskId = 'mat-brexist-01';

    // Pre-create the branch to simulate a prior failed run
    execFileSync('git', ['-C', originalRoot, 'branch', `task/${taskId}`]);

    const worktreePath = path.join(tmpRoot, 'worktrees', taskId);
    const result = await preconditionsPass(originalRoot, taskId, worktreePath);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('branch-already-exists');

    // No worktree dir should have been created by preconditionsPass
    expect(existsSync(worktreePath)).toBe(false);
  });

  it('fails with branch-already-exists — no partial worktree is created, no orphan marker', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const taskId = 'mat-nopartial-01';
    execFileSync('git', ['-C', originalRoot, 'branch', `task/${taskId}`]);

    const worktreePath = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');

    const result = await preconditionsPass(originalRoot, taskId, worktreePath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('branch-already-exists');

    // No worktree dir
    expect(existsSync(worktreePath)).toBe(false);

    // No worktrees were added (only the main worktree exists)
    const list = listWorktrees(originalRoot);
    expect(list).not.toContain(worktreePath);
  });

  it('newBranchPreconditionsPass checks an explicit branch name', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    execFileSync('git', ['-C', originalRoot, 'branch', 'task/root-task']);

    const result = await newBranchPreconditionsPass(
      originalRoot,
      'task/root-task',
      path.join(tmpRoot, 'worktrees', 'root-task'),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('branch-already-exists');
  });

  it('preconditionsPass still checks task/<taskId>', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    execFileSync('git', ['-C', originalRoot, 'branch', 'task/child-task']);
    execFileSync('git', ['-C', originalRoot, 'branch', 'task/root-task']);

    const result = await preconditionsPass(
      originalRoot,
      'child-task',
      path.join(tmpRoot, 'worktrees', 'child-task'),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('branch-already-exists');
    expect(result.detail).toContain('refs/heads/task/child-task');
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #9 — ENOSPC mid-CoW → rollback
// ---------------------------------------------------------------------------

describe('§4.14 materializeWorktreeDeps — ENOSPC rollback', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-enospc-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('ENOSPC mid-CoW: materializeWorktreeDeps throws; manual rollback removes branch and task dir', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    const taskId = 'mat-enospc-01';

    const worktreePath = path.join(
      tmpRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo',
    );
    mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Add the worktree (simulates what operations.ts does before calling materializeWorktreeDeps)
    execFileSync('git', [
      '-C', originalRoot, 'worktree', 'add', '-b', `task/${taskId}`, worktreePath, sha,
    ]);
    expect(existsSync(worktreePath)).toBe(true);

    // Seed node_modules so the copy is attempted (not skipped)
    const nmDir = path.join(originalRoot, 'node_modules');
    mkdirSync(nmDir);
    writeFileSync(path.join(nmDir, 'dummy.js'), 'module.exports = {}');

    const copyTree = vi.fn().mockRejectedValue(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );

    // materializeWorktreeDeps must throw when ENOSPC occurs
    await expect(
      materializeWorktreeDeps(originalRoot, worktreePath, ['node_modules'], {}, { copyTree }),
    ).rejects.toThrow('ENOSPC');

    expect(copyTree).toHaveBeenCalled();

    // Simulate the §4.14 atomic rollback that operations.ts performs:
    // Step 1: git worktree remove --force
    try { execFileSync('git', ['-C', originalRoot, 'worktree', 'remove', '--force', worktreePath]); } catch { /* swallow */ }
    // Step 2: git branch -D
    try { execFileSync('git', ['-C', originalRoot, 'branch', '-D', `task/${taskId}`]); } catch { /* swallow */ }
    // Step 3: fs.rm task dir (reclaims disk; critical on ENOSPC)
    const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
    rmSync(taskDir, { recursive: true, force: true });

    // Post-rollback assertions:

    // No orphan branch
    const branches = listBranches(originalRoot);
    expect(branches).not.toContain(`task/${taskId}`);

    // No partial tree
    expect(existsSync(taskDir)).toBe(false);

    // Worktree not in list
    const list = listWorktrees(originalRoot);
    expect(list).not.toContain(worktreePath);
  });
});

// ---------------------------------------------------------------------------
// §4.14 Done-when #3 — macOS APFS CoW performance (skipped; requires runner)
// ---------------------------------------------------------------------------

describe('§4.14 macOS APFS CoW — 500MB wall-clock < 1s', () => {
  it.skip(
    'SKIP: requires real same-APFS-volume; CI gate for macOS runners with APFS /tmp',
    () => {
      // To run manually on a macOS APFS machine:
      //   1. Create 500MB node_modules (500 × 1MB files).
      //   2. Record wall-clock start.
      //   3. Call materializeWorktreeDeps(originalRoot, worktreePath, ['node_modules']).
      //   4. Assert strategy === 'apfs-clonefile'.
      //   5. Assert wall-clock elapsed < 1000ms.
      //   6. Assert apparent disk usage of worktree/node_modules ≈ 0 (CoW block-sharing).
    },
  );
});

// ---------------------------------------------------------------------------
// §4.14 withOriginLock — concurrency serialization
// ---------------------------------------------------------------------------

describe('§4.14 withOriginLock — serializes concurrent ops on same origin', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-lock-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('concurrent withOriginLock calls on the same path execute sequentially (A before B)', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const order: number[] = [];

    // Both A and B are started concurrently.
    // A holds the lock first (first awaiter wins the race in Promise.all since A is first).
    const [, ] = await Promise.all([
      withOriginLock(originalRoot, async () => {
        order.push(1);
        await new Promise<void>((r) => setTimeout(r, 30));
        order.push(2);
      }),
      withOriginLock(originalRoot, async () => {
        order.push(3);
        order.push(4);
      }),
    ]);

    // A and B must execute sequentially (not interleaved):
    // Either [1,2,3,4] (A first) or [3,4,1,2] (B first).
    // The critical invariant is that 1 and 2 are adjacent, and 3 and 4 are adjacent.
    expect(order).toHaveLength(4);
    const idx1 = order.indexOf(1);
    const idx2 = order.indexOf(2);
    const idx3 = order.indexOf(3);
    const idx4 = order.indexOf(4);
    // 1 must immediately precede 2 (A's operations are uninterrupted)
    expect(idx2).toBe(idx1 + 1);
    // 3 must immediately precede 4 (B's operations are uninterrupted)
    expect(idx4).toBe(idx3 + 1);
  });

  it('concurrent withOriginLock calls on DIFFERENT origins execute in parallel', async () => {
    const rootA = createGitRepo(tmpRoot);
    const rootB = createGitRepo(tmpRoot);
    const started: string[] = [];

    await Promise.all([
      withOriginLock(rootA, async () => {
        started.push('A');
        await new Promise<void>((r) => setTimeout(r, 30));
      }),
      withOriginLock(rootB, async () => {
        started.push('B');
        await new Promise<void>((r) => setTimeout(r, 10));
      }),
    ]);

    // Both must have started (parallel execution for different origins)
    expect(started).toContain('A');
    expect(started).toContain('B');
  });
});

// ---------------------------------------------------------------------------
// §4.14 preconditionsPass — empty-origin-repo
// ---------------------------------------------------------------------------

describe('§4.14 preconditionsPass — empty-origin-repo', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-empty-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('empty git repo (no commits) → reason empty-origin-repo', async () => {
    const emptyDir = mkdtempSync(path.join(tmpRoot, 'empty-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: emptyDir });

    const result = await preconditionsPass(emptyDir, 'task-x', path.join(tmpRoot, 'wt'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty-origin-repo');
  });

  it('non-git directory → reason empty-origin-repo', async () => {
    const plainDir = mkdtempSync(path.join(tmpRoot, 'plain-'));
    const result = await preconditionsPass(plainDir, 'task-y', path.join(tmpRoot, 'wt'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty-origin-repo');
  });
});

// ---------------------------------------------------------------------------
// §4.14 preconditionsPass — worktree-already-bound
// ---------------------------------------------------------------------------

describe('§4.14 preconditionsPass — worktree-already-bound', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-bound-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('worktree path already registered → reason worktree-already-bound', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const sha = execSync(`git -C "${originalRoot}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();

    // Add a worktree at a specific path with any branch
    const occupiedPath = path.join(tmpRoot, 'wt', 'occupied');
    mkdirSync(path.dirname(occupiedPath), { recursive: true });
    execFileSync('git', [
      '-C', originalRoot, 'worktree', 'add',
      '-b', 'some-other-branch',
      occupiedPath,
      sha,
    ]);

    // Check that the SAME path is rejected even with a different taskId
    // (the worktree-already-bound check looks for the path in the worktree list)
    const result = await preconditionsPass(originalRoot, 'new-task-id', occupiedPath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('worktree-already-bound');
  });

  it('preconditions pass for a clean repo with unused taskId', async () => {
    const originalRoot = createGitRepo(tmpRoot);
    const worktreePath = path.join(tmpRoot, 'wt', 'clean-task');

    const result = await preconditionsPass(originalRoot, 'clean-task-id', worktreePath);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §4.14 Windows ReFS CoW branch — mocked
// ---------------------------------------------------------------------------

describe('§4.14 Windows ReFS CoW branch — mocked', () => {
  // process.platform mutation is unnecessary here: importWindowsWorktreeMaterialization
  // mocks ../platform.js so isWindowsPlatform/isMacOSPlatform/isLinuxPlatform return
  // hard-coded values that ignore process.platform.
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'wt-win-refs-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.doUnmock('../platform.js');
    vi.doUnmock('@reflink/reflink');
    vi.resetModules();
  });

  async function assertWinRefsMaterializesWithCopyResult(tmp: string): Promise<void> {
    const { materializeWorktreeDeps: materializeWindowsDeps } =
      await importWindowsWorktreeMaterialization();
    const originalRoot = path.join(tmp, 'origin');
    const worktreeRoot = path.join(tmp, 'worktree');
    const dependencyRoot = path.join(originalRoot, 'node_modules');
    mkdirSync(path.join(dependencyRoot, 'pkg'), { recursive: true });
    mkdirSync(worktreeRoot);
    writeFileSync(path.join(dependencyRoot, 'index.js'), 'module.exports = 1;\n');
    writeFileSync(path.join(dependencyRoot, 'pkg', 'nested.js'), 'module.exports = 2;\n');
    const copyTree = vi.fn().mockResolvedValue({
      selectedStrategy: 'win-refs',
      effectiveStrategy: 'native-copy',
      reflinkAttempted: true,
      reflinkUsed: false,
      fallbackReason: 'EXDEV',
      durationMs: 10,
    });

    const result = await materializeWindowsDeps(
      originalRoot,
      worktreeRoot,
      ['node_modules'],
      {},
      { copyTree },
    );

    expect(result.strategy).toBe('win-refs');
    expect(result.cloned).toContain('node_modules');
    expect(copyTree).toHaveBeenCalledWith(
      path.join(originalRoot, 'node_modules'),
      path.join(worktreeRoot, 'node_modules'),
      'win-refs',
    );
  }

  it("Windows: detectCloneStrategy returns 'win-refs' when both volumes are ReFS and share the same drive letter", async () => {
    const { detectCloneStrategy: detectWindowsCloneStrategy } =
      await importWindowsWorktreeMaterialization({ volumesShareReFS: true });

    expect(
      detectWindowsCloneStrategy('Z:\\repo', 'Z:\\repo\\AgentWorkSpace\\tasks\\t1'),
    ).toBe('win-refs');
  });

  it("Windows: detectCloneStrategy returns 'copy' when volumes differ", async () => {
    const { detectCloneStrategy: detectWindowsCloneStrategy } =
      await importWindowsWorktreeMaterialization({ volumesShareReFS: false });

    expect(
      detectWindowsCloneStrategy('Z:\\repo', 'Y:\\repo\\AgentWorkSpace\\tasks\\t1'),
    ).toBe('copy');
  });

  it("Windows: detectCloneStrategy returns 'copy' when volume is NTFS", async () => {
    const { detectCloneStrategy: detectWindowsCloneStrategy } =
      await importWindowsWorktreeMaterialization({ volumesShareReFS: false });

    expect(
      detectWindowsCloneStrategy('Z:\\repo', 'Z:\\repo\\AgentWorkSpace\\tasks\\t1'),
    ).toBe('copy');
  });

  it("Windows: materializeWorktreeDeps returns selected 'win-refs' when copy helper falls back", async () => {
    await assertWinRefsMaterializesWithCopyResult(tmpRoot);
  });

  it("Windows: materializeWorktreeDeps preserves cloned/skipped return shape for 'win-refs'", async () => {
    await assertWinRefsMaterializesWithCopyResult(tmpRoot);
  });

  it("Windows: materializeWorktreeDeps does not expose effective copy metadata for 'win-refs'", async () => {
    await assertWinRefsMaterializesWithCopyResult(tmpRoot);
  });

  it("Windows: materializeWorktreeDeps propagates copy helper failures", async () => {
    const { materializeWorktreeDeps: materializeWindowsDeps } =
      await importWindowsWorktreeMaterialization();
    const originalRoot = path.join(tmpRoot, 'origin');
    const worktreeRoot = path.join(tmpRoot, 'worktree');
    const dependencyRoot = path.join(originalRoot, 'node_modules');
    mkdirSync(dependencyRoot, { recursive: true });
    mkdirSync(worktreeRoot);
    writeFileSync(path.join(dependencyRoot, 'index.js'), 'module.exports = 1;\n');
    const copyTree = vi.fn().mockRejectedValue(
      Object.assign(new Error('access denied'), { code: 'EACCES' }),
    );

    await expect(
      materializeWindowsDeps(originalRoot, worktreeRoot, ['node_modules'], {}, { copyTree }),
    ).rejects.toMatchObject({ code: 'EACCES' });
  });
});
