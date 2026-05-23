import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatContextPackBindingSection } from '../markdown.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { registerTask } from '../taskRegistry.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';

const startPipeline = vi.fn();
vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({ startPipeline }));

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function initGitRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repoDir, 'README.md'), '# repo\n', 'utf-8');
  writeFileSync(path.join(repoDir, '.gitignore'), 'AgentWorkSpace/\n.platform-state/\ncontextpacks/\n', 'utf-8');
  git(repoDir, ['add', 'README.md', '.gitignore']);
  git(repoDir, ['commit', '-m', 'initial']);
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
  return `# Multi Primary

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

describe('standard Selection Roles activation', () => {
  let repoRoot: string;
  let previousAutostart: string | undefined;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'standard-repository-types-activation-'));
    previousAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    startPipeline.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (previousAutostart === undefined) delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    else process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = previousAutostart;
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes selection.repositoryTypes and pack snapshot writable roots before pipeline start', async () => {
    const platformRepo = path.join(repoRoot, 'platform-repo');
    const toolsRepo = path.join(repoRoot, 'tools-repo');
    initGitRepo(repoRoot);
    initGitRepo(platformRepo);
    initGitRepo(toolsRepo);
    const packDir = path.join(repoRoot, 'contextpacks', 'orders');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      primary_working_repo_ids: ['platform'],
      primary_focus_area_ids: [],
      repositories: [
        { repo_id: 'platform', local_paths: [platformRepo] },
        { repo_id: 'tools', local_paths: [toolsRepo] },
      ],
    }, null, 2));
    const taskId = 'multi-primary';
    await seedPending(repoRoot, taskId, taskMarkdown(formatContextPackBindingSection({
      contextPackDir: packDir,
      contextPackId: 'orders',
      scopeMode: 'repo-selection',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      repositoryTypes: { platform: 'primary', tools: 'primary' },
    })));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const taskJson = JSON.parse(readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'), 'utf-8'));
    expect(taskJson.contextPackBinding.selection.repositoryTypes).toEqual({ platform: 'primary', tools: 'primary' });
    const snapshot = JSON.parse(readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'pack-snapshot.json'), 'utf-8'));
    expect(snapshot.support).toEqual([]);
    expect(snapshot.deepFocus.writableRoots).toEqual(expect.arrayContaining([
      { repoLocalPath: realpathSync(platformRepo), path: '', kind: 'directory', reason: 'selected-primary' },
      { repoLocalPath: realpathSync(toolsRepo), path: '', kind: 'directory', reason: 'selected-primary' },
    ]));
  });

  it('rejects malformed present Selection Roles before runtime sidecars are written', async () => {
    initGitRepo(repoRoot);
    const taskId = 'malformed-types';
    await seedPending(repoRoot, taskId, taskMarkdown(`## Context Pack Binding

- Context Pack Dir: ${path.join(repoRoot, 'contextpacks', 'orders')}
- Selected Repo IDs: platform
- Selection Roles: {"platform":"writer"}
`));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .rejects.toThrow('malformed-repository-types');
  });
});
