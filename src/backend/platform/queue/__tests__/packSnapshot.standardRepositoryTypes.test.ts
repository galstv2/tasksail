import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeTaskPackSnapshot } from '../packSnapshot.js';

describe('pack-snapshot standard repositoryTypes authority', () => {
  let tmpDir: string;
  let repoRoot: string;
  let packDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pack-repository-types-'));
    repoRoot = path.join(tmpDir, 'platform');
    packDir = path.join(tmpDir, 'pack');
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1'), { recursive: true });
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function repo(name: string): string {
    const repoDir = path.join(tmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function writeDistributedManifest(ids: string[]): Record<string, string> {
    const roots = Object.fromEntries(ids.map((id) => [id, repo(`${id}-repo`)]));
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      primary_working_repo_ids: [ids[0]],
      primary_focus_area_ids: [],
      repositories: ids.map((id) => ({ repo_id: id, local_paths: [roots[id]] })),
    }, null, 2));
    return roots;
  }

  it('makes every selected primary repo writable and keeps support read-only', async () => {
    const roots = writeDistributedManifest(['platform', 'tools', 'docs']);
    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools', 'docs'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools', 'docs'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      },
    });

    expect(snapshot.primary.repoId).toBe('platform');
    expect(snapshot.support).toEqual([{ repoId: 'docs', repoRoot: roots.docs }]);
    expect(snapshot.deepFocus.writableRoots).toEqual(expect.arrayContaining([
      { repoLocalPath: roots.platform, path: '', kind: 'directory', reason: 'selected-primary' },
      { repoLocalPath: roots.tools, path: '', kind: 'directory', reason: 'selected-primary' },
    ]));
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([
      { repoLocalPath: roots.docs, path: '', kind: 'directory', reason: 'support-repo' },
    ]);
  });

  it('fails closed when Selection Roles has no selected primary repo', async () => {
    writeDistributedManifest(['platform', 'tools']);
    await expect(writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'support', tools: 'support' },
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'support', tools: 'support' },
      },
    })).rejects.toThrow('Selection Roles must include at least one primary selected repo');
  });

  it('makes multiple standard monolith primary focus ids writable and support focus ids read-only', async () => {
    const monoRoot = repo('monolith-repo');
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repository: { repo_id: 'mono', local_paths: [monoRoot] },
      primary_working_repo_ids: ['mono'],
      primary_focus_area_ids: ['api'],
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
        { focus_id: 'worker', relative_path: 'apps/worker', repository_type: 'primary' },
        { focus_id: 'docs', relative_path: 'docs', repository_type: 'support' },
      ],
    }, null, 2));

    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'api',
        selectedRepoIds: [],
        selectedFocusIds: ['api', 'worker', 'docs'],
        repositoryTypes: { api: 'primary', worker: 'primary', docs: 'support' },
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'api',
        selectedRepoIds: [],
        selectedFocusIds: ['api', 'worker', 'docs'],
        repositoryTypes: { api: 'primary', worker: 'primary', docs: 'support' },
      },
    });

    expect(snapshot.deepFocus.writableRoots.map((root) => root.path).sort())
      .toEqual(['apps/api', 'apps/worker']);
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([
      { repoLocalPath: monoRoot, path: 'docs', kind: 'directory', reason: 'support-target' },
    ]);
  });
});
