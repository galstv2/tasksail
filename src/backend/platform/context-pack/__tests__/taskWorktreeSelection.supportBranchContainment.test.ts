import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { resolveSelectedMaterializationRoots } from '../taskWorktreeSelection.js';

describe('task worktree selection support containment', () => {
  let tmpDir: string;
  let repoRoot: string;
  let packDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'task-worktree-selection-support-'));
    repoRoot = path.join(tmpDir, 'platform');
    packDir = path.join(tmpDir, 'pack');
    mkdirSync(path.join(repoRoot), { recursive: true });
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

  function writeDistributedManifest(roots: Record<string, string>): void {
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      primary_working_repo_ids: ['platform'],
      primary_focus_area_ids: [],
      repositories: Object.entries(roots).map(([repoId, repoRoot]) => ({
        repo_id: repoId,
        local_paths: [repoRoot],
      })),
    }, null, 2));
  }

  it('keeps standard support repos in the selected source visibility set', async () => {
    const roots = {
      platform: repo('platform-repo'),
      tools: repo('tools-repo'),
    };
    writeDistributedManifest(roots);

    const selected = await resolveSelectedMaterializationRoots({
      repoRoot,
      contextPackDir: packDir,
      taskId: 'task-1',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'primary', tools: 'support' },
      },
    });

    expect(selected.map((root) => [root.repoId, root.role, root.originalRoot])).toEqual([
      ['platform', 'primary', roots.platform],
      ['tools', 'support', roots.tools],
    ]);
  });

  it('keeps Deep Focus support and test targets visible before authority partitioning', async () => {
    const roots = {
      platform: repo('platform-repo'),
      tools: repo('tools-repo'),
      tests: repo('tests-repo'),
    };
    writeDistributedManifest(roots);

    const selected = await resolveSelectedMaterializationRoots({
      repoRoot,
      contextPackDir: packDir,
      taskId: 'task-1',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'deep-focus',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusTargets: [{
          repoId: 'platform',
          repoLocalPath: roots.platform,
          path: 'src',
          kind: 'directory',
          supportTargets: [{ repoId: 'tools', repoLocalPath: roots.tools, path: 'tools', kind: 'directory' }],
          testTarget: { repoId: 'tests', repoLocalPath: roots.tests, path: 'tests', kind: 'directory' },
        }],
      },
    });

    expect(selected.map((root) => [root.repoId, root.role, root.originalRoot])).toEqual([
      ['platform', 'primary', roots.platform],
      ['tools', 'support', roots.tools],
      ['tests', 'support', roots.tests],
    ]);
  });
});
