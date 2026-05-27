import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { formatContextPackBindingSection } from '../markdown.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';
import { registerTask } from '../taskRegistry.js';
import {
  materializeReadonlyContextWorktree,
  removeReadonlyContextWorktree,
} from '../supportContextMaterialization.js';

const startPipeline = vi.hoisted(() => vi.fn());
vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({ startPipeline }));

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
}

function initRepo(repo: string): string {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repo, 'README.md'), '# repo\n', 'utf-8');
  writeFileSync(path.join(repo, '.gitignore'), 'AgentWorkSpace/\n.platform-state/\ncontextpacks/\n', 'utf-8');
  git(repo, ['add', 'README.md', '.gitignore']);
  git(repo, ['commit', '-m', 'initial']);
  return git(repo, ['rev-parse', 'HEAD']);
}

function seedTemplates(templatesDir: string): void {
  mkdirSync(templatesDir, { recursive: true });
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`, 'utf-8');
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n', 'utf-8');
}

async function seedPending(repoRoot: string, taskId: string, content: string): Promise<void> {
  const paths = resolveQueuePaths(repoRoot);
  seedTemplates(paths.templatesDir);
  mkdirSync(paths.pendingDir, { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), content, 'utf-8');
  await writeQueueOrderManifest(paths.queueOrderPath, [`${taskId}.md`]);
  await registerTask(repoRoot, {
    taskId,
    fileName: `${taskId}.md`,
    title: taskId,
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
}

function taskMarkdown(contextPackBinding: string): string {
  return `# Rollback

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

${contextPackBinding}

## Request Summary

Do it.
`;
}

describe('support context materialization', () => {
  let tmp: string;
  let repoRoot: string;
  let origin: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'support-context-materialization-'));
    repoRoot = path.join(tmp, 'platform');
    origin = path.join(tmp, 'support');
    initRepo(repoRoot);
    initRepo(origin);
    startPipeline.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('materializes and removes a detached read-only context worktree without creating a branch', async () => {
    const taskId = 'task-readonly';
    const baseCommitSha = git(origin, ['rev-parse', 'HEAD']);
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'support');

    const result = await materializeReadonlyContextWorktree({
      repoRoot,
      pathsToClone: [],
      plan: {
        taskId,
        repoId: 'support',
        repoLabel: 'support',
        originalRoot: origin,
        gitRoot: origin,
        worktreeRoot,
        source: 'standard-support',
      },
    });

    expect(result.binding).toEqual({
      originalRoot: origin,
      worktreeRoot,
      baseCommitSha,
      repoId: 'support',
      role: 'support',
    });
    expect(git(worktreeRoot, ['branch', '--show-current'])).toBe('');
    expect(git(origin, ['branch', '--list', `task/${taskId}`])).toBe('');

    await removeReadonlyContextWorktree({
      repoRoot,
      taskId,
      binding: result.binding,
      source: 'standard-support',
    });

    expect(existsSync(worktreeRoot)).toBe(false);
    expect(git(origin, ['worktree', 'list', '--porcelain'])).not.toContain(worktreeRoot);
    expect(git(origin, ['branch', '--list', `task/${taskId}`])).toBe('');
  });

  it('fails read-only context cleanup when git refuses to remove the detached worktree', async () => {
    const taskId = 'task-readonly-locked';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'support');
    const result = await materializeReadonlyContextWorktree({
      repoRoot,
      pathsToClone: [],
      plan: {
        taskId,
        repoId: 'support',
        repoLabel: 'support',
        originalRoot: origin,
        gitRoot: origin,
        worktreeRoot,
        source: 'standard-support',
      },
    });
    git(origin, ['worktree', 'lock', worktreeRoot]);

    await expect(removeReadonlyContextWorktree({
      repoRoot,
      taskId,
      binding: result.binding,
      source: 'standard-support',
    })).rejects.toThrow('cannot remove a locked working tree');

    expect(existsSync(worktreeRoot)).toBe(true);
    expect(git(origin, ['worktree', 'list', '--porcelain'])).toContain(worktreeRoot);
  });

  it('cleans a partial detached worktree attempt and prunes the origin when add fails', async () => {
    const taskId = 'task-add-fails';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'support');
    const calls: string[][] = [];
    const execFileAsync = vi.fn(async (_file: string, args: string[]) => {
      calls.push([...args]);
      if (args.includes('add')) {
        throw new Error('add failed');
      }
      if (args.at(-1) === 'HEAD^{}') {
        return { stdout: 'abc123\n', stderr: '' };
      }
      return { stdout: 'true\n', stderr: '' };
    });

    await expect(materializeReadonlyContextWorktree({
      repoRoot,
      pathsToClone: [],
      execFileAsync,
      plan: {
        taskId,
        repoId: 'support',
        repoLabel: 'support',
        originalRoot: origin,
        gitRoot: origin,
        worktreeRoot,
        source: 'standard-support',
      },
    })).rejects.toThrow('add failed');

    expect(calls).toContainEqual([
      '-C', origin,
      'worktree', 'add',
      '--detach',
      worktreeRoot,
      'abc123',
    ]);
    expect(calls).not.toEqual(expect.arrayContaining([
      expect.arrayContaining(['worktree', 'add', '-b']),
    ]));
    expect(calls).toContainEqual([
      '-C', origin,
      'worktree', 'remove',
      '--force',
      worktreeRoot,
    ]);
    expect(calls).toContainEqual(['-C', origin, 'worktree', 'prune']);
    expect(calls).not.toEqual(expect.arrayContaining([
      expect.arrayContaining(['branch', '-D']),
    ]));
  });

  it('fails closed when the origin root is missing', async () => {
    await expect(materializeReadonlyContextWorktree({
      repoRoot,
      pathsToClone: [],
      plan: {
        taskId: 'missing-origin',
        repoId: 'support',
        repoLabel: 'support',
        originalRoot: path.join(tmp, 'missing'),
        gitRoot: path.join(tmp, 'missing'),
        worktreeRoot: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'missing-origin', 'worktrees', 'support'),
        source: 'standard-support',
      },
    })).rejects.toThrow('readonly-context-origin-missing');
  });

  it('activation rollback removes already-created readonly context worktrees', async () => {
    const primaryRepo = path.join(tmp, 'primary');
    const supportRepo = path.join(tmp, 'support-activation');
    initRepo(primaryRepo);
    initRepo(supportRepo);
    const packDir = path.join(repoRoot, 'contextpacks', 'orders');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      primary_working_repo_ids: ['primary'],
      primary_focus_area_ids: [],
      repositories: [
        { repo_id: 'primary', local_paths: [primaryRepo] },
        { repo_id: 'support', local_paths: [supportRepo] },
      ],
    }, null, 2));
    const taskId = 'rollback-readonly';
    await seedPending(repoRoot, taskId, taskMarkdown(formatContextPackBindingSection({
      contextPackDir: packDir,
      contextPackId: 'orders',
      scopeMode: 'repo-selection',
      primaryRepoId: 'primary',
      selectedRepoIds: ['primary', 'support'],
      selectedFocusIds: [],
      repositoryTypes: { primary: 'primary', support: 'support' },
    })));
    startPipeline.mockRejectedValueOnce(new Error('spawn failed'));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: false, reason: 'pipeline-spawn-failed' });

    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    expect(existsSync(taskDir)).toBe(false);
    expect(git(supportRepo, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
    expect(git(supportRepo, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(primaryRepo, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(existsSync(path.join(taskDir, '.task.json'))).toBe(false);
    expect(readFileSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${taskId}.md`), 'utf-8')).toContain('# Rollback');
  });
});
