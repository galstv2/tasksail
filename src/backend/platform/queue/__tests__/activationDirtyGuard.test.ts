import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveQueuePaths, HANDOFF_FILES, SLICE_TEMPLATE_FILENAME } from '../paths.js';
import { registerTask, loadTaskRegistry } from '../taskRegistry.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';
import { findDirtyTargetRepos } from '../activationDirtyGuard.js';

const startPipeline = vi.fn();
const moveFailedItemToErrorItems = vi.fn();

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline,
}));

vi.mock('../errorItems.js', () => ({
  moveFailedItemToErrorItems,
}));

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8' }).trim();
}

function initGitRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  writeFileSync(path.join(repoDir, 'README.md'), '# repo\n', 'utf-8');
  git(repoDir, ['add', 'README.md']);
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'initial'],
    { cwd: repoDir, stdio: 'ignore' },
  );
}

function seedTemplates(templatesDir: string): void {
  mkdirSync(templatesDir, { recursive: true });
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`, 'utf-8');
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n', 'utf-8');
}

function pendingContent(taskId: string, title: string): string {
  return `# ${title}

## Metadata

- Task ID: ${taskId}
`;
}

describe('activation dirty guard', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'activation-dirty-'));
    initGitRepo(repoRoot);
    startPipeline.mockReset();
    moveFailedItemToErrorItems.mockReset();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('blocks dirty activation before creating a worktree, branch, or active marker', async () => {
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    const taskId = 'dirty-task';
    const pendingPath = path.join(paths.pendingDir, `${taskId}.md`);
    writeFileSync(pendingPath, pendingContent(taskId, 'Dirty Task'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, [`${taskId}.md`]);
    await registerTask(repoRoot, {
      taskId,
      fileName: `${taskId}.md`,
      title: 'Dirty Task',
      state: 'pending',
      contextPackId: null,
      contextPackDir: null,
      scopeMode: null,
      selectedRepoIds: [],
      selectedFocusIds: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivePath: null,
    });

    writeFileSync(path.join(repoRoot, 'operator-change.txt'), 'dirty\n', 'utf-8');
    const result = await activateNextPendingItemIfReady({ paths, repoRoot });

    expect(result).toEqual({ activated: false, reason: 'activation-blocked-dirty-repos' });
    expect(existsSync(pendingPath)).toBe(false);
    expect(existsSync(path.join(paths.errorItemsDir, `${taskId}.md`))).toBe(true);
    expect(existsSync(path.join(paths.activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees'))).toBe(false);
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(startPipeline).not.toHaveBeenCalled();
    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    expect(existsSync(paths.queueOrderPath)
      ? readFileSync(paths.queueOrderPath, 'utf-8')
      : '').not.toContain(`${taskId}.md`);

    const registry = await loadTaskRegistry(repoRoot);
    expect(registry.tasks['_unbound']?.failed.map((entry) => entry.taskId)).toContain(taskId);

    const events = JSON.parse(readFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json'),
      'utf-8',
    )) as { events: Array<{ eventId: string; message: string; severity: string }> };
    const message = `Unable to activate Dirty Task due to uncommitted changes in target repo ${path.basename(repoRoot)}, please resolve and try again.`;
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'activation.blocked.dirty-repos',
        severity: 'error',
        message,
      }),
      expect.objectContaining({ eventId: 'queue.task.failed' }),
      expect.objectContaining({ eventId: 'queue.error_items.moved' }),
    ]));
  });

  it('does not touch peer active markers when failing the selected dirty task', async () => {
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'platform.json'),
      JSON.stringify({ schema_version: 1, container_runtime: 'docker', max_parallel_tasks: 2 }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(paths.activeItemsDir, 'task-b'), 'task-b.md', 'utf-8');
    const peerRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-b');
    mkdirSync(peerRuntimeDir, { recursive: true });
    const peerMarker = path.join(peerRuntimeDir, 'terminal-events.json');
    writeFileSync(peerMarker, JSON.stringify({ events: [] }) + '\n', 'utf-8');
    const beforeMtime = statSync(peerMarker).mtimeMs;

    const taskId = 'dirty-task';
    writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), pendingContent(taskId, 'Dirty Task'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, [`${taskId}.md`]);
    writeFileSync(path.join(repoRoot, 'operator-change.txt'), 'dirty\n', 'utf-8');

    const result = await activateNextPendingItemIfReady({ paths, repoRoot });

    expect(result.reason).toBe('activation-blocked-dirty-repos');
    expect(existsSync(path.join(paths.activeItemsDir, 'task-b'))).toBe(true);
    expect(statSync(peerMarker).mtimeMs).toBe(beforeMtime);
  });

  it('aggregates dirty distributed repos before failing', async () => {
    const repoA = path.join(repoRoot, 'repos', 'api');
    const repoB = path.join(repoRoot, 'repos', 'web');
    initGitRepo(repoA);
    initGitRepo(repoB);
    writeFileSync(path.join(repoA, 'dirty.txt'), 'dirty\n', 'utf-8');
    writeFileSync(path.join(repoB, 'dirty.txt'), 'dirty\n', 'utf-8');

    const dirty = await findDirtyTargetRepos([
      { contextRoot: repoA, gitRoot: repoA },
      { contextRoot: repoB, gitRoot: repoB },
    ]);

    expect(dirty.map((repo) => repo.label)).toEqual(['api', 'web']);
    expect(dirty).toHaveLength(2);
  });

  it('checks the parent git root for a monolith subdirectory target', async () => {
    const subdir = path.join(repoRoot, 'src', 'backend');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(repoRoot, 'dirty.txt'), 'dirty\n', 'utf-8');

    const dirty = await findDirtyTargetRepos([
      { contextRoot: subdir, gitRoot: repoRoot },
    ]);

    expect(dirty).toEqual([
      expect.objectContaining({
        label: 'backend',
        gitRoot: repoRoot,
      }),
    ]);
  });

  it('treats no-HEAD git roots as clean for compatibility', async () => {
    const emptyRepo = path.join(repoRoot, 'empty-repo');
    mkdirSync(emptyRepo, { recursive: true });
    git(emptyRepo, ['init']);
    writeFileSync(path.join(emptyRepo, 'dirty.txt'), 'dirty\n', 'utf-8');

    await expect(findDirtyTargetRepos([
      { contextRoot: emptyRepo, gitRoot: emptyRepo },
    ])).resolves.toEqual([]);
  });
});
