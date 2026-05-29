import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSelectedPrimaryRepoRoot } from '../../context-pack/focusedRepo.js';
import { DaltonConfinementError, validateDaltonBoundaryChanges } from '../confinement.js';

describe('Dalton confinement standard repositoryTypes writable roots', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'confinement-repository-types-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('permits writes in every standard primary writable root', async () => {
    const tasksailRoot = path.join(root, 'tasksail');
    const platformRepoRoot = path.join(root, 'platform');
    const toolsRepoRoot = path.join(root, 'tools');
    const packDir = path.join(root, 'pack');
    const taskId = 'task-1';
    mkdirSync(path.join(tasksailRoot, 'AgentWorkSpace', 'tasks', taskId), { recursive: true });
    mkdirSync(platformRepoRoot, { recursive: true });
    mkdirSync(toolsRepoRoot, { recursive: true });
    writeFileSync(path.join(tasksailRoot, 'AgentWorkSpace', 'tasks', taskId, 'pack-snapshot.json'), JSON.stringify({
      schemaVersion: 2,
      stagedAt: '2026-05-22T00:00:00.000Z',
      taskId,
      contextPackDir: packDir,
      contextPackId: 'orders',
      estateType: 'distributed-platform',
      primary: {
        repoId: 'platform',
        focusId: null,
        repoRoot: platformRepoRoot,
        primaryFocusRelativePath: null,
      },
      support: [],
      focusAreas: [],
      selectedFocusIds: [],
      qmdScopeRoot: 'qmd/context-packs/orders',
      estateRepoIds: ['platform', 'tools'],
      declaredRepoRoots: [platformRepoRoot, toolsRepoRoot],
      deepFocus: {
        enabled: false,
        primaryFocusTargetKind: null,
        primaryFocusTargets: [],
        selectedTestTarget: null,
        supportTargets: [],
        writableRoots: [
          { repoLocalPath: platformRepoRoot, path: '', kind: 'directory', reason: 'selected-primary' },
          { repoLocalPath: toolsRepoRoot, path: '', kind: 'directory', reason: 'selected-primary' },
        ],
        readonlyContextRoots: [],
        warnings: [],
      },
    }, null, 2));

    const focused = await resolveSelectedPrimaryRepoRoot(packDir, tasksailRoot, { taskId });
    expect(focused?.visibleRepoRoots).toEqual([platformRepoRoot, toolsRepoRoot]);

    await expect(validateDaltonBoundaryChanges({
      platformRepoRoot: tasksailRoot,
      focused: focused!,
      before: { byRepoRoot: { [platformRepoRoot]: [], [toolsRepoRoot]: [] } },
      after: { byRepoRoot: { [platformRepoRoot]: ['src/a.ts'], [toolsRepoRoot]: ['src/b.ts'] } },
    })).resolves.toBeUndefined();
  });

  it('rejects standard support worktree writes outside selected primary writable roots', async () => {
    const tasksailRoot = path.join(root, 'tasksail');
    const platformRepoRoot = path.join(root, 'platform');
    const toolsRepoRoot = path.join(root, 'tools');

    mkdirSync(platformRepoRoot, { recursive: true });
    mkdirSync(toolsRepoRoot, { recursive: true });
    writeFileSync(path.join(toolsRepoRoot, 'support.ts'), 'changed');

    await expect(validateDaltonBoundaryChanges({
      platformRepoRoot: tasksailRoot,
      focused: {
        primaryRepoRoot: platformRepoRoot,
        visibleRepoRoots: [platformRepoRoot, toolsRepoRoot],
        declaredRepoRoots: [platformRepoRoot, toolsRepoRoot],
        estateType: 'distributed-platform',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        writableRoots: [
          { repoLocalPath: platformRepoRoot, path: '', kind: 'directory', reason: 'selected-primary' },
        ],
        readonlyContextRoots: [
          { repoLocalPath: toolsRepoRoot, path: '', kind: 'directory', reason: 'support-target' },
        ],
        authoritySource: 'active-task-sidecar',
      },
      before: { byRepoRoot: { [platformRepoRoot]: [], [toolsRepoRoot]: [] } },
      after: { byRepoRoot: { [platformRepoRoot]: ['src/a.ts'], [toolsRepoRoot]: ['support.ts'] } },
    })).rejects.toThrow(DaltonConfinementError);
  });
});
