import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const tempRoots: string[] = [];

function selection(repoId: string) {
  return {
    selectedRepoIds: [repoId],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
  };
}

async function loadModule() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-sidebar-state-'));
  tempRoots.push(repoRoot);
  vi.resetModules();
  vi.doMock('../paths', () => ({ REPO_ROOT: repoRoot }));
  return await import('./contextPackSidebarState');
}

describe('contextPackSidebarState', () => {
  afterEach(async () => {
    vi.doUnmock('../paths');
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('loads null when persistence is absent', async () => {
    const module = await loadModule();
    const result = await module.loadContextPackSidebarState();
    expect(result.ok).toBe(true);
    expect(result.ok ? result.response : null).toMatchObject({
      action: 'contextPackSidebarState.load',
      state: null,
    });
  });

  it('saves selected context pack and preserves other pack snapshots', async () => {
    const module = await loadModule();
    await module.saveContextPackSidebarState({
      selectedContextPackDir: '/tmp/pack-a',
      selection: selection('api'),
    });
    await module.saveContextPackSidebarState({
      selectedContextPackDir: '/tmp/pack-b',
      selection: selection('web'),
    });

    const loaded = await module.loadContextPackSidebarState();
    const state = loaded.ok && loaded.response.action === 'contextPackSidebarState.load'
      ? loaded.response.state
      : null;
    expect(state?.selectedContextPackDir).toBe('/tmp/pack-b');
    expect(state?.selectionsByContextPackDir['/tmp/pack-a']?.selectedRepoIds).toEqual(['api']);
    expect(state?.selectionsByContextPackDir['/tmp/pack-b']?.selectedRepoIds).toEqual(['web']);
  });

  it('saving null clears only the selected pointer', async () => {
    const module = await loadModule();
    await module.saveContextPackSidebarState({
      selectedContextPackDir: '/tmp/pack-a',
      selection: selection('api'),
    });
    await module.saveContextPackSidebarState({
      selectedContextPackDir: null,
      selection: null,
    });
    const loaded = await module.loadContextPackSidebarState();
    const state = loaded.ok && loaded.response.action === 'contextPackSidebarState.load'
      ? loaded.response.state
      : null;
    expect(state?.selectedContextPackDir).toBeNull();
    expect(state?.selectionsByContextPackDir['/tmp/pack-a']?.selectedRepoIds).toEqual(['api']);
  });
});
