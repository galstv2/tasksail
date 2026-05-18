import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, parse } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const tempRoots: string[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadModule() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-delete-'));
  tempRoots.push(repoRoot);
  vi.resetModules();
  vi.doMock('../paths', () => ({ REPO_ROOT: repoRoot }));
  return {
    repoRoot,
    module: await import('./delete'),
    focusFilters: await import('./focusFilters'),
    sidebarState: await import('./contextPackSidebarState'),
    deepFocusSelections: await import('./deepFocusSelections'),
  };
}

function catalogEntry(contextPackDir: string, isActive: boolean) {
  return {
    contextPackId: 'pack',
    displayName: 'Pack',
    contextPackDir,
    manifestPath: null,
    bootstrapReady: true,
    source: 'configured-path' as const,
    isActive,
    estateType: 'distributed-platform',
    defaultScopeMode: 'focused' as const,
    repoCount: 0,
    primaryWorkingRepoIds: [],
    focusTargets: [],
  };
}

describe('contextPack delete action', () => {
  afterEach(async () => {
    vi.doUnmock('../paths');
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('deletes inactive canonical and AgentWorkSpace mirror directories', async () => {
    const { repoRoot, module } = await loadModule();
    const packDir = join(repoRoot, 'contextpacks', 'pack-a');
    const mirrorDir = join(repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', 'pack-a');
    await mkdir(packDir, { recursive: true });
    await mkdir(mirrorDir, { recursive: true });

    const result = await module.executeContextPackDeleteAction(
      { contextPackDir: packDir },
      async () => ({
        action: 'contextPack.list',
        mode: 'read-only',
        message: '1 pack.',
        activeContextPackDir: null,
        configuredPaths: [],
        searchRoots: [],
        recentContextPackDirs: [],
        contextPacks: [catalogEntry(packDir, false)],
      }),
    );

    expect(result.ok).toBe(true);
    expect(await exists(packDir)).toBe(false);
    expect(await exists(mirrorDir)).toBe(false);
  });

  it('refuses active packs and unknown catalog paths', async () => {
    const { repoRoot, module } = await loadModule();
    const packDir = join(repoRoot, 'contextpacks', 'pack-a');
    await mkdir(packDir, { recursive: true });
    const list = async (isActive: boolean) => ({
      action: 'contextPack.list' as const,
      mode: 'read-only' as const,
      message: '1 pack.',
      activeContextPackDir: isActive ? packDir : null,
      configuredPaths: [],
      searchRoots: [],
      recentContextPackDirs: [],
      contextPacks: [catalogEntry(packDir, isActive)],
    });

    expect((await module.executeContextPackDeleteAction({ contextPackDir: packDir }, () => list(true))).ok)
      .toBe(false);
    expect(await exists(packDir)).toBe(true);
    expect((await module.executeContextPackDeleteAction({ contextPackDir: join(repoRoot, 'contextpacks', 'missing') }, () => list(false))).ok)
      .toBe(false);
  });

  it('refuses inactive packs that still have active tasks', async () => {
    const { repoRoot, module } = await loadModule();
    const packDir = join(repoRoot, 'contextpacks', 'pack-a');
    const mirrorDir = join(repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', 'pack-a');
    const pendingDir = join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    await mkdir(packDir, { recursive: true });
    await mkdir(mirrorDir, { recursive: true });
    await mkdir(join(pendingDir, '.active-items'), { recursive: true });
    await writeFile(join(pendingDir, '.active-items', 'task-a'), '', 'utf-8');
    await writeFile(
      join(pendingDir, 'task-a.md'),
      [
        '# Active Task',
        '',
        '- Task ID: task-a',
        '',
        '## Context Pack Binding',
        '',
        `- Context Pack Dir: ${packDir}`,
        '- Context Pack ID: pack',
        '- Scope Mode: focused',
      ].join('\n'),
      'utf-8',
    );

    const result = await module.executeContextPackDeleteAction(
      { contextPackDir: packDir },
      async () => ({
        action: 'contextPack.list',
        mode: 'read-only',
        message: '1 pack.',
        activeContextPackDir: null,
        configuredPaths: [],
        searchRoots: [],
        recentContextPackDirs: [],
        contextPacks: [catalogEntry(packDir, false)],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toContain('task(s) are active: task-a');
    expect(await exists(packDir)).toBe(true);
    expect(await exists(mirrorDir)).toBe(true);
  });

  it('refuses dangerous paths', async () => {
    const { repoRoot, module } = await loadModule();
    const dangerous = [
      repoRoot,
      join(repoRoot, 'AgentWorkSpace'),
      join(repoRoot, 'contextpacks'),
      homedir(),
      parse(repoRoot).root,
    ];
    for (const contextPackDir of dangerous) {
      const result = await module.executeContextPackDeleteAction(
        { contextPackDir },
        async () => ({
          action: 'contextPack.list',
          mode: 'read-only',
          message: '1 pack.',
          activeContextPackDir: null,
          configuredPaths: [],
          searchRoots: [],
          recentContextPackDirs: [],
          contextPacks: [catalogEntry(contextPackDir, false)],
        }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it('removes stale focus-filter, sidebar, and deep-focus persistence for a deleted pack', async () => {
    const {
      repoRoot,
      module,
      focusFilters,
      sidebarState,
      deepFocusSelections,
    } = await loadModule();
    const packDir = join(repoRoot, 'contextpacks', 'pack-a');
    const mirrorDir = join(repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', 'pack-a');
    await mkdir(packDir, { recursive: true });
    await mkdir(mirrorDir, { recursive: true });
    const selection = {
      selectedRepoIds: ['api'],
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
    await focusFilters.createFocusFilter({ contextPackDir: packDir, name: 'API', selection });
    await sidebarState.saveContextPackSidebarState({ selectedContextPackDir: packDir, selection });
    await deepFocusSelections.saveDeepFocusSelections({ contextPackDir: packDir, selections: selection });

    const result = await module.executeContextPackDeleteAction(
      { contextPackDir: packDir },
      async () => ({
        action: 'contextPack.list',
        mode: 'read-only',
        message: '1 pack.',
        activeContextPackDir: null,
        configuredPaths: [],
        searchRoots: [],
        recentContextPackDirs: [],
        contextPacks: [catalogEntry(packDir, false)],
      }),
    );

    expect(result.ok).toBe(true);
    const filters = await focusFilters.listFocusFilters({ contextPackDir: packDir });
    expect(filters.ok && filters.response.action === 'focusFilters.list' ? filters.response.filters : [])
      .toEqual([]);
    const sidebar = await sidebarState.loadContextPackSidebarState();
    expect(sidebar.ok && sidebar.response.action === 'contextPackSidebarState.load'
      ? sidebar.response.state?.selectedContextPackDir
      : 'unexpected').toBeNull();
    const deepFocus = await deepFocusSelections.loadDeepFocusSelections({ contextPackDir: packDir });
    expect(deepFocus.ok && deepFocus.response.action === 'deepFocus.loadSelections'
      ? deepFocus.response.selections
      : 'unexpected').toBeNull();
  });
});
