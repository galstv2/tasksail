import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeTaskPackSnapshot } from '../packSnapshot.js';
import { loadTaskPackSnapshot, resolveTaskPackSnapshotPath } from '../../context-pack/taskPackSnapshot.js';

// pack-snapshot standard repositoryTypes authority
// (from packSnapshot.standardRepositoryTypes.test.ts)

describe('pack-snapshot standard repositoryTypes authority', () => {
  let stdRepoTypesTmpDir: string;
  let stdRepoTypesRepoRoot: string;
  let stdRepoTypesPackDir: string;

  beforeEach(() => {
    stdRepoTypesTmpDir = mkdtempSync(path.join(tmpdir(), 'pack-repository-types-'));
    stdRepoTypesRepoRoot = path.join(stdRepoTypesTmpDir, 'platform');
    stdRepoTypesPackDir = path.join(stdRepoTypesTmpDir, 'pack');
    mkdirSync(path.join(stdRepoTypesRepoRoot, 'AgentWorkSpace', 'tasks', 'task-1'), { recursive: true });
    mkdirSync(path.join(stdRepoTypesPackDir, 'qmd'), { recursive: true });
  });

  afterEach(() => {
    rmSync(stdRepoTypesTmpDir, { recursive: true, force: true });
  });

  function stdRepo(name: string): string {
    const repoDir = path.join(stdRepoTypesTmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function writeDistributedManifest(ids: string[]): Record<string, string> {
    const roots = Object.fromEntries(ids.map((id) => [id, stdRepo(`${id}-repo`)]));
    writeFileSync(path.join(stdRepoTypesPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
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
      repoRoot: stdRepoTypesRepoRoot,
      taskId: 'task-1',
      contextPackDir: stdRepoTypesPackDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools', 'docs'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      },
      selection: {
        contextPackDir: stdRepoTypesPackDir,
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
      repoRoot: stdRepoTypesRepoRoot,
      taskId: 'task-1',
      contextPackDir: stdRepoTypesPackDir,
      contextPackId: 'orders',
      binding: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'support', tools: 'support' },
      },
      selection: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'orders',
        scopeMode: 'repo-selection',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        repositoryTypes: { platform: 'support', tools: 'support' },
      },
    })).rejects.toThrow('Selection Roles must include at least one primary selected repo');
  });

  it('anchors single-primary standard monolith writable roots to the monolith repo root', async () => {
    const monoRoot = stdRepo('monolith-repo');
    writeFileSync(path.join(stdRepoTypesPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repository: { repo_id: 'mono', local_paths: [monoRoot] },
      primary_working_repo_ids: ['mono'],
      primary_focus_area_ids: ['platform'],
      focusable_areas: [
        { focus_id: 'platform', relative_path: 'platform', repository_type: 'primary' },
        { focus_id: 'tools', relative_path: 'tools', repository_type: 'support' },
      ],
    }, null, 2));

    const snapshot = await writeTaskPackSnapshot({
      repoRoot: stdRepoTypesRepoRoot,
      taskId: 'task-1',
      contextPackDir: stdRepoTypesPackDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'platform',
        selectedRepoIds: [],
        selectedFocusIds: ['platform', 'tools'],
        repositoryTypes: { platform: 'primary', tools: 'support' },
      },
      selection: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'platform',
        selectedRepoIds: [],
        selectedFocusIds: ['platform', 'tools'],
        repositoryTypes: { platform: 'primary', tools: 'support' },
      },
    });

    expect(snapshot.deepFocus.writableRoots).toEqual([
      { repoLocalPath: monoRoot, path: 'platform', kind: 'directory', reason: 'selected-primary' },
    ]);
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([
      { repoLocalPath: monoRoot, path: 'tools', kind: 'directory', reason: 'support-target' },
    ]);
  });

  it('makes multiple standard monolith primary focus ids writable and support focus ids read-only', async () => {
    const monoRoot = stdRepo('monolith-repo');
    writeFileSync(path.join(stdRepoTypesPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
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
      repoRoot: stdRepoTypesRepoRoot,
      taskId: 'task-1',
      contextPackDir: stdRepoTypesPackDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: stdRepoTypesPackDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'api',
        selectedRepoIds: [],
        selectedFocusIds: ['api', 'worker', 'docs'],
        repositoryTypes: { api: 'primary', worker: 'primary', docs: 'support' },
      },
      selection: {
        contextPackDir: stdRepoTypesPackDir,
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

  it('writes a Deep Focus monolith snapshot when only the primary focus id was persisted', async () => {
    const monolithRepo = makeRepo('monolith-repo');
    mkdirSync(path.join(monolithRepo, 'platform'), { recursive: true });
    writeManifest({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repository: { repo_id: 'mono', local_paths: [monolithRepo] },
      primary_working_repo_ids: ['mono'],
      primary_focus_area_ids: ['platform'],
      focusable_areas: [
        { focus_id: 'platform', relative_path: 'platform', repository_type: 'primary' },
      ],
    });

    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'platform',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusTargets: [],
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusTargets: [],
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
    });

    expect(snapshot.primary.focusId).toBe('platform');
    expect(snapshot.selectedFocusIds).toEqual(['platform']);
    expect(snapshot.deepFocus.primaryFocusTargets).toEqual([
      { path: 'platform', kind: 'directory', role: 'anchor', repoLocalPath: monolithRepo },
    ]);
    expect(snapshot.deepFocus.writableRoots).toEqual([
      {
        repoLocalPath: monolithRepo,
        path: 'platform',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{ path: 'platform', kind: 'directory', role: 'anchor', repoLocalPath: monolithRepo }],
      },
    ]);
  });

  it('anchors Deep Focus monolith target-only snapshots to the monolith repo root', async () => {
    const monolithRepo = makeRepo('monolith-repo');
    mkdirSync(path.join(monolithRepo, 'platform'), { recursive: true });
    mkdirSync(path.join(monolithRepo, 'tools'), { recursive: true });
    writeManifest({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repository: { repo_id: 'mono', local_paths: [monolithRepo] },
      primary_working_repo_ids: ['mono'],
      primary_focus_area_ids: ['platform'],
      focusable_areas: [
        { focus_id: 'platform', relative_path: 'platform', repository_type: 'primary' },
        { focus_id: 'tools', relative_path: 'tools', repository_type: 'support' },
      ],
    });

    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'platform',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusPath: 'platform',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [{
          path: 'platform',
          kind: 'directory',
          focusId: 'platform',
          role: 'anchor',
          supportTargets: [],
        }],
        selectedSupportTargets: [{
          path: 'tools',
          kind: 'directory',
          repoLocalPath: monolithRepo,
          focusId: 'tools',
        }],
        selectedTestTarget: null,
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusPath: 'platform',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [{
          path: 'platform',
          kind: 'directory',
          focusId: 'platform',
          role: 'anchor',
          supportTargets: [],
        }],
        selectedSupportTargets: [{
          path: 'tools',
          kind: 'directory',
          repoLocalPath: monolithRepo,
          focusId: 'tools',
        }],
        selectedTestTarget: null,
      },
    });

    expect(snapshot.deepFocus.writableRoots).toEqual([
      {
        repoLocalPath: monolithRepo,
        path: 'platform',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{
          path: 'platform',
          kind: 'directory',
          focusId: 'platform',
          role: 'anchor',
          repoLocalPath: monolithRepo,
        }],
      },
    ]);
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([
      {
        repoLocalPath: monolithRepo,
        path: 'tools',
        kind: 'directory',
        reason: 'support-target',
      },
    ]);
  });

  it('uses monolith Deep Focus target arrays as multi-primary authority', async () => {
    const monolithRepo = makeRepo('monolith-repo');
    mkdirSync(path.join(monolithRepo, 'platform'), { recursive: true });
    mkdirSync(path.join(monolithRepo, 'tools'), { recursive: true });
    writeManifest({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repository: { repo_id: 'mono', local_paths: [monolithRepo] },
      primary_working_repo_ids: ['mono'],
      primary_focus_area_ids: ['platform'],
      focusable_areas: [
        { focus_id: 'platform', relative_path: 'platform', repository_type: 'primary' },
        { focus_id: 'tools', relative_path: 'tools', repository_type: 'support' },
      ],
    });
    const selectedFocusTargets = [
      {
        path: 'platform',
        kind: 'directory' as const,
        focusId: 'platform',
        role: 'anchor' as const,
        supportTargets: [],
      },
      {
        path: 'tools',
        kind: 'directory' as const,
        focusId: 'tools',
        role: 'primary' as const,
        supportTargets: [],
      },
    ];

    const snapshot = await writeTaskPackSnapshot({
      repoRoot,
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'mono',
      binding: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        primaryFocusId: 'platform',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusPath: 'platform',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets,
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
      selection: {
        contextPackDir: packDir,
        contextPackId: 'mono',
        scopeMode: 'focus-selection',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'platform',
        selectedFocusPath: 'platform',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets,
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
    });

    expect(snapshot.selectedFocusIds).toEqual(['platform', 'tools']);
    expect(snapshot.deepFocus.primaryFocusTargets).toEqual([
      {
        path: 'platform',
        kind: 'directory',
        focusId: 'platform',
        role: 'anchor',
        repoLocalPath: monolithRepo,
      },
      {
        path: 'tools',
        kind: 'directory',
        focusId: 'tools',
        role: 'primary',
        repoLocalPath: monolithRepo,
      },
    ]);
    expect(snapshot.deepFocus.writableRoots).toEqual([
      {
        repoLocalPath: monolithRepo,
        path: 'platform',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{
          path: 'platform',
          kind: 'directory',
          focusId: 'platform',
          role: 'anchor',
          repoLocalPath: monolithRepo,
        }],
      },
      {
        repoLocalPath: monolithRepo,
        path: 'tools',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{
          path: 'tools',
          kind: 'directory',
          focusId: 'tools',
          role: 'primary',
          repoLocalPath: monolithRepo,
        }],
      },
    ]);
    expect(snapshot.deepFocus.readonlyContextRoots).toEqual([]);
  });

  it('rejects a distributed primary that is outside the selected repo set', async () => {
    const platformRepo = makeRepo('platform-repo');
    writeManifest({
      manifest_version: 2,
      manifest_status: 'active',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      primary_working_repo_ids: ['rogue'],
      primary_focus_area_ids: [],
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
