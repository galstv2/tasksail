import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackFocusFilterSelection } from '../../../src/shared/desktopContract';

const tempRoots: string[] = [];

function selection() {
  return {
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
}

async function loadModule() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-focus-filters-'));
  tempRoots.push(repoRoot);
  vi.resetModules();
  vi.doMock('../../paths', () => ({ REPO_ROOT: repoRoot }));
  return {
    repoRoot,
    module: await import('./focusFilters'),
  };
}

describe('focusFilters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.doUnmock('../../paths');
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('lists an empty array when persistence is absent', async () => {
    const { module } = await loadModule();
    const result = await module.listFocusFilters({ contextPackDir: '/tmp/pack-a' });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.response : null).toMatchObject({
      action: 'focusFilters.list',
      filters: [],
    });
  });

  it('creates filters per context pack and rejects duplicate names case-insensitively', async () => {
    const { repoRoot, module } = await loadModule();
    const created = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Primary API',
      selection: selection(),
    });
    expect(created.ok).toBe(true);

    const duplicate = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'primary api',
      selection: selection(),
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok ? null : duplicate.error).toBe(
      'A focus filter named "primary api" already exists for this context pack.',
    );

    const otherPack = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-b',
      name: 'primary api',
      selection: selection(),
    });
    expect(otherPack.ok).toBe(true);

    const raw = await readFile(join(repoRoot, '.platform-state/context-pack-focus-filters.json'), 'utf-8');
    expect(JSON.parse(raw)['/tmp/pack-a']).toHaveLength(1);
    expect(JSON.parse(raw)['/tmp/pack-b']).toHaveLength(1);
  });

  it('rejects duplicate selections for the same context pack', async () => {
    const { module } = await loadModule();
    const created = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Primary API',
      selection: {
        ...selection(),
        selectedRepoIds: ['web', 'api'],
        repositoryTypes: { api: 'primary', web: 'support' },
      },
    });
    expect(created.ok).toBe(true);

    const duplicateSelection = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Same scope',
      selection: {
        ...selection(),
        selectedRepoIds: ['api', 'web'],
        repositoryTypes: { web: 'support', api: 'primary' },
      },
    });

    expect(duplicateSelection.ok).toBe(false);
    expect(duplicateSelection.ok ? null : duplicateSelection.error).toBe(
      'A focus filter with the same selection already exists for this context pack.',
    );
  });

  it('preserves and validates repository type roles', async () => {
    const { module } = await loadModule();
    const created = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Role split',
      selection: {
        ...selection(),
        selectedRepoIds: ['api', 'web'],
        repositoryTypes: { api: 'primary', web: 'support' },
      },
    });

    expect(created.ok).toBe(true);
    expect(
      created.ok && created.response.action === 'focusFilters.create'
        ? created.response.filter.selection.repositoryTypes
        : null,
    ).toEqual({ api: 'primary', web: 'support' });

    const invalid = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Bad role',
      selection: {
        ...selection(),
        repositoryTypes: { api: 'owner' },
      } as unknown as ContextPackFocusFilterSelection,
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? null : invalid.error).toBe(
      'Focus filter repository type for "api" must be primary or support.',
    );
  });

  it('rejects empty selections', async () => {
    const { module } = await loadModule();
    const emptySelection = {
      ...selection(),
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: true,
    };

    const result = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Empty',
      selection: emptySelection,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe(
      'Focus filter selection must include at least one selected scope.',
    );
  });

  it('deletes only the matching filter for a context pack', async () => {
    const { module } = await loadModule();
    const first = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'One',
      selection: selection(),
    });
    const second = await module.createFocusFilter({
      contextPackDir: '/tmp/pack-a',
      name: 'Two',
      selection: {
        ...selection(),
        selectedRepoIds: ['web'],
      },
    });
    const firstId = first.ok && first.response.action === 'focusFilters.create'
      ? first.response.filter.id
      : '';
    const secondId = second.ok && second.response.action === 'focusFilters.create'
      ? second.response.filter.id
      : '';

    const result = await module.deleteFocusFilter({ contextPackDir: '/tmp/pack-a', filterId: firstId });
    expect(result.ok).toBe(true);
    expect(result.ok && result.response.action === 'focusFilters.delete' ? result.response.filters.map((f) => f.id) : [])
      .toEqual([secondId]);
  });

  it('returns ok false when persistence JSON is corrupt', async () => {
    const { repoRoot, module } = await loadModule();
    const stateDir = join(repoRoot, '.platform-state');
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'context-pack-focus-filters.json'), '{not-json', 'utf-8');

    const result = await module.listFocusFilters({ contextPackDir: '/tmp/pack-a' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.action).toBe('focusFilters.list');
  });
});
