import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  collectFocusedRepoTargetDirectoryRoots,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
  resolveWorkspaceRepoRoots,
} from '../focusedRepo.js';

describe('resolveFocusedRepoRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'focused-repo-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeManifest(contextPackDir: string, manifest: object): void {
    const manifestDir = path.join(contextPackDir, 'qmd');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      path.join(manifestDir, 'repo-sources.json'),
      JSON.stringify(manifest, null, 2),
    );
  }

  function makeRepo(name: string): string {
    const repoDir = path.join(tmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function makeFile(filePath: string): string {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '');
    return realpathSync(filePath);
  }

  function writeActiveContextPackSidecar(binding: object): void {
    const queueStateDir = path.join(tmpDir, 'platform', '.platform-state', 'queue');
    mkdirSync(queueStateDir, { recursive: true });
    writeFileSync(
      path.join(queueStateDir, 'active-context-pack.json'),
      JSON.stringify(binding, null, 2),
    );
  }

  function writeWorkspaceSyncState(binding: object): void {
    const stateDir = path.join(tmpDir, 'platform', '.platform-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, 'workspace-context-sync.json'),
      JSON.stringify(binding, null, 2),
    );
  }

  /** Create a minimal platform repo dir with a workspace file. */
  function makePlatformRepo(workspaceFolders: Array<{ path: string }>): string {
    const repoRoot = makeRepo('platform');
    writeFileSync(
      path.join(repoRoot, 'tasksail.code-workspace'),
      JSON.stringify({ folders: workspaceFolders }, null, 2),
    );
    return repoRoot;
  }

  it('returns undefined when manifest is missing', async () => {
    const packDir = makeRepo('pack');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeUndefined();
  });

  it('resolves monolith repo from repository field', async () => {
    const repoDir = makeRepo('my-app');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    expect(result!.primaryRepoRoot).toBe(realpathSync(repoDir));
    expect(result!.estateType).toBe('monolith');
    expect(result!.primaryRepoId).toBe('my-app');
    expect(result!.authoritySource).toBe('manifest-primary');
    expect(result!.declaredRepoRoots).toEqual([realpathSync(repoDir)]);
  });

  it('resolves monolith primary focus area relative path from manifest', async () => {
    const repoDir = makeRepo('my-app');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      primary_focus_area_ids: ['api'],
      focusable_areas: [
        { focus_id: 'web', relative_path: 'apps/web' },
        { focus_id: 'api', relative_path: 'apps/api' },
      ],
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    expect(result!.primaryRepoRoot).toBe(realpathSync(repoDir));
    expect(result!.primaryFocusRelativePath).toBe('apps/api');
    expect(result!.selectedFocusIds).toEqual(['api']);
  });

  it('resolves distributed repo using primary_working_repo_ids', async () => {
    const backendDir = makeRepo('backend');
    const frontendDir = makeRepo('frontend');
    const repoRoot = makePlatformRepo([
      { path: '.' },
      { path: backendDir },
      { path: frontendDir },
    ]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      primary_working_repo_ids: ['backend'],
      repositories: [
        { repo_id: 'frontend', local_paths: [frontendDir] },
        { repo_id: 'backend', local_paths: [backendDir] },
      ],
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    expect(result!.primaryRepoRoot).toBe(realpathSync(backendDir));
    expect(result!.primaryRepoId).toBe('backend');
    expect(result!.selectedRepoIds).toEqual(['backend']);
  });

  it('includes only manifest-declared workspace repos in visibleRepoRoots', async () => {
    const backendDir = makeRepo('backend');
    const frontendDir = makeRepo('frontend');
    const rogueDir = makeRepo('rogue');
    const repoRoot = makePlatformRepo([
      { path: '.' },
      { path: backendDir },
      { path: frontendDir },
      { path: rogueDir },
    ]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      primary_working_repo_ids: ['backend'],
      repositories: [
        { repo_id: 'frontend', local_paths: [frontendDir] },
        { repo_id: 'backend', local_paths: [backendDir] },
      ],
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    // Primary is always first, then only workspace repos declared in the manifest.
    expect(result!.visibleRepoRoots).toContain(realpathSync(backendDir));
    expect(result!.visibleRepoRoots).toContain(realpathSync(frontendDir));
    expect(result!.visibleRepoRoots).not.toContain(realpathSync(rogueDir));
    expect(result!.visibleRepoRoots).toHaveLength(2);
  });

  it('falls back to ranking when no primary_working_repo_ids match', async () => {
    const lowPriority = makeRepo('low');
    const highPriority = makeRepo('high');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        {
          repo_id: 'low',
          local_paths: [lowPriority],
          default_focusable: false,
          activation_priority: 10,
        },
        {
          repo_id: 'high',
          local_paths: [highPriority],
          default_focusable: true,
          activation_priority: 100,
        },
      ],
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    expect(result!.primaryRepoId).toBe('high');
    expect(result!.primaryRepoRoot).toBe(realpathSync(highPriority));
  });

  it('returns undefined when repo path does not exist on disk', async () => {
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'ghost',
        local_paths: ['/nonexistent/path/to/repo'],
      },
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeUndefined();
  });

  it('resolves relative paths against context pack dir', async () => {
    const packDir = path.join(tmpDir, 'pack');
    const repoDir = makeRepo('pack/repos/my-service');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-service',
        local_paths: ['repos/my-service'],
      },
    });

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);
    expect(result).toBeDefined();
    expect(result!.primaryRepoRoot).toBe(realpathSync(repoDir));
  });

  it('resolves Dalton distributed boundary from the active task sidecar selection', async () => {
    const backendDir = makeRepo('backend');
    const frontendDir = makeRepo('frontend');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }, { path: frontendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        { repo_id: 'frontend', local_paths: [frontendDir], repository_type: 'support' },
        { repo_id: 'backend', local_paths: [backendDir], repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: ['backend', 'frontend'],
      selectedFocusIds: [],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.primaryRepoId).toBe('backend');
    expect(result!.visibleRepoRoots).toEqual([
      realpathSync(backendDir),
      realpathSync(frontendDir),
    ]);
    expect(result!.declaredRepoRoots).toEqual(
      expect.arrayContaining([realpathSync(backendDir), realpathSync(frontendDir)]),
    );
    expect(result!.declaredRepoRoots).toHaveLength(2);
    expect(result!.authoritySource).toBe('active-task-sidecar');
    expect(result!.selectedRepoIds).toEqual(['backend', 'frontend']);
  });

  it('resolves Dalton monolith boundary from the selected primary focus area only', async () => {
    const repoDir = makeRepo('my-app');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'web', relative_path: 'apps/web', repository_type: 'support' },
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['web', 'api'],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.primaryRepoId).toBe('my-app');
    expect(result!.primaryFocusId).toBe('api');
    expect(result!.primaryFocusRelativePath).toBe('apps/api');
    expect(result!.selectedFocusIds).toEqual(['web', 'api']);
    expect(result!.authoritySource).toBe('active-task-sidecar');
  });

  it('surfaces a specific error when the selected monolith primary focus is missing relative_path', async () => {
    const repoDir = makeRepo('my-app');
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: '', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
    });

    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot)).rejects.toThrow(
      'Selected primary focus area "api" is missing required relative_path.',
    );
  });

  it('resolves Deep Focus metadata from the active task sidecar using camelCase keys', async () => {
    const backendDir = makeRepo('backend');
    const primaryFile = makeFile(path.join(backendDir, 'src', 'main.ts'));
    const testDir = makeRepo('backend/tests');
    const supportFile = makeFile(path.join(backendDir, 'docs', 'guide.md'));
    makeRepo('backend/src/support');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        { repo_id: 'backend', local_paths: [backendDir], repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/main.ts',
      selectedFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests', kind: 'directory' },
      selectedSupportTargets: [
        { path: 'src', kind: 'directory' },
        { path: 'src/support', kind: 'directory' },
        { path: 'docs/guide.md', kind: 'file' },
      ],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.deepFocusEnabled).toBe(true);
    expect(result!.primaryFocusRelativePath).toBe('src/main.ts');
    expect(result!.primaryFocusTargetKind).toBe('file');
    expect(result!.testTarget).toEqual({
      path: 'tests',
      kind: 'directory',
      resolvedPath: realpathSync(testDir),
    });
    expect(result!.supportTargets).toEqual([
      { path: 'docs/guide.md', kind: 'file', effectiveScope: 'exact-file' },
      { path: 'src', kind: 'directory', effectiveScope: 'directory-minus-primary' },
    ]);
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.primaryFocusRelativePath!))).toBe(primaryFile);
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.supportTargets![0].path))).toBe(supportFile);
  });

  it('reads Deep Focus metadata from workspace sync using snake_case keys', async () => {
    const backendDir = makeRepo('backend');
    const apiDir = makeRepo('backend/apps/api');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [backendDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeWorkspaceSyncState({
      active_context_pack_dir: packDir,
      selected_repo_ids: [],
      selected_focus_ids: ['api'],
      deep_focus_enabled: true,
      selected_focus_path: 'apps/api',
      selected_focus_target_kind: 'directory',
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.authoritySource).toBe('workspace-sync-state');
    expect(result!.deepFocusEnabled).toBe(true);
    expect(result!.primaryFocusRelativePath).toBe('apps/api');
    expect(result!.primaryFocusTargetKind).toBe('directory');
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.primaryFocusRelativePath!))).toBe(realpathSync(apiDir));
  });

  it('accepts repo-root Deep Focus selection without selectedFocusTargetKind', async () => {
    const repoDir = makeRepo('my-app');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: repoDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.deepFocusEnabled).toBe(true);
    expect(result!.primaryFocusRelativePath).toBe('');
    expect(result!.primaryFocusTargetKind).toBeUndefined();
  });

  it('uses selectedFocusPath for monolith Deep Focus file selection when present', async () => {
    const repoDir = makeRepo('my-app');
    const primaryFile = makeFile(path.join(repoDir, 'apps', 'api', 'routes', 'handler.ts'));
    const testDir = makeRepo('my-app/tests/api');
    const supportFile = makeFile(path.join(repoDir, 'shared', 'types.ts'));
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: repoDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'apps/api/routes/handler.ts',
      selectedFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests/api', kind: 'directory' },
      selectedSupportTargets: [{ path: 'shared/types.ts', kind: 'file' }],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.deepFocusEnabled).toBe(true);
    expect(result!.primaryFocusId).toBe('api');
    expect(result!.primaryFocusRelativePath).toBe('apps/api/routes/handler.ts');
    expect(result!.primaryFocusTargetKind).toBe('file');
    expect(result!.testTarget).toEqual({
      path: 'tests/api',
      kind: 'directory',
      resolvedPath: realpathSync(testDir),
    });
    expect(result!.supportTargets).toEqual([
      { path: 'shared/types.ts', kind: 'file', effectiveScope: 'exact-file' },
    ]);
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.primaryFocusRelativePath!))).toBe(primaryFile);
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.supportTargets![0].path))).toBe(supportFile);
  });

  it('falls back to the manifest monolith focus area when Deep Focus path metadata is absent', async () => {
    const repoDir = makeRepo('my-app');
    const apiDir = makeRepo('my-app/apps/api');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: repoDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.deepFocusEnabled).toBe(true);
    expect(result!.primaryFocusRelativePath).toBe('apps/api');
    expect(result!.primaryFocusTargetKind).toBe('directory');
    expect(realpathSync(path.join(result!.primaryRepoRoot, result!.primaryFocusRelativePath!))).toBe(realpathSync(apiDir));
  });

  it('fails closed when monolith Deep Focus path escapes the selected focus area prefix', async () => {
    const repoDir = makeRepo('my-app');
    makeFile(path.join(repoDir, 'apps', 'web', 'page.tsx'));
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: repoDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'apps/web/page.tsx',
      selectedFocusTargetKind: 'file',
    });

    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot)).rejects.toThrow(
      'Primary Deep Focus target "apps/web/page.tsx" must stay within the selected monolith focus area "apps/api".',
    );
  });

  it('fails closed when monolith Deep Focus target kind does not match the selected path', async () => {
    const repoDir = makeRepo('my-app');
    makeRepo('my-app/apps/api/routes');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: repoDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'apps/api/routes',
      selectedFocusTargetKind: 'file',
    });

    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot)).rejects.toThrow(
      'Primary Deep Focus target "apps/api/routes" must resolve to a file.',
    );
  });

  it('preserves legacy selected-primary behavior when deepFocusEnabled is false', async () => {
    const repoDir = makeRepo('my-app');
    makeRepo('my-app/apps/api');
    makeFile(path.join(repoDir, 'tampered.ts'));
    const repoRoot = makePlatformRepo([{ path: '.' }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'monolith',
      repository: {
        repo_id: 'my-app',
        local_paths: [repoDir],
      },
      focusable_areas: [
        { focus_id: 'api', relative_path: 'apps/api', repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: false,
      selectedFocusPath: 'tampered.ts',
      selectedFocusTargetKind: 'file',
      selectedSupportTargets: [{ path: 'tampered.ts', kind: 'file' }],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result).toBeDefined();
    expect(result!.deepFocusEnabled).toBeUndefined();
    expect(result!.primaryFocusRelativePath).toBe('apps/api');
    expect(result!.primaryFocusTargetKind).toBeUndefined();
    expect(result!.testTarget).toBeUndefined();
    expect(result!.supportTargets).toBeUndefined();
  });

  it('fails closed when deep focus metadata is malformed', async () => {
    const backendDir = makeRepo('backend');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        { repo_id: 'backend', local_paths: [backendDir], repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: '../escape',
      selectedFocusTargetKind: 'directory',
    });

    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot)).rejects.toThrow(
      'Primary Deep Focus target "../escape" is invalid: path must not contain ".." traversal segments.',
    );
  });

  it('fails closed with the invalid path value when a Deep Focus path resolves outside the repo root', async () => {
    const backendDir = makeRepo('backend');
    const outsideDir = makeRepo('outside');
    makeFile(path.join(outsideDir, 'escape.ts'));
    symlinkSync(outsideDir, path.join(backendDir, 'linked-outside'));
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        { repo_id: 'backend', local_paths: [backendDir], repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'linked-outside/escape.ts',
      selectedFocusTargetKind: 'file',
    });

    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot)).rejects.toThrow(
      'Primary Deep Focus target "linked-outside/escape.ts" is invalid: resolved path',
    );
  });

  it('surfaces an advisory warning when the test target is an ancestor of the primary target', async () => {
    const backendDir = makeRepo('backend');
    makeFile(path.join(backendDir, 'tests', 'unit', 'handler.test.ts'));
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: backendDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, {
      estate_type: 'distributed-platform',
      repositories: [
        { repo_id: 'backend', local_paths: [backendDir], repository_type: 'primary' },
      ],
    });
    writeActiveContextPackSidecar({
      contextPackDir: packDir,
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'tests/unit/handler.test.ts',
      selectedFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests', kind: 'directory' },
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result?.warnings).toEqual([
      'Deep Focus test target "tests" is an ancestor of the primary target "tests/unit/handler.test.ts" and broadens the writable scope.',
    ]);
  });

  it('collects directory roots for primary, test, and support Deep Focus targets', () => {
    expect(collectFocusedRepoTargetDirectoryRoots({
      primaryRepoRoot: '/repos/backend',
      primaryFocusRelativePath: 'src/handler.ts',
      primaryFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
      supportTargets: [
        { path: 'docs', kind: 'directory', effectiveScope: 'full-directory' },
        { path: 'src/helpers.ts', kind: 'file', effectiveScope: 'exact-file' },
      ],
    })).toEqual([
      '/repos/backend/src',
      '/repos/backend/tests',
      '/repos/backend/docs',
    ]);
  });
});

