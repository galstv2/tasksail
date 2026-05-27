import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveFrozenStandardSelectionRoles,
  resolveFrozenStandardSelectionRoles,
} from '../standardSelectionRoles.js';

describe('standard selection role snapshots', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = path.join(tmpdir(), `tasksail-standard-roles-${process.pid}-${Date.now()}`);
    await mkdir(repoRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('preserves explicit roles and drops unselected ids', () => {
    expect(deriveFrozenStandardSelectionRoles({
      selectedIds: [' tools ', 'platform', 'tools'],
      explicitRepositoryTypes: { tools: 'primary', platform: 'support', docs: 'primary' },
      scalarPrimaryId: 'platform',
    })).toEqual({ tools: 'primary', platform: 'support' });
  });

  it('fills missing selected ids from manifest roles and manifest primary ids', () => {
    expect(deriveFrozenStandardSelectionRoles({
      selectedIds: ['platform', 'tools', 'docs'],
      explicitRepositoryTypes: { tools: 'primary' },
      manifestRepositoryTypes: { platform: 'support' },
      manifestPrimaryIds: ['docs'],
      scalarPrimaryId: 'platform',
    })).toEqual({ platform: 'support', tools: 'primary', docs: 'primary' });
  });

  it('uses scalar primary after explicit and manifest evidence', () => {
    expect(deriveFrozenStandardSelectionRoles({
      selectedIds: ['platform', 'tools'],
      manifestRepositoryTypes: { tools: 'support' },
      scalarPrimaryId: 'platform',
    })).toEqual({ platform: 'primary', tools: 'support' });
  });

  it('uses first selected fallback only when no role evidence exists', () => {
    expect(deriveFrozenStandardSelectionRoles({
      selectedIds: ['tools', 'platform'],
    })).toEqual({ tools: 'primary', platform: 'support' });
  });

  it('preserves explicit and manifest all-support evidence without promotion', () => {
    expect(deriveFrozenStandardSelectionRoles({
      selectedIds: ['platform', 'tools'],
      explicitRepositoryTypes: { platform: 'support' },
      manifestRepositoryTypes: { tools: 'support' },
    })).toEqual({ platform: 'support', tools: 'support' });
  });

  it('returns undefined for empty selections', () => {
    expect(deriveFrozenStandardSelectionRoles({ selectedIds: [' ', ''] })).toBeUndefined();
  });

  it('returns undefined for Deep Focus without reading the manifest', async () => {
    await expect(resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir: path.join(repoRoot, 'missing-pack'),
      deepFocusEnabled: true,
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
    })).resolves.toBeUndefined();
  });

  it('derives distributed roles from repository_type and primary_working_repo_ids', async () => {
    const contextPackDir = await writeManifest('distributed', {
      repositories: [
        { repo_id: 'platform', repository_type: 'primary' },
        { repo_id: 'tools', repository_type: 'support' },
        { repo_id: 'docs', repository_type: 'primary' },
      ],
      primary_working_repo_ids: ['platform'],
    });

    await expect(resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir,
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    })).resolves.toEqual({ platform: 'primary', tools: 'support' });
  });

  it('derives monolith roles from focusable_areas and primary_focus_area_ids', async () => {
    const contextPackDir = await writeManifest('monolith', {
      estate_type: 'monolith',
      focusable_areas: [
        { focus_id: 'api', repository_type: 'primary' },
        { focus_id: 'docs', repository_type: 'support' },
      ],
      primary_focus_area_ids: ['api'],
    });

    await expect(resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api', 'docs'],
    })).resolves.toEqual({ api: 'primary', docs: 'support' });
  });

  it('does not use a cache between manifest reads', async () => {
    const contextPackDir = await writeManifest('mutable', {
      repositories: [
        { repo_id: 'platform', repository_type: 'primary' },
        { repo_id: 'tools', repository_type: 'support' },
      ],
    });

    const first = await resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir,
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    });
    await writeManifest('mutable', {
      repositories: [
        { repo_id: 'platform', repository_type: 'support' },
        { repo_id: 'tools', repository_type: 'primary' },
      ],
    });
    const second = await resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir,
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    });

    expect(first).toEqual({ platform: 'primary', tools: 'support' });
    expect(second).toEqual({ platform: 'support', tools: 'primary' });
  });

  it('does not require a manifest when explicit roles cover every selected id', async () => {
    await expect(resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir: path.join(repoRoot, 'missing-pack'),
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      repositoryTypes: { platform: 'support', tools: 'support' },
      primaryRepoId: 'platform',
    })).resolves.toEqual({ platform: 'support', tools: 'support' });
  });

  it('fails closed when standard selected roles cannot be resolved from a manifest', async () => {
    await expect(resolveFrozenStandardSelectionRoles({
      repoRoot,
      contextPackDir: path.join(repoRoot, 'missing-pack'),
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
    })).rejects.toMatchObject({
      code: 'CONTEXT_PACK_SELECTION_ROLES_UNRESOLVED',
      category: 'user',
    });
  });

  async function writeManifest(
    id: string,
    overrides: Record<string, unknown>,
  ): Promise<string> {
    const contextPackDir = path.join(repoRoot, 'contextpacks', id);
    await mkdir(path.join(contextPackDir, 'qmd'), { recursive: true });
    await writeFile(
      path.join(contextPackDir, 'qmd', 'repo-sources.json'),
      JSON.stringify({
        manifest_version: 1,
        manifest_status: 'active',
        estate_type: 'distributed-platform',
        context_pack_id: id,
        qmd_scope_root: 'qmd/context-packs/test',
        primary_working_repo_ids: [],
        primary_focus_area_ids: [],
        repositories: [],
        focusable_areas: [],
        ...overrides,
      }, null, 2),
      'utf-8',
    );
    return contextPackDir;
  }
});
