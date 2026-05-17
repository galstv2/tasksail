import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function getReapedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  if (typeof pid !== 'number') {
    throw new Error('Failed to spawn child process for stale-pid test');
  }
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  // Brief delay so the OS reaps the zombie before we probe.
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  return pid;
}
import {
  acquireDirLock,
  acquireDirLockOrThrow,
  moveDropboxItemsOnce,
  moveDropboxItemToPending,
  queueNameForSource,
  activateNextPendingItemIfReady,
  completeActiveItem,
} from '../operations.js';
import { deleteDropboxItem } from '../deleteDropboxItem.js';
import { resetHandoffArtifacts } from '../lifecycle.js';
import {
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsTemplatePath,
  resolveQueuePaths,
} from '../paths.js';
import { extractContextPackBinding, formatContextPackBindingSection } from '../markdown.js';
import { listActivePipelines, stopPipeline } from '../../agent-runner/pipelineSupervisor.js';

async function stopPipelinesStartedByTest(): Promise<void> {
  await Promise.all(
    listActivePipelines().map(({ taskId }) => stopPipeline(taskId, 1000)),
  );
}

function seedDistributedContextPack(
  repoRoot: string,
  options: { repoId?: string; packName?: string } = {},
): { contextPackDir: string; repoDir: string; repoId: string } {
  const repoId = options.repoId ?? 'backend';
  const contextPackDir = path.join(repoRoot, 'contextpacks', options.packName ?? 'orders');
  const repoDir = path.join(repoRoot, 'external-repos', repoId);
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    path.join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      context_pack_id: options.packName ?? 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: `qmd/context-packs/${options.packName ?? 'orders'}`,
      repositories: [{
        repo_id: repoId,
        local_paths: [repoDir],
        repository_type: 'primary',
        default_focusable: true,
        activation_priority: 100,
      }],
      primary_working_repo_ids: [repoId],
      primary_focus_area_ids: [],
    }, null, 2) + '\n',
    'utf-8',
  );
  return { contextPackDir, repoDir, repoId };
}

function seedTemplates(templatesDir: string): void {
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
}

function initGitRepo(repoDir: string): string {
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  writeFileSync(path.join(repoDir, 'README.md'), `# ${path.basename(repoDir)}\n\n${repoDir}\n`, 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'initial'],
    { cwd: repoDir, stdio: 'ignore' },
  );
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();
}

function seedDistributedContextPackWithRepos(
  repoRoot: string,
  repos: Array<{ repoId: string; repoDir: string; repoGitRoot?: string }>,
  workspaceRepoDirs: string[],
  packName = 'multi-repo',
): string {
  const contextPackDir = path.join(repoRoot, 'contextpacks', packName);
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  writeFileSync(
    path.join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      context_pack_id: packName,
      estate_type: 'distributed-platform',
      qmd_scope_root: `qmd/context-packs/${packName}`,
      repositories: repos.map((repo, index) => ({
        repo_id: repo.repoId,
        local_paths: [{
          host: repo.repoDir,
          ...(repo.repoGitRoot ? { git_root: repo.repoGitRoot } : {}),
        }],
        repository_type: 'primary',
        default_focusable: index === 0,
        activation_priority: 100 - index,
      })),
      primary_working_repo_ids: [repos[0]?.repoId],
      primary_focus_area_ids: [],
    }, null, 2) + '\n',
    'utf-8',
  );
  writeFileSync(
    path.join(repoRoot, 'tasksail.code-workspace'),
    JSON.stringify({
      folders: [
        { path: '.' },
        ...workspaceRepoDirs.map((repoDir) => ({ path: repoDir })),
      ],
    }, null, 2) + '\n',
    'utf-8',
  );
  return contextPackDir;
}

function seedMonolithContextPack(
  repoRoot: string,
  options: {
    packName: string;
    repoLocalPath: string;
    repoGitRoot?: string;
    focusAreas: Array<{ focusId: string; focusRelativePath: string }>;
  },
): string {
  const contextPackDir = path.join(repoRoot, 'contextpacks', options.packName);
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  writeFileSync(
    path.join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      manifest_version: 'qmd-repo-sources/v2',
      manifest_status: 'approved',
      context_pack_id: options.packName,
      estate_type: 'monolith',
      qmd_scope_root: `qmd/context-packs/${options.packName}`,
      repositories: [{
        repo_id: 'src',
        local_paths: [{
          host: options.repoLocalPath,
          ...(options.repoGitRoot ? { git_root: options.repoGitRoot } : {}),
        }],
        repository_type: 'primary',
        default_focusable: true,
        activation_priority: 100,
      }],
      focusable_areas: options.focusAreas.map((area) => ({
        focus_id: area.focusId,
        focus_name: area.focusId,
        focus_type: area.focusId,
        relative_path: area.focusRelativePath,
        repository_type: 'primary',
      })),
      primary_working_repo_ids: [],
      primary_focus_area_ids: options.focusAreas.map((area) => area.focusId),
    }, null, 2) + '\n',
    'utf-8',
  );
  return contextPackDir;
}