describe('resolveWorkspaceRepoRoots', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'workspace-roots-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when workspace file is missing', async () => {
    const result = await resolveWorkspaceRepoRoots(tmpDir);
    expect(result).toEqual([]);
  });

  it('excludes the platform repo dot entry', async () => {
    const externalRepo = path.join(tmpDir, 'external');
    mkdirSync(externalRepo, { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'tasksail.code-workspace'),
      JSON.stringify({
        folders: [{ path: '.' }, { path: externalRepo }],
      }),
    );

    const result = await resolveWorkspaceRepoRoots(tmpDir);
    expect(result).toEqual([realpathSync(externalRepo)]);
  });

  it('skips folders that do not exist on disk', async () => {
    writeFileSync(
      path.join(tmpDir, 'tasksail.code-workspace'),
      JSON.stringify({
        folders: [{ path: '.' }, { path: '/nonexistent/repo' }],
      }),
    );

    const result = await resolveWorkspaceRepoRoots(tmpDir);
    expect(result).toEqual([]);
  });

  it('canonicalizes and deduplicates equivalent existing paths', async () => {
    const externalRepo = path.join(tmpDir, 'external');
    mkdirSync(externalRepo, { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'tasksail.code-workspace'),
      JSON.stringify({
        folders: [
          { path: '.' },
          { path: externalRepo },
          { path: path.join(tmpDir, '.', 'external') },
        ],
      }),
    );

    const result = await resolveWorkspaceRepoRoots(tmpDir);
    expect(result).toEqual([realpathSync(externalRepo)]);
  });
});
