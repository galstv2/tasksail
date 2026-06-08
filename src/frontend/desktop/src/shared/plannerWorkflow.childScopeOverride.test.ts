import { describe, expect, it } from 'vitest';

import type { PlannerChildTaskExecutionScope } from './desktopContractPlanner';
import { buildChildTaskStarterPrompt } from './plannerWorkflow';

const childScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  repositoryTypes: { 'orders-api': 'primary' },
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

describe('buildChildTaskStarterPrompt child scope override sections', () => {
  it('labels implementation authority before read-only planning context', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-2',
      parentTaskTitle: 'Parent',
      rootTaskId: 'TASK-1',
      parentQmdScope: 'orders',
      childTaskExecutionScope: childScope,
      plannerPlanningReloadScope: {
        ...childScope,
        schemaVersion: 1,
        purpose: 'planner-planning-read-context',
        selectedRepoIds: ['orders-api', 'billing-api'],
      },
    });

    expect(prompt.indexOf('Child Execution Scope (Implementation Authority)')).toBeLessThan(
      prompt.indexOf('Additional Parent Context Scope (Read-Only Planning Context)'),
    );
    expect(prompt).toContain('Implementation agent, Context Pack Binding, activation, and closeout use only Child Execution Scope.');
    expect(prompt).toContain('Do not infer implementation authority from read-only planning context.');
    expect(prompt).toContain('If broader implementation authority is needed, ask the Guide to adjust Child Execution Scope.');
    expect(prompt).not.toContain('Additional Parent Context Scope (Context Pack Binding)');
  });

  it('labels standard child execution primary and support read context from independent roles', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-2',
      parentTaskTitle: 'Parent',
      rootTaskId: 'TASK-1',
      parentQmdScope: 'orders',
      childTaskExecutionScope: {
        ...childScope,
        selectedRepoIds: ['tools', 'platform'],
        selectedFocusIds: ['frontend', 'backend'],
        repositoryTypes: {
          tools: 'support',
          platform: 'primary',
          frontend: 'primary',
          backend: 'support',
        },
      },
    });

    expect(prompt).toContain('Primary repositories: platform');
    expect(prompt).toContain('Support/read-only repositories: tools');
    expect(prompt).toContain('Primary focus IDs: frontend');
    expect(prompt).toContain('Support/read-only focus IDs: backend');
  });
});
