import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as contextPack from '../index.js';
import { resolveFocusedRepoRoot } from '../focusedRepo.js';

describe('workspace-file-free focused repo resolution', () => {
  let tmpDir: string;
  let repoRoot: string;
  let packDir: string;
  let primaryRoot: string;
  let supportRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'focused-repo-workspace-removal-'));
    repoRoot = path.join(tmpDir, 'platform');
    packDir = path.join(tmpDir, 'pack');
    primaryRoot = path.join(tmpDir, 'orders-api');
    supportRoot = path.join(tmpDir, 'orders-web');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1'), { recursive: true });
    mkdirSync(primaryRoot, { recursive: true });
    mkdirSync(supportRoot, { recursive: true });
    primaryRoot = realpathSync(primaryRoot);
    supportRoot = realpathSync(supportRoot);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeManifest(): void {
    writeFileSync(
      path.join(packDir, 'qmd', 'repo-sources.json'),
      JSON.stringify({
        manifest_version: 'qmd-repo-sources/v2',
        manifest_status: 'approved',
        context_pack_id: 'orders',
        estate_type: 'distributed-platform',
        qmd_scope_root: 'qmd/context-packs/orders',
        primary_working_repo_ids: ['orders-api'],
        primary_focus_area_ids: [],
        repositories: [
          {
            repo_id: 'orders-api',
            repo_name: 'Orders API',
            local_paths: [{ host: primaryRoot, container: null }],
            system_layer: 'backend',
            repository_type: 'primary',
          },
          {
            repo_id: 'orders-web',
            repo_name: 'Orders Web',
            local_paths: [{ host: supportRoot, container: null }],
            system_layer: 'frontend',
            repository_type: 'support',
          },
        ],
      }, null, 2),
    );
  }

  function writeSnapshot(): void {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'pack-snapshot.json'),
      JSON.stringify({
        schemaVersion: 2,
        stagedAt: '2026-05-06T00:00:00.000Z',
        taskId: 'task-1',
        contextPackDir: packDir,
        contextPackId: 'orders',
        estateType: 'distributed-platform',
        primary: {
          repoId: 'orders-api',
          focusId: null,
          repoRoot: primaryRoot,
          primaryFocusRelativePath: null,
        },
        support: [{ repoId: 'orders-web', repoRoot: supportRoot }],
        focusAreas: [],
        selectedFocusIds: [],
        qmdScopeRoot: 'qmd/context-packs/orders',
        estateRepoIds: ['orders-api', 'orders-web'],
        declaredRepoRoots: [primaryRoot, supportRoot],
        deepFocus: {
          enabled: false,
          primaryFocusTargetKind: null,
          primaryFocusTargets: [],
          selectedTestTarget: null,
          supportTargets: [],
          writableRoots: [],
          readonlyContextRoots: [],
          warnings: [],
        },
      }, null, 2),
    );
  }

  it('ignores extra tasksail.code-workspace folders for no-task callers', async () => {
    writeManifest();
    writeFileSync(
      path.join(repoRoot, 'tasksail.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }, { path: supportRoot }] }),
    );

    const result = await resolveFocusedRepoRoot(packDir, repoRoot);

    expect(result?.primaryRepoRoot).toBe(primaryRoot);
    expect(result?.visibleRepoRoots).toEqual([primaryRoot]);
    expect(result?.declaredRepoRoots).toEqual([primaryRoot, supportRoot]);
  });

  it('keeps task-scoped snapshot visibility for support repos', async () => {
    writeManifest();
    writeSnapshot();

    const result = await resolveFocusedRepoRoot(packDir, repoRoot, { taskId: 'task-1' });

    expect(result?.visibleRepoRoots).toEqual([primaryRoot, supportRoot]);
    expect(result?.authoritySource).toBe('active-task-sidecar');
  });

  it('does not export resolveWorkspaceRepoRoots from the public module', () => {
    expect('resolveWorkspaceRepoRoots' in contextPack).toBe(false);
  });
});
