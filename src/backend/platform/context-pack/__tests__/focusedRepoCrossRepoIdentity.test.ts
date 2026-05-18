import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { resolveSelectedPrimaryRepoRoot } from '../focusedRepo.js';

describe('resolveSelectedPrimaryRepoRoot cross-repo Deep Focus identity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'focused-repo-cross-repo-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRepo(name: string): string {
    const repoDir = path.join(tmpDir, name);
    mkdirSync(repoDir, { recursive: true });
    return realpathSync(repoDir);
  }

  function makePlatformRepo(workspaceFolders: Array<{ path: string }>): string {
    const repoRoot = makeRepo('platform');
    writeFileSync(
      path.join(repoRoot, 'tasksail.code-workspace'),
      JSON.stringify({ folders: workspaceFolders }, null, 2),
    );
    return repoRoot;
  }

  function writeManifest(contextPackDir: string, repositories: object[]): void {
    const manifestDir = path.join(contextPackDir, 'qmd');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      path.join(manifestDir, 'repo-sources.json'),
      JSON.stringify({
        manifest_version: 'qmd-repo-sources/v2',
        manifest_status: 'approved',
        estate_type: 'distributed-platform',
        context_pack_id: 'pack',
        qmd_scope_root: 'qmd/context-packs/pack',
        primary_working_repo_ids: [],
        primary_focus_area_ids: [],
        repositories,
      }, null, 2),
    );
  }

  function writeWorkspaceSyncState(binding: object): void {
    const stateDir = path.join(tmpDir, 'platform', '.platform-state');
    mkdirSync(stateDir, { recursive: true });
    const candidate = binding as Record<string, unknown>;
    writeFileSync(
      path.join(stateDir, 'workspace-context-sync.json'),
      JSON.stringify({
        active_context_pack_dir: candidate.contextPackDir,
        active_context_pack_id: candidate.contextPackId,
        scope_mode: candidate.scopeMode,
        selected_repo_ids: candidate.selectedRepoIds ?? [],
        selected_focus_ids: candidate.selectedFocusIds ?? [],
        deep_focus_enabled: candidate.deepFocusEnabled,
        deep_focus_primary_repo_id: candidate.deepFocusPrimaryRepoId,
        selected_focus_path: candidate.selectedFocusPath,
        selected_focus_target_kind: candidate.selectedFocusTargetKind,
        selected_focus_targets: candidate.selectedFocusTargets,
        selected_test_target: candidate.selectedTestTarget,
        selected_support_targets: candidate.selectedSupportTargets,
      }, null, 2),
    );
  }

  function setupDistributedPack(): {
    packDir: string;
    platformDir: string;
    repoRoot: string;
    toolsDir: string;
  } {
    const platformDir = makeRepo('platform-app');
    const toolsDir = makeRepo('tools-app');
    const repoRoot = makePlatformRepo([{ path: '.' }, { path: platformDir }, { path: toolsDir }]);
    const packDir = path.join(tmpDir, 'pack');
    writeManifest(packDir, [
      { repo_id: 'platform', local_paths: [platformDir], repository_type: 'primary' },
      { repo_id: 'tools', local_paths: [toolsDir], repository_type: 'support' },
    ]);
    return { packDir, platformDir, repoRoot, toolsDir };
  }

  it('allows cross-repo scoped support on a repo-root primary when identity is explicit', async () => {
    const { packDir, platformDir, repoRoot, toolsDir } = setupDistributedPack();
    makeRepo('tools-app/Acme.Cli');
    writeWorkspaceSyncState({
      contextPackDir: packDir,
      contextPackId: 'pack',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: platformDir,
        repoId: 'platform',
        supportTargets: [{
          path: 'Acme.Cli',
          kind: 'directory',
          repoLocalPath: toolsDir,
          repoId: 'tools',
        }],
      }],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result?.primaryFocusTargets?.[0]?.supportTargets).toEqual([{
      path: 'Acme.Cli',
      kind: 'directory',
      repoLocalPath: toolsDir,
      repoId: 'tools',
    }]);
    expect(result?.readonlyContextRoots).toContainEqual({
      path: 'Acme.Cli',
      kind: 'directory',
      repoLocalPath: toolsDir,
      reason: 'scoped-support-target',
      sourceTargets: [
        expect.objectContaining({
          path: '',
          kind: 'directory',
          repoLocalPath: platformDir,
          repoId: 'platform',
        }),
      ],
    });
  });

  it('allows cross-repo scoped test on a repo-root primary when identity is explicit', async () => {
    const { packDir, platformDir, repoRoot, toolsDir } = setupDistributedPack();
    const toolsTestsDir = makeRepo('tools-app/Acme.Cli.Tests');
    writeWorkspaceSyncState({
      contextPackDir: packDir,
      contextPackId: 'pack',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: platformDir,
        repoId: 'platform',
        testTarget: {
          path: 'Acme.Cli.Tests',
          kind: 'directory',
          repoLocalPath: toolsDir,
          repoId: 'tools',
        },
      }],
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result?.primaryFocusTargets?.[0]?.testTarget).toEqual({
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      repoLocalPath: toolsDir,
      repoId: 'tools',
    });
    expect(result?.writableRoots).toContainEqual({
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      repoLocalPath: toolsDir,
      reason: 'scoped-test-target',
      sourceTargets: [
        expect.objectContaining({
          path: '',
          kind: 'directory',
          repoLocalPath: platformDir,
          repoId: 'platform',
        }),
      ],
    });
    expect(realpathSync(path.join(toolsDir, result!.primaryFocusTargets![0]!.testTarget!.path))).toBe(toolsTestsDir);
  });

  it('resolves cross-repo global test targets against their own repo identity', async () => {
    const { packDir, platformDir, repoRoot, toolsDir } = setupDistributedPack();
    const toolsTestsDir = makeRepo('tools-app/Acme.Cli.Tests');
    writeWorkspaceSyncState({
      contextPackDir: packDir,
      contextPackId: 'pack',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: platformDir,
        repoId: 'platform',
      }],
      selectedTestTarget: {
        path: 'Acme.Cli.Tests',
        kind: 'directory',
        repoLocalPath: toolsDir,
        repoId: 'tools',
      },
    });

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot);

    expect(result?.testTarget).toEqual({
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      resolvedPath: toolsTestsDir,
      repoLocalPath: toolsDir,
      repoId: 'tools',
    });
    expect(result?.writableRoots).toContainEqual({
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      repoLocalPath: toolsDir,
      reason: 'test-target',
    });
  });
});
