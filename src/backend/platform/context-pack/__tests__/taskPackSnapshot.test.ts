import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } from '../focusedRepo.js';

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

  function writeSnapshot(primaryRoot: string, supportRoot: string): void {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'pack-snapshot.json'), JSON.stringify({
      schemaVersion: 2,
      stagedAt: '2026-05-06T00:00:00.000Z',
      taskId: 'task-1',
      contextPackDir: packDir,
      contextPackId: 'orders',
      estateType: 'distributed-platform',
      primary: {
        repoId: 'platform',
        focusId: null,
        repoRoot: primaryRoot,
        primaryFocusRelativePath: null,
      },
      support: [{ repoId: 'tools', repoRoot: supportRoot }],
      focusAreas: [],
      selectedFocusIds: [],
      qmdScopeRoot: 'qmd/context-packs/orders',
      estateRepoIds: ['platform', 'tools'],
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
    }, null, 2));
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

  it('throws re-activate guidance when a task-scoped snapshot is missing', async () => {
    await expect(resolveSelectedPrimaryRepoRoot(packDir, repoRoot, { taskId: 'task-1' }))
      .rejects.toThrow('Re-activate or re-create the task');
  });
});
