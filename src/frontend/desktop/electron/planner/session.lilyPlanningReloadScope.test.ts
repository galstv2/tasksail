// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PlannerChildTaskExecutionScope, PlannerFocusSnapshot } from '../../src/shared/desktopContract';

const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();
const resolvePlannerLaunchExtensions = vi.fn();

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
vi.mock('./staging', () => ({ initializeStagedPlanningDraft, clearStagingArtifacts }));
vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));
// Override only the resolver so real backend staging (lock + disk) never runs in this unit test.
vi.mock('./launchExtensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./launchExtensions')>()),
  resolvePlannerLaunchExtensions,
}));

const snapshot: PlannerFocusSnapshot = {
  version: 1,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent task',
  primaryRepoId: 'parent-repo',
  primaryRepoRoot: '/repo/parent',
  primaryFocusRelativePath: 'src/parent',
  primaryFocusTargetKind: 'directory',
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    scopeMode: 'repo-selection',
    selectedRepoIds: ['parent-repo'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  },
};

const lineage = {
  parentTaskId: 'PARENT-1',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/parent',
  rootTaskId: 'PARENT-1',
  followUpReason: 'Continue',
};

const childScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  scopeMode: 'repo-selection',
  selectedRepoIds: ['child-repo'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

describe('plannerSession Planner Planning Reload Scope', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(101);
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    resolvePlannerLaunchExtensions.mockResolvedValue({
      plannerSessionId: 'unused',
      launchExtensions: { pluginDirs: ['/stage/ext/plugins/p1'], skillDirs: ['/stage/ext/skills'] },
      availabilityNote: 'LILY-EXTENSION-NOTE',
      skillCount: 1,
      pluginCount: 1,
      extensionIds: ['p1'],
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('keeps reload scope out of staged child execution authority', async () => {
    const { startSession } = await import('./session');
    await startSession('/packs/live', undefined, undefined, snapshot, lineage, childScope, {
      ...childScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
      selectedRepoIds: ['child-repo', 'parent-repo'],
    });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      contextPackBinding: snapshot.contextPackBinding,
      childTaskExecutionScope: expect.objectContaining({
        selectedRepoIds: ['child-repo'],
      }),
    }));
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalledWith(expect.objectContaining({
      plannerPlanningReloadScope: expect.anything(),
    }));
    // Reload-scope behavior is unchanged by Lily extensions: no stage paths or note in staging.
    const stagedPayload = JSON.stringify(initializeStagedPlanningDraft.mock.calls);
    expect(stagedPayload).not.toContain('/stage/ext');
    expect(stagedPayload).not.toContain('LILY-EXTENSION-NOTE');
  });

  it('uses the standard reload-scope primary role for Lily focused repo resolution', async () => {
    const packDir = mkdtempSync(path.join(tmpdir(), 'tasksail-planner-reload-'));
    try {
      const toolsRoot = path.join(packDir, 'tools');
      const platformRoot = path.join(packDir, 'platform');
      mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
      mkdirSync(toolsRoot, { recursive: true });
      mkdirSync(platformRoot, { recursive: true });
      const resolvedToolsRoot = realpathSync(toolsRoot);
      const resolvedPlatformRoot = realpathSync(platformRoot);
      writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), JSON.stringify({
        manifest_version: 2,
        manifest_status: 'generated',
        estate_type: 'distributed-platform',
        context_pack_id: 'parent',
        qmd_scope_root: 'qmd/context-packs/parent',
        primary_working_repo_ids: ['platform'],
        primary_focus_area_ids: [],
        repositories: [
          { repo_id: 'tools', local_paths: [toolsRoot] },
          { repo_id: 'platform', local_paths: [platformRoot] },
        ],
      }));

      const scopedSnapshot: PlannerFocusSnapshot = {
        ...snapshot,
        contextPackDir: packDir,
        contextPackBinding: {
          ...snapshot.contextPackBinding,
          contextPackDir: packDir,
        },
      };
      const scopedChildScope: PlannerChildTaskExecutionScope = {
        ...childScope,
        contextPackDir: packDir,
        selectedRepoIds: ['tools', 'platform'],
        repositoryTypes: { tools: 'support', platform: 'primary' },
      };

      const { startSession } = await import('./session');
      await startSession(packDir, undefined, undefined, scopedSnapshot, lineage, scopedChildScope, {
        ...scopedChildScope,
        schemaVersion: 1,
        purpose: 'planner-planning-read-context',
      });

      const stagedPayload = initializeStagedPlanningDraft.mock.calls[0]?.[0];
      expect(stagedPayload?.focusedRepo).toEqual(expect.objectContaining({
        primaryRepoId: 'platform',
        primaryRepoRoot: resolvedPlatformRoot,
      }));
      expect(stagedPayload?.focusedRepo?.primaryRepoRoot).not.toBe(resolvedToolsRoot);
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });

  it('rejects reload scope without child execution scope before staging', async () => {
    const { startSession } = await import('./session');
    await expect(startSession('/packs/live', undefined, undefined, snapshot, lineage, undefined, {
      ...childScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
    })).rejects.toThrow('Planner Planning Reload Scope requires Child Execution Scope authority.');
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
  });

  it('rejects reload scope context-pack drift before staging', async () => {
    const { startSession } = await import('./session');
    await expect(startSession('/packs/live', undefined, undefined, snapshot, lineage, childScope, {
      ...childScope,
      contextPackId: 'other',
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
    })).rejects.toThrow('Planner Planning Reload Scope must match the selected parent context pack.');
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
  });
});
