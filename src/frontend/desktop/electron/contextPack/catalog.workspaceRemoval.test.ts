import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import { deriveContextPackRuntimeState } from './catalog';

type SyncState = Parameters<typeof deriveContextPackRuntimeState>[2];

function syncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    activeContextPackDir: null,
    activeContextPackId: null,
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    derivedWritableRoots: [],
    derivedReadonlyContextRoots: [],
    managedFolders: [],
    status: 'idle',
    lastSyncedAt: null,
    workspaceFolderCount: null,
    workspaceFileCount: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('workspace-file-free context pack catalog runtime state', () => {
  it('never emits active-dirty-workspace for stale, untracked, or inactive state', () => {
    const packDir = resolve('/tmp/context-packs/orders');
    const cases = [
      deriveContextPackRuntimeState(packDir, null, syncState({
        activeContextPackDir: packDir,
        managedFolders: ['/tmp/missing'],
        status: 'success',
      })),
      deriveContextPackRuntimeState(packDir, packDir, syncState({
        activeContextPackDir: resolve('/tmp/context-packs/other'),
        status: 'success',
      })),
      deriveContextPackRuntimeState(packDir, null, syncState()),
    ];

    expect(cases.map((entry) => entry.status)).toEqual(['active', 'active', 'inactive']);
    expect(cases.some((entry) => String(entry.status) === 'active-dirty-workspace')).toBe(false);
  });

  it('uses active status and selection-recording copy for untracked env active packs', () => {
    const packDir = resolve('/tmp/context-packs/orders');
    const result = deriveContextPackRuntimeState(packDir, packDir, syncState({
      activeContextPackDir: null,
      status: 'idle',
    }));

    expect(result.status).toBe('active');
    expect(result.statusMessage).toBe(
      'Active context pack selected outside the desktop. Apply to record the current selection.',
    );
  });

  it('preserves state counts and falls back to workspace-counts.json through listing', async () => {
    const packDir = resolve('/tmp/context-packs/orders');
    const fromState = deriveContextPackRuntimeState(packDir, null, syncState({
      activeContextPackDir: packDir,
      status: 'success',
      workspaceFolderCount: 3,
      workspaceFileCount: 21,
    }), { folderCount: 1, fileCount: 2 });
    const fromPersisted = deriveContextPackRuntimeState(packDir, null, syncState({
      activeContextPackDir: packDir,
      status: 'success',
    }), { folderCount: 5, fileCount: 34 });

    expect(fromState.workspaceFolderCount).toBe(3);
    expect(fromState.workspaceFileCount).toBe(21);
    expect(fromPersisted.workspaceFolderCount).toBe(5);
    expect(fromPersisted.workspaceFileCount).toBe(34);

    const tempRoot = await mkdtemp(join(tmpdir(), 'catalog-workspace-removal-'));
    try {
      const contextPackDir = join(tempRoot, 'orders-estate');
      await mkdir(join(contextPackDir, 'qmd'), { recursive: true });
      await writeFile(
        join(contextPackDir, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'orders-estate',
          display_name: 'Orders Estate',
          repositories: [{ repo_id: 'orders-api', repo_name: 'Orders API' }],
          primary_working_repo_ids: ['orders-api'],
        }),
      );
      await writeFile(
        join(contextPackDir, 'workspace-counts.json'),
        JSON.stringify({ folder_count: 8, file_count: 144 }),
      );

      const envVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(envVars.paths, contextPackDir);
      vi.stubEnv(envVars.searchRoots, tempRoot);

      const { listAvailableContextPacks } = await import('./catalog');
      const response = await listAvailableContextPacks();
      const entry = response.contextPacks.find((pack) => pack.contextPackDir === contextPackDir);

      expect(entry?.workspaceFolderCount).toBe(8);
      expect(entry?.workspaceFileCount).toBe(144);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
