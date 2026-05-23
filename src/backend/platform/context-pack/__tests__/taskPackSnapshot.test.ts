import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } from '../focusedRepo.js';
import type { TaskPackSnapshot } from '../taskPackSnapshot.js';

describe('snapshot-backed focused repo resolution', () => {
  let tmpDir: string;
  let repoRoot: string;
  let packDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'task-pack-snapshot-test-'));
    repoRoot = path.join(tmpDir, 'platform');
    packDir = path.join(tmpDir, 'pack');
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSnapshotFile(snapshot: TaskPackSnapshot): void {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', snapshot.taskId, 'pack-snapshot.json'),
      JSON.stringify(snapshot, null, 2),
    );
  }

  function baseSnapshot(overrides: Partial<TaskPackSnapshot> = {}): TaskPackSnapshot {
    const defaultPrimaryRoot = path.join(tmpDir, 'default-platform');
    const defaultSupportRoot = path.join(tmpDir, 'default-tools');
    return {
      schemaVersion: 2,
      stagedAt: '2026-05-06T00:00:00.000Z',
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      estateType: 'distributed-platform',
      primary: {
        repoId: 'platform',
        focusId: null,
        repoRoot: defaultPrimaryRoot,
        primaryFocusRelativePath: null,
      },
      support: [{ repoId: 'tools', repoRoot: defaultSupportRoot }],
      focusAreas: [],
      selectedFocusIds: [],
      qmdScopeRoot: 'qmd/context-packs/orders',
      estateRepoIds: ['platform', 'tools'],
      declaredRepoRoots: [defaultPrimaryRoot, defaultSupportRoot],
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
      ...overrides,
    };
  }

  function writeSnapshot(primaryRoot: string, supportRoot: string): void {
    writeSnapshotFile(baseSnapshot({
      primary: {
        repoId: 'platform',
        focusId: null,
        repoRoot: primaryRoot,
        primaryFocusRelativePath: null,
      },
      support: [{ repoId: 'tools', repoRoot: supportRoot }],
      estateRepoIds: ['platform', 'tools'],
      declaredRepoRoots: [primaryRoot, supportRoot],
    }));
  }

  it('resolves selected primary from pack-snapshot.json instead of the live manifest', async () => {
    const primaryRoot = path.join(tmpDir, 'original-platform');
    const supportRoot = path.join(tmpDir, 'original-tools');
    mkdirSync(primaryRoot, { recursive: true });
    mkdirSync(supportRoot, { recursive: true });
    writeSnapshot(primaryRoot, supportRoot);

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot, { taskId: 'task-1' });

    expect(result).toMatchObject({
      primaryRepoRoot: primaryRoot,
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      authoritySource: 'active-task-sidecar',
    });
  });

  it('resolves focused visibility from snapshot support roots', async () => {
    const primaryRoot = path.join(tmpDir, 'original-platform');
    const supportRoot = path.join(tmpDir, 'original-tools');
    mkdirSync(primaryRoot, { recursive: true });
    mkdirSync(supportRoot, { recursive: true });
    writeSnapshot(primaryRoot, supportRoot);

    const result = await resolveFocusedRepoRoot(packDir, repoRoot, { taskId: 'task-1' });

    expect(result?.visibleRepoRoots).toEqual([primaryRoot, supportRoot]);
    expect(result?.declaredRepoRoots).toEqual([primaryRoot, supportRoot]);
  });

  it('includes writable-root-only secondary standard primary repo roots in snapshot visibility', async () => {
    const platformRoot = path.join(tmpDir, 'original-platform');
    const toolsRoot = path.join(tmpDir, 'original-tools');
    const unrelatedRoot = path.join(tmpDir, 'unrelated');
    mkdirSync(platformRoot, { recursive: true });
    mkdirSync(toolsRoot, { recursive: true });
    mkdirSync(unrelatedRoot, { recursive: true });
    writeSnapshotFile(baseSnapshot({
      primary: {
        repoId: 'platform',
        focusId: null,
        repoRoot: platformRoot,
        primaryFocusRelativePath: null,
      },
      support: [],
      estateRepoIds: ['platform', 'tools', 'unrelated'],
      declaredRepoRoots: [platformRoot, toolsRoot, unrelatedRoot],
      deepFocus: {
        enabled: false,
        primaryFocusTargetKind: null,
        primaryFocusTargets: [],
        selectedTestTarget: null,
        supportTargets: [],
        writableRoots: [
          { repoLocalPath: platformRoot, path: '', kind: 'directory', reason: 'selected-primary' },
          { repoLocalPath: toolsRoot, path: '', kind: 'directory', reason: 'selected-primary' },
        ],
        readonlyContextRoots: [],
        warnings: [],
      },
    }));

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot, { taskId: 'task-1' });

    expect(result?.visibleRepoRoots).toEqual([platformRoot, toolsRoot]);
    expect(result?.visibleRepoRoots).not.toContain(unrelatedRoot);
    expect(result?.declaredRepoRoots).toEqual([platformRoot, toolsRoot, unrelatedRoot]);
    expect(result?.selectedRepoIds).toEqual(['platform']);
    expect(result?.selectedRepoIds).not.toContain('tools');
  });

  it('keeps monolith standard multi-primary visibility collapsed while preserving writable root authority', async () => {
    const monolithRoot = path.join(tmpDir, 'monolith');
    mkdirSync(monolithRoot, { recursive: true });
    writeSnapshotFile(baseSnapshot({
      contextPackId: 'mono',
      estateType: 'monolith',
      primary: {
        repoId: null,
        focusId: 'api',
        repoRoot: monolithRoot,
        primaryFocusRelativePath: 'apps/api',
      },
      support: [],
      focusAreas: [
        { focusId: 'api', relativePath: 'apps/api', isPrimary: true },
        { focusId: 'worker', relativePath: 'apps/worker', isPrimary: true },
      ],
      selectedFocusIds: ['api', 'worker'],
      estateRepoIds: ['mono'],
      declaredRepoRoots: [monolithRoot],
      deepFocus: {
        enabled: false,
        primaryFocusTargetKind: null,
        primaryFocusTargets: [
          { repoLocalPath: monolithRoot, focusId: 'api', path: 'apps/api', kind: 'directory', role: 'anchor' },
          { repoLocalPath: monolithRoot, focusId: 'worker', path: 'apps/worker', kind: 'directory', role: 'primary' },
        ],
        selectedTestTarget: null,
        supportTargets: [],
        writableRoots: [
          { repoLocalPath: monolithRoot, path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
          { repoLocalPath: monolithRoot, path: 'apps/worker', kind: 'directory', reason: 'selected-primary' },
        ],
        readonlyContextRoots: [
          { repoLocalPath: monolithRoot, path: 'docs', kind: 'directory', reason: 'support-target' },
        ],
        warnings: [],
      },
    }));

    const result = await resolveSelectedPrimaryRepoRoot(packDir, repoRoot, { taskId: 'task-1' });

    expect(result?.visibleRepoRoots).toEqual([monolithRoot]);
    expect(result?.writableRoots).toEqual([
      { repoLocalPath: monolithRoot, path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
      { repoLocalPath: monolithRoot, path: 'apps/worker', kind: 'directory', reason: 'selected-primary' },
    ]);
  });

  it('throws re-activate guidance when a task-scoped snapshot is missing', async () => {
    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot, { taskId: 'task-1' }))
      .rejects.toThrow('Re-activate or re-create the task');
  });
});
