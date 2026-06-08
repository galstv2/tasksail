import { describe, expect, it } from 'vitest';

import type { ArchivedParentChainArchiveBundle } from './desktopContract';
import { buildChildTaskStarterPrompt } from './plannerWorkflow';

function bundle(overrides: Partial<ArchivedParentChainArchiveBundle> = {}): ArchivedParentChainArchiveBundle {
  return {
    schemaVersion: 1,
    parentTaskId: 'child-1',
    rootTaskId: 'root-1',
    currentTipTaskId: 'child-1',
    status: 'available',
    missingTaskIds: [],
    totalBytes: 24,
    truncated: false,
    tasks: [{
      taskId: 'root-1',
      title: 'Root task',
      depth: 0,
      role: 'root',
      state: 'completed',
      archivedAt: '2026-05-17T08:42:11.000Z',
      archivePath: '/archive/root/archive.md',
      sizeBytes: 12,
      content: 'Root archive',
      truncated: false,
    }, {
      taskId: 'child-1',
      title: 'Child task',
      depth: 1,
      role: 'selected-parent',
      state: 'completed',
      archivedAt: null,
      archivePath: '/archive/child/archive.md',
      sizeBytes: 12,
      content: 'Child archive',
      truncated: false,
    }],
    ...overrides,
  };
}

describe('buildChildTaskStarterPrompt parent chain archive bundle', () => {
  it('renders chain timeline between scope sections and immediate parent context bundle', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'child-1',
      parentTaskTitle: 'Child task',
      rootTaskId: 'root-1',
      parentQmdScope: 'qmd/context-packs/pack',
      parentChainArchiveBundle: bundle(),
      parentContextBundle: {
        schemaVersion: 1,
        parentTaskId: 'child-1',
        rootTaskId: 'root-1',
        parentTaskTitle: 'Child task',
        archivePath: '/archive/child/archive.md',
        archiveArtifactDir: '/archive/child',
        status: 'available',
        missing: [],
        files: [{ kind: 'handoff', fileName: 'intake.md', relativePath: 'handoffs/intake.md', sizeBytes: 6, content: 'intake', truncated: false }],
        totalBytes: 6,
        truncated: false,
        fallbackSummary: null,
      },
      childTaskExecutionScope: {
        contextPackDir: '/packs/pack',
        contextPackId: 'pack',
        scopeMode: 'repo-selection',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: false,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        repositoryTypes: { platform: 'primary' },
        selectedFocusTargets: [],
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
      plannerPlanningReloadScope: {
        schemaVersion: 1,
        purpose: 'planner-planning-read-context',
        contextPackDir: '/packs/pack',
        contextPackId: 'pack',
        scopeMode: 'repo-selection',
        selectedRepoIds: ['platform', 'tools'],
        selectedFocusIds: [],
        deepFocusEnabled: false,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        repositoryTypes: { platform: 'primary', tools: 'support' },
        selectedFocusTargets: [],
        selectedSupportTargets: [],
        selectedTestTarget: null,
      },
    });

    expect(prompt.indexOf('Child Execution Scope (Implementation Authority):')).toBeLessThan(prompt.indexOf('Additional Parent Context Scope (Read-Only Planning Context):'));
    expect(prompt.indexOf('Additional Parent Context Scope (Read-Only Planning Context):')).toBeLessThan(prompt.indexOf('Full Chain Archive Timeline (Read-Only Planning Memory)'));
    expect(prompt.indexOf('Full Chain Archive Timeline (Read-Only Planning Memory)')).toBeLessThan(prompt.indexOf('Immediate Parent Context Bundle:'));
    expect(prompt).toContain('--- BEGIN CHAIN ARCHIVE TASK depth=0 role=root taskId=root-1 title="Root task" archivedAt=2026-05-17T08:42:11.000Z ---');
    expect(prompt).toContain('--- END CHAIN ARCHIVE TASK taskId=root-1 ---');
    expect(prompt).toContain('--- BEGIN CHAIN ARCHIVE TASK depth=1 role=selected-parent taskId=child-1 title="Child task" archivedAt=null ---');
  });

  it('renders no-chain-state, missing archive, and truncation notes', () => {
    expect(buildChildTaskStarterPrompt({
      parentTaskId: 'root-1',
      parentTaskTitle: 'Root task',
      rootTaskId: 'root-1',
      parentQmdScope: 'qmd/context-packs/pack',
      parentChainArchiveBundle: bundle({ status: 'no-chain-state', currentTipTaskId: null, tasks: [], totalBytes: 0 }),
    })).toContain('No prior child-chain archive timeline exists yet. This child starts the chain.');

    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'child-1',
      parentTaskTitle: 'Child task',
      rootTaskId: 'root-1',
      parentQmdScope: 'qmd/context-packs/pack',
      parentChainArchiveBundle: bundle({ status: 'missing-archives', missingTaskIds: ['root-1'], truncated: true }),
    });

    expect(prompt).toContain('Missing chain archive task IDs: root-1');
    expect(prompt).toContain('One or more chain archives were truncated by the platform prompt-size guard.');
  });
});
