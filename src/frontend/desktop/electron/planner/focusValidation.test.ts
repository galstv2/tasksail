// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import type { PlannerFocusSnapshot } from '../../src/shared/desktopContract';
import { validateChildTaskFocusSnapshot } from './focusValidation';

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'planner-focus-validation-'));
  const contextPackDir = join(repoRoot, 'context-pack');
  const primaryRepoRoot = join(repoRoot, 'repo');
  await Promise.all([
    mkdir(join(contextPackDir, 'qmd'), { recursive: true }),
    mkdir(join(primaryRepoRoot, 'src', 'planner'), { recursive: true }),
    mkdir(join(primaryRepoRoot, 'src', 'support'), { recursive: true }),
    mkdir(join(primaryRepoRoot, 'tests'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(primaryRepoRoot, 'tests', 'planner.test.ts'), ''),
    writeFile(join(primaryRepoRoot, 'tests', 'scoped.test.ts'), ''),
    writeFile(join(primaryRepoRoot, 'src', 'support', 'helper.ts'), ''),
    writeFile(join(contextPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      estate_type: 'monolith-platform',
      context_pack_id: 'context-pack',
      qmd_scope_root: 'qmd/context-packs/context-pack',
      primary_working_repo_ids: ['platform'],
      primary_focus_area_ids: ['planner'],
      repository: { repo_id: 'platform', local_paths: [primaryRepoRoot] },
      repositories: [{ repo_id: 'support', local_paths: [primaryRepoRoot] }],
      focusable_areas: [{ focus_id: 'planner', relative_path: 'src/planner' }],
    })),
  ]);
  return { repoRoot, contextPackDir, primaryRepoRoot };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function createSnapshot(fixture: Fixture, overrides: Partial<PlannerFocusSnapshot> = {}): PlannerFocusSnapshot {
  const base: PlannerFocusSnapshot = {
    version: 1,
    contextPackDir: fixture.contextPackDir,
    contextPackId: 'context-pack',
    title: 'Parent task',
    primaryRepoId: 'platform',
    primaryRepoRoot: fixture.primaryRepoRoot,
    primaryFocusRelativePath: 'src/planner',
    primaryFocusTargetKind: 'directory',
    primaryFocusTargets: [{ path: 'src/planner', kind: 'directory', repoId: 'platform', focusId: 'planner', role: 'anchor' }],
    selectedTestTarget: { path: 'tests/planner.test.ts', kind: 'file' },
    supportTargets: [],
    deepFocusEnabled: true,
    contextPackBinding: {
      contextPackDir: fixture.contextPackDir,
      contextPackId: 'context-pack',
      scopeMode: 'selected',
      selectedRepoIds: ['platform'],
      selectedFocusIds: ['planner'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/planner',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{ path: 'src/planner', kind: 'directory', repoId: 'platform', focusId: 'planner', role: 'anchor' }],
      selectedTestTarget: { path: 'tests/planner.test.ts', kind: 'file' },
      selectedSupportTargets: [],
    },
  };
  return { ...base, ...overrides };
}

async function runValidation(fixture: Fixture, snapshot: PlannerFocusSnapshot) {
  return validateChildTaskFocusSnapshot({
    repoRoot: fixture.repoRoot,
    contextPackDir: fixture.contextPackDir,
    snapshot,
  });
}

function codes(issues: Awaited<ReturnType<typeof runValidation>>): string[] {
  return issues.map((issue) => issue.code);
}

describe('validateChildTaskFocusSnapshot', () => {
  it('returns no issues when context pack, repo, focus paths, targets, repo IDs, and focus IDs still exist', async () => {
    const fixture = await createFixture();
    await expect(runValidation(fixture, createSnapshot(fixture))).resolves.toEqual([]);
  });

  it('returns context-pack-missing when the selected context pack directory is missing', async () => {
    const fixture = await createFixture();
    await rm(fixture.contextPackDir, { recursive: true, force: true });
    expect(codes(await runValidation(fixture, createSnapshot(fixture)))).toEqual(
      expect.arrayContaining(['context-pack-missing']),
    );
  });

  it('returns context-pack-mismatch when snapshot context pack differs from selected context pack', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      contextPackDir: join(fixture.repoRoot, 'old-context-pack'),
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['context-pack-mismatch']),
    );
  });

  it('returns context-pack-binding-mismatch when snapshot binding context pack differs from selected context pack', async () => {
    const fixture = await createFixture();
    const baseline = createSnapshot(fixture);
    const snapshot = createSnapshot(fixture, {
      contextPackBinding: {
        ...baseline.contextPackBinding,
        contextPackDir: join(fixture.repoRoot, 'old-context-pack'),
      },
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['context-pack-binding-mismatch']),
    );
  });

  it('returns context-pack-binding-mismatch when top-level focus fields drift from binding focus fields', async () => {
    const fixture = await createFixture();
    const baseline = createSnapshot(fixture);
    const snapshot = createSnapshot(fixture, {
      primaryFocusRelativePath: 'src/planner',
      contextPackBinding: {
        ...baseline.contextPackBinding,
        selectedFocusPath: 'src/elsewhere',
      },
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['context-pack-binding-mismatch']),
    );
  });

  it('returns primary-repo-missing when the primary repo root does not exist', async () => {
    const fixture = await createFixture();
    await rm(fixture.primaryRepoRoot, { recursive: true, force: true });
    expect(codes(await runValidation(fixture, createSnapshot(fixture)))).toEqual(
      expect.arrayContaining(['primary-repo-missing']),
    );
  });

  it('returns primary-focus-path-missing when the primary focus path is missing', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, { primaryFocusRelativePath: 'src/missing' });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['primary-focus-path-missing']),
    );
  });

  it('returns primary-focus-target-missing when a primary focus target path does not exist', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      primaryFocusTargets: [{ path: 'src/missing', kind: 'directory' }],
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['primary-focus-target-missing']),
    );
  });

  it('validates a primary focus target against target.repoLocalPath when present', async () => {
    const fixture = await createFixture();
    // The platform repo root only has src/planner; src/feature does not exist there.
    // But a sibling repo at fixture.repoRoot/sibling has src/feature.
    const siblingRoot = join(fixture.repoRoot, 'sibling');
    await mkdir(join(siblingRoot, 'src', 'feature'), { recursive: true });
    const snapshot = createSnapshot(fixture, {
      primaryFocusTargets: [{ path: 'src/feature', kind: 'directory', repoLocalPath: siblingRoot }],
    });
    // Should pass: target.path resolves under target.repoLocalPath, not snapshot.primaryRepoRoot.
    const issues = await runValidation(fixture, snapshot);
    expect(codes(issues)).not.toContain('primary-focus-target-missing');
  });

  it('returns selected-test-target-missing when the selected test target file does not exist', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      selectedTestTarget: { path: 'tests/missing.test.ts', kind: 'file' },
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['selected-test-target-missing']),
    );
  });

  it('returns support-target-missing when a support target file does not exist', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      supportTargets: [{ path: 'src/support/missing.ts', kind: 'file', effectiveScope: 'exact-file' }],
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['support-target-missing']),
    );
  });

  it('returns scoped-test-target-missing when a primary focus target test path does not exist', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      primaryFocusTargets: [{
        path: 'src/planner',
        kind: 'directory',
        repoId: 'platform',
        focusId: 'planner',
        role: 'anchor',
        testTarget: { path: 'tests/missing-scoped.test.ts', kind: 'file' },
      }],
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['scoped-test-target-missing']),
    );
  });

  it('returns scoped-support-target-missing when a primary focus target support path does not exist', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      primaryFocusTargets: [{
        path: 'src/planner',
        kind: 'directory',
        repoId: 'platform',
        focusId: 'planner',
        role: 'anchor',
        supportTargets: [{ path: 'src/support/missing.ts', kind: 'file' }],
      }],
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['scoped-support-target-missing']),
    );
  });

  it('returns selected-repo-id-missing when a selected repo ID no longer exists in the manifest', async () => {
    const fixture = await createFixture();
    const baseline = createSnapshot(fixture);
    const snapshot = createSnapshot(fixture, {
      contextPackBinding: {
        ...baseline.contextPackBinding,
        selectedRepoIds: ['missing-repo'],
      },
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['selected-repo-id-missing']),
    );
  });

  it('returns selected-focus-id-missing when a selected focus ID no longer exists in the manifest', async () => {
    const fixture = await createFixture();
    const baseline = createSnapshot(fixture);
    const snapshot = createSnapshot(fixture, {
      contextPackBinding: {
        ...baseline.contextPackBinding,
        selectedFocusIds: ['missing-focus'],
      },
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['selected-focus-id-missing']),
    );
  });

  it('treats target paths that escape their resolved repo root as missing target issues', async () => {
    const fixture = await createFixture();
    const snapshot = createSnapshot(fixture, {
      primaryFocusTargets: [{ path: '../escaped', kind: 'directory' }],
    });
    expect(codes(await runValidation(fixture, snapshot))).toEqual(
      expect.arrayContaining(['primary-focus-target-missing']),
    );
  });
});