describe('acquireDirLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('B6 writes an owner marker when acquiring a lock and removes it on release', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLock(lockDir, 3, 10);

    expect(release).not.toBeNull();
    expect(existsSync(lockDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid,
    });

    await release!();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('fails to acquire when lock is already held', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    mkdirSync(lockDir);

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).toBeNull();

    // Clean up
    rmSync(lockDir, { recursive: true });
  });

  it('re-exports the throwing lock helper from operations', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLockOrThrow(lockDir, 'test operation');

    expect(existsSync(lockDir)).toBe(true);

    await release();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('reclaims an orphaned lock when the recorded holder PID is dead', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const deadPid = await getReapedPid();
    mkdirSync(lockDir);
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: deadPid })}\n`, 'utf-8');

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).not.toBeNull();
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid,
    });

    await release!();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('does not reclaim a lock whose holder PID is still alive', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    mkdirSync(lockDir);
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`, 'utf-8');

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).toBeNull();

    rmSync(lockDir, { recursive: true });
  });

  it('release does not delete the lock when ownership has been reclaimed by another acquirer', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLock(lockDir, 3, 10);
    expect(release).not.toBeNull();

    // Simulate another acquirer reclaiming this lock as stale and writing
    // their own owner record. The original release must not delete the new
    // acquirer's lock.
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid + 1 })}\n`, 'utf-8');

    await release!();
    expect(existsSync(lockDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid + 1,
    });

    rmSync(lockDir, { recursive: true });
  });
});

describe('moveDropboxItemsOnce', () => {
  let tmpDir: string;
  let dropboxDir: string;
  let pendingDir: string;

  beforeEach(() => {
    // Nest under AgentWorkSpace so `path.resolve(pendingDir, '..', '..')`
    // (used inside moveDropboxItemsOnce to derive repoRoot) yields a real
    // tmpdir-scoped repoRoot rather than the OS tmpdir itself.
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-move-'));
    dropboxDir = path.join(tmpDir, 'AgentWorkSpace', 'dropbox');
    pendingDir = path.join(tmpDir, 'AgentWorkSpace', 'pendingitems');
    mkdirSync(dropboxDir, { recursive: true });
    mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('moves .md files from dropbox to pending', async () => {
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A');
    writeFileSync(path.join(dropboxDir, 'task-b.md'), '# Task B');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(2);

    const pendingFiles = readdirSync(pendingDir);
    expect(pendingFiles.length).toBe(2);
    expect(pendingFiles.every((f) => f.endsWith('.md'))).toBe(true);

    // Source files should be gone
    expect(readdirSync(dropboxDir).length).toBe(0);
  });

  it('moves the staged planner focus snapshot into the new taskId dir and rewrites bindingKey', async () => {
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A');
    const oldStagingPath = path.join(tmpDir, '.platform-state', 'runtime', 'tasks', 'task-a', 'planner-focus-snapshot.json');
    mkdirSync(path.dirname(oldStagingPath), { recursive: true });
    writeFileSync(oldStagingPath, JSON.stringify({
      schemaVersion: 1,
      bindingKey: 'task-a',
      stagedAt: '2026-05-01T00:00:00.000Z',
      markdownDestination: 'AgentWorkSpace/dropbox/task-a.md',
      snapshot: { version: 1, contextPackId: 'orders' },
    }));

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);
    expect(count).toBe(1);

    const pendingMarkdown = readdirSync(pendingDir).find((f) => f.endsWith('.md'));
    expect(pendingMarkdown).toBeDefined();
    const newTaskId = pendingMarkdown!.replace(/\.md$/u, '');

    const newStagingPath = path.join(tmpDir, '.platform-state', 'runtime', 'tasks', newTaskId, 'planner-focus-snapshot.json');
    expect(existsSync(newStagingPath)).toBe(true);
    expect(existsSync(oldStagingPath)).toBe(false);

    const movedEnvelope = JSON.parse(readFileSync(newStagingPath, 'utf-8'));
    expect(movedEnvelope.bindingKey).toBe(newTaskId);
    expect(movedEnvelope.markdownDestination).toContain(`pendingitems/${newTaskId}.md`);
    expect(movedEnvelope.snapshot).toEqual({ version: 1, contextPackId: 'orders' });
  });

  it('still moves markdown when the staged planner focus snapshot is missing', async () => {
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(1);
    expect(readdirSync(pendingDir).some((file) => file.endsWith('.md'))).toBe(true);
  });

  it('ignores non-markdown files', async () => {
    writeFileSync(path.join(dropboxDir, 'task.md'), '# Task');
    writeFileSync(path.join(dropboxDir, 'image.png'), 'binary');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(1);
    // The .png file should still be in dropbox
    expect(existsSync(path.join(dropboxDir, 'image.png'))).toBe(true);
  });

  it('preserves valid generated dropbox filenames during promotion', async () => {
    writeFileSync(path.join(dropboxDir, '20260517t090246z_task-a.md'), '# Task A');
    writeFileSync(path.join(dropboxDir, '2026-05-17_task-b-090246.md'), '# Task B');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(2);
    expect(existsSync(path.join(pendingDir, '20260517t090246z_task-a.md'))).toBe(true);
    expect(existsSync(path.join(pendingDir, '2026-05-17_task-b-090246.md'))).toBe(true);
  });

  it('returns 0 when dropbox is empty', async () => {
    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);
    expect(count).toBe(0);
  });
});

describe('queueNameForSource', () => {
  it('generates a timestamped name with the original filename', () => {
    const name = queueNameForSource('/some/path/my-task.md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_my-task-\d{6}\.md$/);
  });

  it('preserves the basename of the source file', () => {
    const name = queueNameForSource('/deep/nested/path/special-file.md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_special-file-\d{6}\.md$/);
  });

  it('strips a legacy hyphenated canonical prefix before re-queueing', () => {
    const name = queueNameForSource('/some/path/20260307T183000Z-my-task.md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_my-task-\d{6}\.md$/);
  });

  it('strips an underscore canonical prefix before re-queueing', () => {
    const name = queueNameForSource('/some/path/20260307T183000Z_my-task.md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_my-task-\d{6}\.md$/);
  });

  it('normalizes unsafe ingress names into valid task-id shape', () => {
    const name = queueNameForSource('/some/path/CAP.Parent Task!.md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_cap-parent-task-\d{6}\.md$/);
  });
});

describe('moveDropboxItemToPending planner focus snapshots', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-single-move-'));
    const paths = resolveQueuePaths(repoRoot);
    mkdirSync(paths.dropboxDir, { recursive: true });
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'already-active'), 'already-active.md', 'utf-8');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('moves the staged snapshot to the timestamped pending taskId dir', async () => {
    const paths = resolveQueuePaths(repoRoot);
    writeFileSync(path.join(paths.dropboxDir, 'task-a.md'), '# Task A');
    const oldStagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-a', 'planner-focus-snapshot.json');
    mkdirSync(path.dirname(oldStagingPath), { recursive: true });
    writeFileSync(oldStagingPath, JSON.stringify({
      schemaVersion: 1,
      bindingKey: 'task-a',
      stagedAt: '2026-05-01T00:00:00.000Z',
      markdownDestination: 'AgentWorkSpace/dropbox/task-a.md',
      snapshot: { version: 1 },
    }));

    const result = await moveDropboxItemToPending({ repoRoot, fileName: 'task-a.md', insertAtIndex: 0 });
    expect(existsSync(path.join(paths.pendingDir, result.movedItem))).toBe(true);

    const newTaskId = result.movedItem.replace(/\.md$/u, '');
    const newStagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', newTaskId, 'planner-focus-snapshot.json');
    expect(existsSync(newStagingPath)).toBe(true);
    expect(existsSync(oldStagingPath)).toBe(false);

    const movedEnvelope = JSON.parse(readFileSync(newStagingPath, 'utf-8'));
    expect(movedEnvelope.bindingKey).toBe(newTaskId);
  });

  it('still moves markdown when the staged snapshot is missing', async () => {
    const paths = resolveQueuePaths(repoRoot);
    writeFileSync(path.join(paths.dropboxDir, 'task-a.md'), '# Task A');

    const result = await moveDropboxItemToPending({ repoRoot, fileName: 'task-a.md', insertAtIndex: 0 });

    expect(existsSync(path.join(paths.pendingDir, result.movedItem))).toBe(true);
    const newTaskId = result.movedItem.replace(/\.md$/u, '');
    expect(existsSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', newTaskId, 'planner-focus-snapshot.json'))).toBe(false);
  });

  it('returns the newly activated task id instead of an existing active marker', async () => {
    const previousAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    try {
      const paths = resolveQueuePaths(repoRoot);
      mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
      writeFileSync(
        path.join(repoRoot, '.platform-state', 'platform.json'),
        JSON.stringify({
          schema_version: 1,
          container_runtime: 'docker',
          max_parallel_tasks: 2,
        }, null, 2) + '\n',
        'utf-8',
      );
      mkdirSync(paths.templatesDir, { recursive: true });
      seedTemplates(paths.templatesDir);
      writeFileSync(path.join(paths.dropboxDir, 'task-a.md'), '# Task A');

      const result = await moveDropboxItemToPending({ repoRoot, fileName: 'task-a.md', insertAtIndex: 0 });
      const newTaskId = result.movedItem.replace(/\.md$/u, '');

      expect(result.activatedItem).toBe(newTaskId);
      expect(result.activatedItem).not.toBe('already-active');
    } finally {
      if (previousAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = previousAutostart;
      }
    }
  });
});

describe('activateNextPendingItemIfReady', () => {
  let repoRoot: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    // Use canonical AgentWorkSpace structure so resolveQueuePaths works correctly.
    // Per-task handoffs live under AgentWorkSpace/tasks/<taskId>/handoffs/ (created by activation).
    const TEST_TASK_ID = 'task-test-001';
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-activate-lock-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('activates a pending item when no failure lock is present (lock system removed)', async () => {
    writeFileSync(path.join(pendingDir, 'task-003.md'), '# Task');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, 'slice-template.md'), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-items', 'task-003'))).toBe(true);
  });

  it('transfers the staged planner focus snapshot envelope into the active task directory unwrapped', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    try {
      writeFileSync(path.join(pendingDir, 'task-003.md'), '# Task');
      const stagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-003', 'planner-focus-snapshot.json');
      mkdirSync(path.dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, JSON.stringify({
        schemaVersion: 1,
        bindingKey: 'task-003',
        stagedAt: '2026-05-01T00:00:00.000Z',
        markdownDestination: 'AgentWorkSpace/pendingitems/task-003.md',
        snapshot: { version: 1, contextPackId: 'orders' },
      }));
      seedTemplates(templatesDir);

      const result = await activateNextPendingItemIfReady({
        paths: resolveQueuePaths(repoRoot),
        repoRoot,
      });

      expect(result.activated).toBe(true);
      const activeSnapshotPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-003', '.planner-focus-snapshot.json');
      expect(existsSync(activeSnapshotPath)).toBe(true);
      // Active-dir copy must be unwrapped (no envelope) — python closeout reads
      // the bare PlannerFocusSnapshot shape.
      expect(JSON.parse(readFileSync(activeSnapshotPath, 'utf-8'))).toEqual({ version: 1, contextPackId: 'orders' });
      // Staging file is unlinked after successful transfer.
      expect(existsSync(stagingPath)).toBe(false);
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('activates successfully when the staged snapshot is missing', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    try {
      writeFileSync(path.join(pendingDir, 'task-003.md'), '# Task');
      seedTemplates(templatesDir);

      const result = await activateNextPendingItemIfReady({
        paths: resolveQueuePaths(repoRoot),
        repoRoot,
      });

      expect(result.activated).toBe(true);
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('refuses activation while the bound context pack has an active reseed marker', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    try {
      const { contextPackDir } = seedDistributedContextPack(repoRoot);
      const binding = formatContextPackBindingSection({
        contextPackDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        selectedRepoIds: ['backend'],
        selectedFocusIds: [],
        deepFocusEnabled: false,
        selectedFocusPath: '',
      });
      writeFileSync(path.join(pendingDir, 'task-reseed.md'), `# Reseed blocked\n\n${binding}\n`);
      writeFileSync(path.join(contextPackDir, '.reseed-in-progress.json'), JSON.stringify({
        started_at: new Date().toISOString(),
        pid: process.pid,
        host: 'test-host',
      }), 'utf-8');
      seedTemplates(templatesDir);

      await expect(activateNextPendingItemIfReady({
        paths: resolveQueuePaths(repoRoot),
        repoRoot,
      })).rejects.toThrow('reseed is in progress');
      expect(existsSync(path.join(pendingDir, 'task-reseed.md'))).toBe(true);
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('does not run merge detection sweep during activation', async () => {
    const sourceRepo = path.join(repoRoot, 'source-repo');
    const baseCommitSha = initGitRepo(sourceRepo);
    const baseBranch = execFileSync('git', ['branch', '--show-current'], { cwd: sourceRepo, encoding: 'utf-8' }).trim();
    const taskId = 'completed-handoff';
    const branch = `task/${taskId}`;
    execFileSync('git', ['checkout', '-b', branch], { cwd: sourceRepo, stdio: 'ignore' });
    writeFileSync(path.join(sourceRepo, 'change.txt'), 'change\n');
    execFileSync('git', ['add', 'change.txt'], { cwd: sourceRepo, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'task change'],
      { cwd: sourceRepo, stdio: 'ignore' },
    );
    execFileSync('git', ['checkout', baseBranch], { cwd: sourceRepo, stdio: 'ignore' });
    execFileSync('git', ['merge', '--ff-only', branch], { cwd: sourceRepo, stdio: 'ignore' });

    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
      schema_version: 1,
      taskId,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: [{
          originalRoot: sourceRepo,
          worktreeRoot: path.join(taskDir, 'worktrees', 'source-repo'),
          worktreeBranch: branch,
          baseCommitSha,
        }],
      },
      materialization: { strategy: 'copy', cloned: [], skipped: [] },
      frozenAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      state: 'completed',
    }, null, 2) + '\n');

    const result = await activateNextPendingItemIfReady({
      paths: resolveQueuePaths(repoRoot),
      repoRoot,
    });

    expect(result.activated).toBe(false);
    expect(existsSync(path.join(taskDir, '.task.json'))).toBe(true);
    const branches = execFileSync('git', ['branch', '--list', branch], { cwd: sourceRepo, encoding: 'utf-8' });
    expect(branches).toContain(branch);
  });

  it('seeds handoffs and ImplementationSteps templates when activating a pending item', async () => {
    writeFileSync(path.join(pendingDir, 'task-004.md'), '# Add search\n');
    for (const filename of HANDOFF_FILES) {
      const template = filename === 'retrospective-input.md'
        ? '# retrospective-input.md\n\n## Task Metadata\n\n- Task ID:\n- Retrospective Required:\n'
        : `# ${filename}\n\n- Task ID:\n`;
      writeFileSync(path.join(templatesDir, filename), template);
    }
    writeFileSync(
      path.join(templatesDir, SLICE_TEMPLATE_FILENAME),
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-items', 'task-004'))).toBe(true);
    // §4.2: activation writes per-task handoffs to AgentWorkSpace/tasks/<taskId>/handoffs/
    const taskHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-004', 'handoffs');
    expect(existsSync(path.join(taskHandoffsDir, 'professional-task.md'))).toBe(true);
    const copiedSliceTemplatePath = implementationStepsTemplatePath(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-004', 'ImplementationSteps'),
    );
    expect(existsSync(copiedSliceTemplatePath)).toBe(true);
    expect(readFileSync(copiedSliceTemplatePath, 'utf-8')).toBe(
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );
    const retrospective = readdirSync(taskHandoffsDir).includes('retrospective-input.md')
      ? readFileSync(path.join(taskHandoffsDir, 'retrospective-input.md'), 'utf-8')
      : '';
    expect(retrospective).toContain('- Retrospective Required: false');
    // Activation must stage the pending markdown into the per-task handoffs dir
    // as `intake.md` so artifact-author agents (Alice) can read intake from
    // their own task workspace without being granted access to the shared
    // pendingitems/ directory, which holds other tasks' files in parallel mode.
    const stagedIntakePath = path.join(taskHandoffsDir, 'intake.md');
    expect(existsSync(stagedIntakePath)).toBe(true);
    expect(readFileSync(stagedIntakePath, 'utf-8')).toBe('# Add search\n');
  });

  it('stamps Core Metadata and Task Lineage labels into handoff templates', async () => {
    // Seed the pending item with explicit lineage values so we can confirm
    // the activation flow extracts them and forwards to stampHandoffTemplate.
    const pendingMarkdown = [
      '# Follow-up: tighten validation',
      '',
      '## Task Lineage',
      '',
      '- Task Kind: follow-up',
      '- Parent Task ID: task-parent-007',
      '- Root Task ID: task-root-001',
      '- Parent QMD Record ID: qmd-2026-05-01-007',
      '- Parent QMD Scope: orders',
      '- Follow-Up Reason: ron-found-edge-case',
      '',
    ].join('\n');
    writeFileSync(path.join(pendingDir, 'task-lineage-009.md'), pendingMarkdown);

    const labeledTemplate = [
      '# implementation-spec.md',
      '',
      '### Core Metadata',
      '',
      '- Task ID:',
      '- Task Title:',
      '- Initialized At (UTC):',
      '- Active Branch:',
      '- Intake Source:',
      '',
      '### Task Lineage',
      '',
      '- Task Kind:',
      '- Parent Task ID:',
      '- Root Task ID:',
      '- Parent QMD Record ID:',
      '- Parent QMD Scope:',
      '- Follow-Up Reason:',
      '',
    ].join('\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), labeledTemplate);
    }
    writeFileSync(
      path.join(templatesDir, SLICE_TEMPLATE_FILENAME),
      '# Slice Template\n',
    );

    const result = await activateNextPendingItemIfReady({
      paths: resolveQueuePaths(repoRoot),
      repoRoot,
    });
    expect(result.activated).toBe(true);

    const stamped = readFileSync(
      path.join(
        repoRoot,
        'AgentWorkSpace',
        'tasks',
        'task-lineage-009',
        'handoffs',
        'implementation-spec.md',
      ),
      'utf-8',
    );

    // Core Metadata
    expect(stamped).toContain('- Task ID: task-lineage-009');
    expect(stamped).toContain('- Task Title: Follow-up: tighten validation');
    expect(stamped).toMatch(/- Initialized At \(UTC\): \d{4}-\d{2}-\d{2}T/);
    expect(stamped).toContain('- Active Branch: unknown');
    expect(stamped).toContain('- Intake Source: AgentWorkSpace/pendingitems/task-lineage-009.md');

    // Task Lineage — extracted from the pending markdown
    expect(stamped).toContain('- Task Kind: follow-up');
    expect(stamped).toContain('- Parent Task ID: task-parent-007');
    expect(stamped).toContain('- Root Task ID: task-root-001');
    expect(stamped).toContain('- Parent QMD Record ID: qmd-2026-05-01-007');
    expect(stamped).toContain('- Parent QMD Scope: orders');
    expect(stamped).toContain('- Follow-Up Reason: ron-found-edge-case');
  });

  it('stamps the retrospective label during activation without mutating the counter', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    try {
      const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
      mkdirSync(counterDir, { recursive: true });
      const counterPath = path.join(counterDir, 'platform-core.json');
      const originalCounter = {
        schema_version: 'task-counter/v1',
        context_pack_id: 'platform-core',
        completed_count: 9,
        cycle_count: 4,
        last_archived_task_id: 'task-previous',
        last_archived_at: '2026-01-01T00:00:00.000Z',
        last_retrospective_at: '2026-01-01T00:00:00.000Z',
        cycle_task_ids: ['task-previous'],
      };
      writeFileSync(counterPath, JSON.stringify(originalCounter, null, 2) + '\n', 'utf-8');
      writeFileSync(path.join(pendingDir, 'task-activation-stamp.md'), '# Activation stamp\n');
      for (const filename of HANDOFF_FILES) {
        const template = filename === 'retrospective-input.md'
          ? '# retrospective-input.md\n\n## Task Metadata\n\n- Task ID:\n- Retrospective Required: false\n'
          : `# ${filename}\n\n- Task ID:\n`;
        writeFileSync(path.join(templatesDir, filename), template);
      }
      writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

      const result = await activateNextPendingItemIfReady({
        paths: resolveQueuePaths(repoRoot),
        repoRoot,
      });

      expect(result.activated).toBe(true);
      const taskHandoffsDir = path.join(
        repoRoot,
        'AgentWorkSpace',
        'tasks',
        'task-activation-stamp',
        'handoffs',
      );
      const retrospective = readFileSync(path.join(taskHandoffsDir, 'retrospective-input.md'), 'utf-8');
      const rawCounter = readFileSync(counterPath, 'utf-8');

      expect(retrospective).toContain('- Retrospective Required: true');
      expect(JSON.parse(rawCounter)).toEqual(originalCounter);
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('clears prior runtime receipts only after the next task activates successfully', async () => {
    const taskRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-005');
    const roleSessionsDir = path.join(taskRuntimeDir, 'role-sessions');
    const guardrailsDir = path.join(taskRuntimeDir, 'guardrails');
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(guardrailsDir, { recursive: true });

    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');
    writeFileSync(path.join(guardrailsDir, 'dalton.json'), '{"status":"failed"}\n');

    writeFileSync(path.join(pendingDir, 'task-005.md'), '# Add audit trail\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(readdirSync(roleSessionsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(readdirSync(guardrailsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(existsSync(path.join(taskRuntimeDir, 'last-reset-ts'))).toBe(true);
  });

  it('persists repo-root Deep Focus fields to the task sidecar without writing queue singleton state', async () => {
    const { contextPackDir } = seedDistributedContextPack(repoRoot);

    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
    });
    writeFileSync(path.join(pendingDir, 'task-006.md'), `# Repo root task

${binding}

## Request Summary

    Body
`);
    expect(extractContextPackBinding(readFileSync(path.join(pendingDir, 'task-006.md'), 'utf-8'))).toEqual({
      kind: 'binding',
      binding: expect.objectContaining({ contextPackDir }),
    });
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    const sidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-006', '.task.json');
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    expect(sidecar.contextPackBinding.selection).toEqual(expect.objectContaining({
      contextPackDir,
      contextPackId: 'orders',
      deepFocusEnabled: true,
      selectedFocusPath: '',
    }));
    expect(sidecar.contextPackBinding.selection).toHaveProperty('selectedFocusTargetKind', null);
    expect(existsSync(path.join(repoRoot, '.platform-state', 'queue'))).toBe(false);
  });

  it('preserves scoped selectedFocusTargets in task sidecars across parallel activation', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'platform.json'),
      JSON.stringify({
        schema_version: 1,
        cli_provider: 'copilot',
        container_runtime: 'podman',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 2,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      }, null, 2) + '\n',
      'utf-8',
    );
    const { contextPackDir } = seedDistributedContextPack(repoRoot);
    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
    });
    try {
      writeFileSync(path.join(pendingDir, 'task-scoped-a.md'), `# Scoped A\n\n${binding}\n`);
      writeFileSync(path.join(pendingDir, 'task-scoped-b.md'), `# Scoped B\n\n${binding}\n`);
      for (const filename of HANDOFF_FILES) {
        writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
      }
      writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

      const queuePaths = resolveQueuePaths(repoRoot);
      expect((await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot })).activated).toBe(true);
      expect((await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot })).activated).toBe(true);

      for (const taskId of ['task-scoped-a', 'task-scoped-b']) {
        const sidecar = JSON.parse(
          readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'), 'utf-8'),
        );
        expect(sidecar.contextPackBinding.selection.selectedFocusTargets).toEqual([{
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
          supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
        }]);
      }
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('materializes selected focus target repos beyond visible workspace roots with deterministic collision-safe slugs', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    const repoA = path.join(repoRoot, 'external-repos', 'a', 'service');
    const repoB = path.join(repoRoot, 'external-repos', 'b', 'service');
    const shaA = initGitRepo(repoA);
    const shaB = initGitRepo(repoB);
    const contextPackDir = seedDistributedContextPackWithRepos(
      repoRoot,
      [
        { repoId: 'platform', repoDir: repoA },
        { repoId: 'tools', repoDir: repoB },
      ],
      [repoA],
    );
    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'multi-repo',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api', 'seed'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { repoLocalPath: repoA, repoId: 'platform', path: 'src', kind: 'directory', role: 'anchor' },
        { repoLocalPath: repoB, repoId: 'tools', path: 'src', kind: 'directory', role: 'primary' },
      ],
    });
    try {
      writeFileSync(path.join(pendingDir, 'task-multi-repo.md'), `# Multi repo\n\n${binding}\n`);
      seedTemplates(templatesDir);

      const queuePaths = resolveQueuePaths(repoRoot);
      const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });

      expect(result.activated).toBe(true);
      const sidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-multi-repo', '.task.json');
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
      const repoBindings = sidecar.contextPackBinding.repoBindings;
      expect(repoBindings.map((binding: { originalRoot: string }) => binding.originalRoot)).toEqual([
        realpathSync(repoA),
        realpathSync(repoB),
      ]);
      expect(repoBindings.map((binding: { worktreeRoot: string }) => path.basename(binding.worktreeRoot))).toEqual([
        `service-${shaA.slice(0, 8)}`,
        `service-${shaB.slice(0, 8)}`,
      ]);
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-multi-repo', 'worktrees', `service-${shaA.slice(0, 8)}`))).toBe(true);
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-multi-repo', 'worktrees', `service-${shaB.slice(0, 8)}`))).toBe(true);
    } finally {
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('creates branches against each persisted git root when a distributed context pack points at subtrees', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    const apiRoot = path.join(repoRoot, 'external-repos', 'api');
    const webRoot = path.join(repoRoot, 'external-repos', 'web');
    const apiSrc = path.join(apiRoot, 'src');
    const webSrc = path.join(webRoot, 'src');
    initGitRepo(apiRoot);
    initGitRepo(webRoot);
    mkdirSync(apiSrc, { recursive: true });
    mkdirSync(webSrc, { recursive: true });
    writeFileSync(path.join(apiSrc, 'index.ts'), 'export const api = true;\n', 'utf-8');
    writeFileSync(path.join(webSrc, 'index.ts'), 'export const web = true;\n', 'utf-8');
    execFileSync('git', ['add', 'src/index.ts'], { cwd: apiRoot, stdio: 'ignore' });
    execFileSync('git', ['add', 'src/index.ts'], { cwd: webRoot, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'add api src'],
      { cwd: apiRoot, stdio: 'ignore' },
    );
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'add web src'],
      { cwd: webRoot, stdio: 'ignore' },
    );
    const apiSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: apiRoot, encoding: 'utf-8' }).trim();
    const webSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf-8' }).trim();
    const contextPackDir = seedDistributedContextPackWithRepos(
      repoRoot,
      [
        { repoId: 'api', repoDir: apiSrc, repoGitRoot: apiRoot },
        { repoId: 'web', repoDir: webSrc, repoGitRoot: webRoot },
      ],
      [apiSrc],
      'distributed-subtrees',
    );
    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'distributed-subtrees',
      scopeMode: 'focused',
      selectedRepoIds: ['api', 'web'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { repoLocalPath: apiSrc, repoId: 'api', path: 'src', kind: 'directory', role: 'anchor' },
        { repoLocalPath: webSrc, repoId: 'web', path: 'src', kind: 'directory', role: 'primary' },
      ],
    });
    try {
      writeFileSync(path.join(pendingDir, 'task-distributed-subtrees.md'), `# Distributed subtrees\n\n${binding}\n`);
      seedTemplates(templatesDir);

      const result = await activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot });

      expect(result.activated).toBe(true);
      const sidecar = JSON.parse(
        readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-distributed-subtrees', '.task.json'), 'utf-8'),
      );
      const repoBindings = sidecar.contextPackBinding.repoBindings;
      expect(repoBindings.map((binding: { originalRoot: string }) => binding.originalRoot)).toEqual([
        realpathSync(apiRoot),
        realpathSync(webRoot),
      ]);
      expect(repoBindings.map((binding: { worktreeRoot: string }) => path.basename(binding.worktreeRoot))).toEqual([
        `src-${apiSha.slice(0, 8)}`,
        `src-${webSha.slice(0, 8)}`,
      ]);
      expect(existsSync(path.join(repoBindings[0].worktreeRoot, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(path.join(repoBindings[1].worktreeRoot, 'src', 'index.ts'))).toBe(true);
    } finally {
      for (const [root, sha] of [[apiRoot, apiSha], [webRoot, webSha]] as const) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-distributed-subtrees', 'worktrees', `src-${sha.slice(0, 8)}`)], {
            cwd: root,
            stdio: 'ignore',
          });
        } catch {
          // Test cleanup only.
        }
        try {
          execFileSync('git', ['branch', '-D', 'task/task-distributed-subtrees'], { cwd: root, stdio: 'ignore' });
        } catch {
          // Test cleanup only.
        }
      }
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('creates branches against the parent git root when a monolith context pack points at a subtree', async () => {
    const savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    const monolithRoot = path.join(repoRoot, 'external-repos', 'monolith');
    const srcRoot = path.join(monolithRoot, 'src');
    const backendRoot = path.join(srcRoot, 'backend');
    initGitRepo(monolithRoot);
    mkdirSync(backendRoot, { recursive: true });
    writeFileSync(path.join(backendRoot, 'index.ts'), 'export const backend = true;\n', 'utf-8');
    execFileSync('git', ['add', 'src/backend/index.ts'], { cwd: monolithRoot, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'add backend'],
      { cwd: monolithRoot, stdio: 'ignore' },
    );
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: monolithRoot, encoding: 'utf-8' }).trim();
    const contextPackDir = seedMonolithContextPack(repoRoot, {
      packName: 'src-pack',
      repoLocalPath: srcRoot,
      repoGitRoot: monolithRoot,
      focusAreas: [
        { focusId: 'backend', focusRelativePath: 'backend' },
        { focusId: 'frontend', focusRelativePath: 'frontend' },
      ],
    });
    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'src-pack',
      scopeMode: 'focused',
      selectedRepoIds: [],
      selectedFocusIds: ['backend', 'frontend'],
    });
    try {
      writeFileSync(path.join(pendingDir, 'task-subtree.md'), `# Subtree\n\n${binding}\n`);
      seedTemplates(templatesDir);

      const result = await activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot });

      expect(result.activated).toBe(true);
      const sidecar = JSON.parse(
        readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-subtree', '.task.json'), 'utf-8'),
      );
      const [repoBinding] = sidecar.contextPackBinding.repoBindings;
      expect(repoBinding.originalRoot).toBe(realpathSync(monolithRoot));
      expect(repoBinding.baseCommitSha).toBe(baseSha);
      expect(path.basename(repoBinding.worktreeRoot)).toBe('src');
      expect(existsSync(path.join(repoBinding.worktreeRoot, 'src', 'backend', 'index.ts'))).toBe(true);
      expect(
        execFileSync('git', ['rev-parse', '--verify', 'refs/heads/task/task-subtree'], {
          cwd: monolithRoot,
          encoding: 'utf-8',
        }).trim(),
      ).toBe(baseSha);

      const snapshot = JSON.parse(
        readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-subtree', 'pack-snapshot.json'), 'utf-8'),
      );
      expect(snapshot.primary.repoRoot).toBe(realpathSync(srcRoot));
      expect(snapshot.primary.primaryFocusRelativePath).toBe('backend');
      expect(snapshot.selectedFocusIds).toEqual(['backend', 'frontend']);
      expect(snapshot.deepFocus.primaryFocusTargets).toEqual([
        {
          path: 'backend',
          kind: 'directory',
          repoLocalPath: realpathSync(srcRoot),
          focusId: 'backend',
          role: 'anchor',
        },
        {
          path: 'frontend',
          kind: 'directory',
          repoLocalPath: realpathSync(srcRoot),
          focusId: 'frontend',
          role: 'primary',
        },
      ]);
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-subtree', 'worktrees', 'src')], {
          cwd: monolithRoot,
          stdio: 'ignore',
        });
      } catch {
        // Test cleanup only.
      }
      try {
        execFileSync('git', ['branch', '-D', 'task/task-subtree'], { cwd: monolithRoot, stdio: 'ignore' });
      } catch {
        // Test cleanup only.
      }
      if (savedAutostart === undefined) {
        delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
      } else {
        process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
      }
    }
  });

  it('fails activation before sidecar or marker when a selected focus target repo is missing', async () => {
    const repoA = path.join(repoRoot, 'external-repos', 'platform');
    initGitRepo(repoA);
    const missingRepo = path.join(repoRoot, 'external-repos', 'tools-missing');
    const contextPackDir = seedDistributedContextPackWithRepos(
      repoRoot,
      [{ repoId: 'platform', repoDir: repoA }],
      [repoA],
      'missing-selected',
    );
    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'missing-selected',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api', 'seed'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { repoLocalPath: repoA, repoId: 'platform', path: 'src', kind: 'directory', role: 'anchor' },
        { repoLocalPath: missingRepo, repoId: 'tools', path: 'src', kind: 'directory', role: 'primary' },
      ],
    });
    writeFileSync(path.join(pendingDir, 'task-missing-selected.md'), `# Missing selected\n\n${binding}\n`);
    seedTemplates(templatesDir);

    const queuePaths = resolveQueuePaths(repoRoot);
    await expect(activateNextPendingItemIfReady({ paths: queuePaths, repoRoot })).rejects.toThrow(
      `activation-selected-repo-missing: selectedFocusTargets[1].repoLocalPath "${missingRepo}" does not exist for task "task-missing-selected"`,
    );

    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-missing-selected'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-missing-selected', '.task.json'))).toBe(false);
    expect(existsSync(path.join(pendingDir, 'task-missing-selected.md'))).toBe(true);
    expect(readdirSync(pendingDir)).toContain('task-missing-selected.md');
  });

  it('refuses to activate an unbound task as a platform worktree while a context pack is active', async () => {
    const activePackDir = path.join(repoRoot, 'contextpacks', 'orders');
    mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
      JSON.stringify({
        version: 1,
        active_context_pack_dir: activePackDir,
        active_context_pack_id: 'orders',
        selected_repo_ids: ['backend'],
        selected_focus_ids: [],
        managed_folders: [path.join(repoRoot, 'external-repos', 'backend')],
        status: 'success',
      }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(pendingDir, 'task-unbound.md'), '# Unbound task\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    await expect(activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    })).rejects.toThrow(/Refusing to activate unbound task "task-unbound"/);
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-unbound'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-unbound', '.task.json'))).toBe(false);
  });
});

