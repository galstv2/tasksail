import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthoritativeSelection, toPrimaryFocusTarget } from '../authoritativeSelectionReader.js';

describe('authoritativeSelectionReader', () => {
  let tmpDir: string;
  let platformRoot: string;
  let packDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'authoritative-selection-reader-'));
    platformRoot = path.join(tmpDir, 'platform');
    packDir = path.join(platformRoot, 'contextpacks', 'pack');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRepo(name: string): string {
    const repoDir = path.join(tmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function writeManifest(manifest: object): void {
    writeFileSync(
      path.join(packDir, 'qmd', 'repo-sources.json'),
      JSON.stringify(manifest, null, 2),
    );
  }

  function writeWorkspaceSyncState(selection: object): void {
    const stateDir = path.join(platformRoot, '.platform-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, 'workspace-context-sync.json'),
      JSON.stringify({
        active_context_pack_dir: packDir,
        selected_repo_ids: [],
        selected_focus_ids: [],
        ...selection,
      }, null, 2),
    );
  }

  function writeStaleQueueSelection(selection: object): void {
    const queueDir = path.join(platformRoot, '.platform-state', 'queue');
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(
      path.join(queueDir, ['active', 'context', 'pack'].join('-') + '.json'),
      JSON.stringify(selection, null, 2),
    );
  }

  it('hydrates distributed legacy primary through manifest repo_id', async () => {
    const toolsRepo = makeRepo('tools');
    writeManifest({
      estate_type: 'distributed-platform',
      repositories: [
        {
          repo_id: 'tools',
          repository_type: 'primary',
          local_paths: [toolsRepo],
        },
      ],
    });
    writeWorkspaceSyncState({
      selected_repo_ids: ['tools'],
      deep_focus_enabled: true,
      deep_focus_primary_repo_id: 'tools',
      deep_focus_primary_focus_id: null,
      selected_focus_targets: [
        { path: 'src', kind: 'directory', role: 'anchor' },
      ],
    });

    const selection = await resolveAuthoritativeSelection(packDir, platformRoot);

    expect(selection?.selectedFocusTargets).toEqual([
      {
        path: 'src',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: toolsRepo,
        repoId: 'tools',
      },
    ]);
  });

  it('hydrates monolith legacy primary through manifest focus_id', async () => {
    const monolithRepo = makeRepo('monolith');
    writeManifest({
      estate_type: 'monolith-platform',
      repository: {
        repo_id: 'monolith',
        local_paths: [monolithRepo],
      },
      focusable_areas: [
        {
          focus_id: 'api',
          relative_path: 'src/api',
          repository_type: 'primary',
        },
      ],
    });
    writeWorkspaceSyncState({
      selected_focus_ids: ['api'],
      deep_focus_enabled: true,
      deep_focus_primary_repo_id: null,
      deep_focus_primary_focus_id: 'api',
      selected_focus_targets: [
        { path: 'src/api', kind: 'directory', role: 'anchor' },
      ],
    });

    const selection = await resolveAuthoritativeSelection(packDir, platformRoot);

    expect(selection?.selectedFocusTargets).toEqual([
      {
        path: 'src/api',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: monolithRepo,
        focusId: 'api',
      },
    ]);
  });

  it('discards malformed legacy primary when scalar cannot resolve', async () => {
    const toolsRepo = makeRepo('tools');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeManifest({
      estate_type: 'distributed-platform',
      repositories: [
        {
          repo_id: 'tools',
          repository_type: 'primary',
          local_paths: [toolsRepo],
        },
      ],
    });
    writeWorkspaceSyncState({
      selected_repo_ids: ['missing'],
      deep_focus_enabled: true,
      deep_focus_primary_repo_id: 'missing',
      deep_focus_primary_focus_id: null,
      selected_focus_targets: [
        { path: 'src', kind: 'directory', role: 'anchor' },
      ],
    });

    const selection = await resolveAuthoritativeSelection(packDir, platformRoot);

    expect(selection?.selectedFocusTargets).toEqual([]);
    expect(selection?.deepFocusPrimaryRepoId).toBeNull();
    expect(selection?.deepFocusPrimaryFocusId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[deep-focus] discarded malformed legacy primaries:',
      'could not resolve primary scalar through manifest.',
    );
  });

  it('uses workspace sync when stale queue selection state conflicts without a task id', async () => {
    writeWorkspaceSyncState({
      selected_repo_ids: ['workspace-repo'],
      selected_focus_ids: ['workspace-focus'],
    });
    writeStaleQueueSelection({
      contextPackDir: packDir,
      contextPackId: 'stale',
      selectedRepoIds: ['stale-repo'],
      selectedFocusIds: ['stale-focus'],
    });

    const selection = await resolveAuthoritativeSelection(packDir, platformRoot);

    expect(selection?.selectedRepoIds).toEqual(['workspace-repo']);
    expect(selection?.selectedFocusIds).toEqual(['workspace-focus']);
    expect(selection?.source).toBe('workspace-sync-state');
  });

  it('hydrates per-primary testTarget and supportTargets from snake_case keys', () => {
    // Simulates Python writer: workspace-context-sync.json uses snake_case for
    // per-primary scoped fields. The reader must accept them, mirroring the
    // existing snake_case fallback for repoLocalPath / repoId / focusId.
    const candidate = {
      path: 'src/api',
      kind: 'directory',
      repo_local_path: '/tmp/repo-1',
      repo_id: 'repo-1',
      test_target: { path: 'tests/api', kind: 'directory' },
      support_targets: [{ path: 'libs/api-shared', kind: 'directory' }],
    };

    const result = toPrimaryFocusTarget(candidate);

    expect(result).toBeDefined();
    expect(result?.testTarget).toEqual({ path: 'tests/api', kind: 'directory' });
    expect(result?.supportTargets).toEqual([{ path: 'libs/api-shared', kind: 'directory' }]);
    expect(result?.repoLocalPath).toBe('/tmp/repo-1');
  });
});
