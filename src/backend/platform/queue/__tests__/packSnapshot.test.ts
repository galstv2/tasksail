import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeTaskPackSnapshot } from '../packSnapshot.js';
import { loadTaskPackSnapshot, resolveTaskPackSnapshotPath } from '../../context-pack/taskPackSnapshot.js';

describe('pack-snapshot writer and reader', () => {
  let tmpDir: string;
  let repoRoot: string;
  let packDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pack-snapshot-test-'));
    repoRoot = path.join(tmpDir, 'platform');
    packDir = path.join(tmpDir, 'pack');
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1'), { recursive: true });
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRepo(name: string): string {
    const repoDir = path.join(tmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function writeManifest(payload: object): void {
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify(payload, null, 2));
  }

  it('writes a distributed snapshot with the explicit primary and support repos', async () => {
    const platformRepo = makeRepo('platform-repo');
    const toolsRepo = makeRepo('tools-repo');
    writeManifest({
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      repositories: [
        { repo_id: 'platform', local_paths: [platformRepo] },
        { repo_id: 'tools', local_paths: [toolsRepo] },
      ],
    });

    await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
      },
    });

    const snapshot = await loadTaskPackSnapshot(repoRoot, 'task-1');
    expect(snapshot.primary).toMatchObject({ repoId: 'platform', repoRoot: platformRepo });
    expect(snapshot.support).toEqual([{ repoId: 'tools', repoRoot: toolsRepo }]);
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([
      {
        repoLocalPath: toolsRepo,
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
    ]);
    expect(snapshot.selectedFocusIds).toEqual([]);
    expect(snapshot.qmdScopeRoot).toBe('qmd/context-packs/orders');
  });

  it('does not persist standard-mode support roots when deep focus is enabled', async () => {
    const platformRepo = makeRepo('platform-repo');
    const toolsRepo = makeRepo('tools-repo');
    writeManifest({
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      repositories: [
        { repo_id: 'platform', local_paths: [platformRepo] },
        { repo_id: 'tools', local_paths: [toolsRepo] },
      ],
    });

    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'platform',
      },
    });

    expect(snapshot.deepFocus.enabled).toBe(true);
    expect(snapshot.deepFocus.readonlyContextRoots.some((root) => root.reason === 'support-repo')).toBe(false);
  });

  it('rejects a distributed primary that is outside the selected repo set', async () => {
    const platformRepo = makeRepo('platform-repo');
    writeManifest({
      estate_type: 'distributed-platform',
      repositories: [{ repo_id: 'platform', local_paths: [platformRepo] }],
    });

    await expect(writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'rogue',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'orders',
        scopeMode: 'focused',
        primaryRepoId: 'rogue',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
      },
    })).rejects.toThrow('Primary Repo ID "rogue" is not in Selected Repo IDs');
    await expect(loadTaskPackSnapshot(repoRoot, 'task-1')).rejects.toThrow('Missing pack-snapshot.json');
  });

  it('loads malformed snapshots fail-closed with re-create guidance', async () => {
    writeFileSync(resolveTaskPackSnapshotPath(repoRoot, 'task-1'), JSON.stringify({ schemaVersion: 1 }));

    await expect(loadTaskPackSnapshot(repoRoot, 'task-1')).rejects.toThrow('Re-activate or re-create the task');
  });
});