describe('activateNextPendingItemIfReady shared MCP bootstrap', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-shared-mcp-'));
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    vi.doUnmock('../../container/sharedMcp.js');
    vi.resetModules();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('rolls back activation and returns shared-mcp-bootstrap-failed when shared MCP ensure fails', async () => {
    const ensureSharedMcpRunning = vi.fn().mockRejectedValue(new Error('shared bootstrap failed'));
    vi.resetModules();
    vi.doMock('../../container/sharedMcp.js', () => ({ ensureSharedMcpRunning }));
    vi.doMock('../../container/runtime.js', () => ({
      createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: true }),
    }));
    const { activateNextPendingItemIfReady: activateWithMock } = await import('../operations.js');

    const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    const templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(path.join(repoRoot, 'runtime', 'docker', 'compose'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'runtime', 'docker', 'compose', 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(
      path.join(repoRoot, 'config', 'platform.default.json'),
      JSON.stringify({
        schema_version: 1,
        cli_provider: 'copilot',
        container_runtime: 'podman',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 10,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(pendingDir, 'task-shared-mcp.md'), '# Shared MCP\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateWithMock({ paths: queuePaths, repoRoot });

    expect(result).toEqual({ activated: false, reason: 'shared-mcp-bootstrap-failed' });
    expect(ensureSharedMcpRunning).toHaveBeenCalledTimes(1);
    expect(ensureSharedMcpRunning).toHaveBeenCalledWith(repoRoot);
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-shared-mcp'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-shared-mcp'))).toBe(false);
    expect(existsSync(path.join(pendingDir, 'task-shared-mcp.md'))).toBe(true);
  });
});

