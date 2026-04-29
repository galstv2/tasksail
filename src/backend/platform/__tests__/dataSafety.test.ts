/**
 * §4.16 Data-safety gate — must pass before maxParallelTasks > 1 is enabled.
 *
 * Contract: invoking moveFailedItemToErrorItems (§4.14A) MUST NOT modify any
 * file in the original working tree of a bound git repo. The operator's
 * local-notes.txt (or any other untracked file) must survive byte-identical.
 *
 * Run: pnpm vitest run src/backend/platform/__tests__/dataSafety.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { moveFailedItemToErrorItems } from '../queue/errorItems.js';
import { _clearPlatformConfigCache } from '../platform-config/get.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** sha256 of a file's bytes on disk. */
function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Create a minimal git repo with one commit.
 * Returns the repo root (absolute path in a fresh tmpdir).
 */
function createGitRepo(parentDir: string): string {
  const dir = mkdtempSync(path.join(parentDir, 'ds-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(path.join(dir, 'README.md'), '# Fixture repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * Write a full platform.json so getPlatformConfig does not throw.
 */
function writePlatformJson(
  repoRoot: string,
  retainFailed: boolean,
): void {
  const platformStateDir = path.join(repoRoot, '.platform-state');
  mkdirSync(platformStateDir, { recursive: true });
  const cfg = {
    schema_version: 1,
    container_runtime: 'docker',
    max_parallel_tasks: 2,
    retain_failed_task_worktrees: retainFailed,
    max_retained_failed_task_worktrees: 5,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  };
  writeFileSync(
    path.join(platformStateDir, 'platform.json'),
    JSON.stringify(cfg, null, 2) + '\n',
  );
}

/**
 * Write a minimal task-registry.json with the task in `active` state.
 */
function writeTaskRegistry(repoRoot: string, taskId: string): void {
  const platformStateDir = path.join(repoRoot, '.platform-state');
  mkdirSync(platformStateDir, { recursive: true });
  const registry = {
    schema_version: 2,
    tasks: {
      '_unbound': {
        open: [],
        pending: [],
        active: [
          {
            taskId,
            fileName: `${taskId}.md`,
            title: 'Data safety fixture task',
            state: 'active',
            contextPackId: null,
            contextPackDir: null,
            scopeMode: null,
            selectedRepoIds: [],
            selectedFocusIds: [],
            createdAt: new Date().toISOString(),
            completedAt: null,
            archivePath: null,
          },
        ],
        failed: [],
        completed: [],
      },
    },
  };
  writeFileSync(
    path.join(platformStateDir, 'task-registry.json'),
    JSON.stringify(registry, null, 2) + '\n',
  );
}

/**
 * Seed the per-task .task.json sidecar. Creates the task dir and required subdirs.
 */
function writeTaskJson(
  repoRoot: string,
  taskId: string,
  originalRoot: string,
  worktreeRoot: string,
  worktreeBranch: string,
): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(path.join(taskDir, 'handoffs'), { recursive: true });
  mkdirSync(path.join(taskDir, 'ImplementationSteps'), { recursive: true });
  const sidecar = {
    schema_version: 1,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [
        {
          originalRoot,
          worktreeRoot,
          worktreeBranch,
          baseCommitSha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
        },
      ],
    },
    materialization: {
      strategy: 'copy',
      cloned: [],
      skipped: [],
    },
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
    state: 'active',
  };
  writeFileSync(
    path.join(taskDir, '.task.json'),
    JSON.stringify(sidecar, null, 2) + '\n',
  );
}

/**
 * Create a git worktree for the task branch in the original repo.
 */
function createWorktree(
  originalRoot: string,
  worktreePath: string,
  branch: string,
): void {
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  execFileSync(
    'git',
    ['-C', originalRoot, 'worktree', 'add', '-b', branch, worktreePath],
    { stdio: 'pipe' },
  );
}

/**
 * Seed the pendingitems/<taskId>.md file (moveFailedItemToErrorItems renames it).
 */
function writePendingItemMd(repoRoot: string, taskId: string): void {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(path.join(pendingDir, `${taskId}.md`), `# ${taskId}\n`);
}

/**
 * Seed the .active-items/<taskId> marker directory (§4.1 contract).
 * Per spec: marker is a DIRECTORY entry, not a file.
 */
function writeActiveItemMarker(repoRoot: string, taskId: string): void {
  // active-items lives under AgentWorkSpace/pendingitems/.active-items per queue/paths.ts
  const activeItemsDir = path.join(
    repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items',
  );
  mkdirSync(path.join(activeItemsDir, taskId), { recursive: true });
}

// ---------------------------------------------------------------------------
// §4.16 Data-safety — happy path
// ---------------------------------------------------------------------------

describe('§4.16 data-safety: retain_failed_task_worktrees=false', () => {
  let tmpRoot: string;
  let fixtureRepoX: string; // the "user's" external git repo (originalRoot)
  let repoRoot: string;     // TaskSail platform repo root

  const taskId = 'ds-task-noretain-01';
  const worktreeBranch = `task/${taskId}`;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ds-noretain-'));
    fixtureRepoX = createGitRepo(tmpRoot);
    // Use a separate dir as the TaskSail platform root
    repoRoot = mkdtempSync(path.join(tmpRoot, 'ts-root-'));
    writePlatformJson(repoRoot, /* retainFailed */ false);
    writeTaskRegistry(repoRoot, taskId);
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    // Prune stale worktree admin entries before rmSync
    try {
      execFileSync('git', ['-C', fixtureRepoX, 'worktree', 'prune'], { stdio: 'pipe' });
    } catch { /* best-effort */ }
    rmSync(tmpRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it(
    'sha256 byte-identical after failed pipeline: local-notes.txt unmodified + worktree removed',
    async () => {
      // 1. Write local-notes.txt in X's original working tree (untracked)
      const localNotesPath = path.join(fixtureRepoX, 'local-notes.txt');
      const knownBytes = 'operator-local-notes: do not touch\nversion=42\n';
      writeFileSync(localNotesPath, knownBytes, 'utf-8');
      const preTaskSha256 = sha256File(localNotesPath);

      // 2. Verify local-notes.txt is untracked before anything
      const statusBefore = execFileSync(
        'git', ['-C', fixtureRepoX, 'status', '--porcelain'], { encoding: 'utf-8' },
      );
      expect(statusBefore).toContain('?? local-notes.txt');

      // 3. Create the worktree for the task (simulates task activation)
      const worktreeRoot = path.join(
        repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'repos', 'X',
      );
      createWorktree(fixtureRepoX, worktreeRoot, worktreeBranch);

      // 4. Seed all required state
      writeTaskJson(repoRoot, taskId, fixtureRepoX, worktreeRoot, worktreeBranch);
      writePendingItemMd(repoRoot, taskId);
      writeActiveItemMarker(repoRoot, taskId);

      // 5. Call moveFailedItemToErrorItems (the §4.14A path — simulates pipeline failure)
      await moveFailedItemToErrorItems({ repoRoot, taskId });

      // 6. DATA SAFETY ASSERTIONS
      // (a) local-notes.txt must still exist in X's original working tree
      expect(existsSync(localNotesPath)).toBe(true);

      // (b) sha256 must be byte-identical
      const postTaskSha256 = sha256File(localNotesPath);
      expect(postTaskSha256).toBe(preTaskSha256);

      // (c) git status --porcelain must still show local-notes.txt as untracked
      const statusAfter = execFileSync(
        'git', ['-C', fixtureRepoX, 'status', '--porcelain'], { encoding: 'utf-8' },
      );
      expect(statusAfter).toContain('?? local-notes.txt');

      // (d) With retain=false the worktree dir must be gone
      expect(existsSync(worktreeRoot)).toBe(false);

      // (e) local-notes.txt must NOT appear in the (now-removed) worktree path
      expect(existsSync(path.join(worktreeRoot, 'local-notes.txt'))).toBe(false);
    },
    // git operations may be slow in CI
    30_000,
  );
});

// ---------------------------------------------------------------------------
// §4.16 Data-safety — negative control: retain=true
// ---------------------------------------------------------------------------

describe('§4.16 data-safety: retain_failed_task_worktrees=true (negative control)', () => {
  let tmpRoot: string;
  let fixtureRepoX: string;
  let repoRoot: string;

  const taskId = 'ds-task-retain-01';
  const worktreeBranch = `task/${taskId}`;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ds-retain-'));
    fixtureRepoX = createGitRepo(tmpRoot);
    repoRoot = mkdtempSync(path.join(tmpRoot, 'ts-root-'));
    writePlatformJson(repoRoot, /* retainFailed */ true);
    writeTaskRegistry(repoRoot, taskId);
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    try {
      execFileSync('git', ['-C', fixtureRepoX, 'worktree', 'prune'], { stdio: 'pipe' });
    } catch { /* best-effort */ }
    rmSync(tmpRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it(
    'with retain=true: worktree survives, but X\'s original local-notes.txt is STILL byte-identical',
    async () => {
      // 1. Write local-notes.txt in X's original working tree (untracked)
      const localNotesPath = path.join(fixtureRepoX, 'local-notes.txt');
      const knownBytes = 'operator-local-notes: retained path test\nversion=99\n';
      writeFileSync(localNotesPath, knownBytes, 'utf-8');
      const preTaskSha256 = sha256File(localNotesPath);

      // 2. Create the worktree for the task
      const worktreeRoot = path.join(
        repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'repos', 'X',
      );
      createWorktree(fixtureRepoX, worktreeRoot, worktreeBranch);

      // 3. Seed all required state
      writeTaskJson(repoRoot, taskId, fixtureRepoX, worktreeRoot, worktreeBranch);
      writePendingItemMd(repoRoot, taskId);
      writeActiveItemMarker(repoRoot, taskId);

      // 4. Call moveFailedItemToErrorItems
      await moveFailedItemToErrorItems({ repoRoot, taskId });

      // 5. With retain=true the worktree must still exist (retention-path validation)
      expect(existsSync(worktreeRoot)).toBe(true);

      // 6. DATA SAFETY ASSERTIONS — retention must NEVER bleed back to the original
      // (a) local-notes.txt must still exist in X's original working tree
      expect(existsSync(localNotesPath)).toBe(true);

      // (b) sha256 must be byte-identical even when the worktree is retained
      const postTaskSha256 = sha256File(localNotesPath);
      expect(postTaskSha256).toBe(preTaskSha256);

      // (c) git status --porcelain must still show local-notes.txt as untracked
      const statusAfter = execFileSync(
        'git', ['-C', fixtureRepoX, 'status', '--porcelain'], { encoding: 'utf-8' },
      );
      expect(statusAfter).toContain('?? local-notes.txt');
    },
    30_000,
  );
});