describe('queue planner focus snapshot cleanup', () => {
  let repoRoot: string;
  let paths: ReturnType<typeof resolveQueuePaths>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-snapshot-cleanup-'));
    paths = resolveQueuePaths(repoRoot);
    mkdirSync(paths.dropboxDir, { recursive: true });
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-done', 'handoffs'), { recursive: true });
    mkdirSync(paths.templatesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('deleteDropboxItem removes the staged planner-focus-snapshot for the deleted task', async () => {
    writeFileSync(path.join(paths.dropboxDir, 'task-drop.md'), '# Drop');
    const stagingPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-drop', 'planner-focus-snapshot.json');
    mkdirSync(path.dirname(stagingPath), { recursive: true });
    writeFileSync(stagingPath, '{}\n');

    await deleteDropboxItem({ repoRoot, queueName: 'task-drop.md' });

    expect(existsSync(path.join(paths.dropboxDir, 'task-drop.md'))).toBe(false);
    expect(existsSync(stagingPath)).toBe(false);
  });

  it('completeActiveItem succeeds without a residual sibling snapshot', async () => {
    writeFileSync(path.join(paths.pendingDir, 'task-done.md'), '# Done');
    writeFileSync(path.join(paths.activeItemsDir, 'task-done'), 'task-done.md');

    const result = await completeActiveItem({
      pendingDir: paths.pendingDir,
      taskId: 'task-done',
      handoffsDir: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-done', 'handoffs'),
      templatesDir: paths.templatesDir,
    });

    expect(result.status).toBe('completed');
    expect(existsSync(path.join(paths.pendingDir, 'task-done.md'))).toBe(false);
  });
});

describe('resetHandoffArtifacts runtime receipt retention', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-reset-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('preserves runtime receipts until a new task activates', async () => {
    const TEST_TASK_ID = 'task-test-001';
    const handoffsDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    const runtimeDir = path.join(tmpDir, '.platform-state', 'runtime');
    const roleSessionsDir = path.join(runtimeDir, 'role-sessions');
    const implStepsDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });

    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# task\n');
    writeFileSync(path.join(handoffsDir, 'intake.md'), '# original intake\n');
    writeFileSync(path.join(implStepsDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, {
      implementationStepsDir: implStepsDir,
    });

    expect(existsSync(path.join(roleSessionsDir, 'dalton.json'))).toBe(true);
    // intake.md is the staged copy of the pending markdown (written at activation)
    // and must be cleared on reset so the next activation gets a clean slate.
    expect(existsSync(path.join(handoffsDir, 'intake.md'))).toBe(false);
  });
});
