import { describe, expect, it } from 'vitest';

import {
  buildPlannerPlanningReloadScope,
  __plannerChildScopeTestHooks,
} from './plannerChildScope';
import type { PlannerChildTaskExecutionScope } from '../../shared/desktopContract';

const baseScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'focused',
  selectedRepoIds: [],
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

describe('plannerChildScope reload scope postcondition', () => {
  it('passes for distributed-platform standard unions', () => {
    const parent = {
      ...baseScope,
      selectedRepoIds: ['tools', 'platform'],
      repositoryTypes: { tools: 'primary', platform: 'primary' },
    } satisfies PlannerChildTaskExecutionScope;
    const child = {
      ...parent,
      selectedRepoIds: ['tools', 'docs'],
      repositoryTypes: { tools: 'primary', docs: 'support' },
    } satisfies PlannerChildTaskExecutionScope;

    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(
      parent,
      child,
      buildPlannerPlanningReloadScope(parent, child),
    )).not.toThrow();
  });

  it('passes for monolith standard unions', () => {
    const parent = {
      ...baseScope,
      contextPackDir: '/packs/monolith',
      contextPackId: 'monolith',
      selectedFocusIds: ['focus-a', 'focus-b'],
      repositoryTypes: { 'focus-a': 'primary', 'focus-b': 'support' },
    } satisfies PlannerChildTaskExecutionScope;
    const child = {
      ...parent,
      selectedFocusIds: ['focus-a', 'focus-c'],
      repositoryTypes: { 'focus-a': 'primary', 'focus-c': 'support' },
    } satisfies PlannerChildTaskExecutionScope;

    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(
      parent,
      child,
      buildPlannerPlanningReloadScope(parent, child),
    )).not.toThrow();
  });

  it('passes for distributed-platform Deep Focus targets', () => {
    const parent = {
      ...baseScope,
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'orders-api',
      selectedRepoIds: ['orders-api', 'billing-api'],
      selectedFocusTargets: [
        { path: 'src/orders', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api', role: 'anchor' },
        { path: 'src/billing', kind: 'directory', repoId: 'billing-api', repoLocalPath: '/repo/billing-api', role: 'primary' },
      ],
    } satisfies PlannerChildTaskExecutionScope;
    const child = {
      ...parent,
      selectedRepoIds: ['orders-api', 'payments-api'],
      selectedFocusTargets: [
        { path: 'src/orders', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api', role: 'anchor' },
        { path: 'src/payments', kind: 'directory', repoId: 'payments-api', repoLocalPath: '/repo/payments-api', role: 'primary' },
      ],
    } satisfies PlannerChildTaskExecutionScope;

    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(
      parent,
      child,
      buildPlannerPlanningReloadScope(parent, child),
    )).not.toThrow();
  });

  it('detects drop, duplicate, wrong-role, wrong-purpose, and mismatched-context-pack divergences', () => {
    const parent = {
      ...baseScope,
      selectedRepoIds: ['tools', 'platform'],
      repositoryTypes: { tools: 'primary', platform: 'primary' },
    } satisfies PlannerChildTaskExecutionScope;
    const child = {
      ...parent,
      selectedRepoIds: ['tools', 'docs'],
      repositoryTypes: { tools: 'primary', docs: 'support' },
    } satisfies PlannerChildTaskExecutionScope;
    const output = buildPlannerPlanningReloadScope(parent, child);

    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(parent, child, {
      ...output,
      selectedRepoIds: ['tools', 'docs'],
    })).toThrow(/selectedRepoIds/);
    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(parent, child, {
      ...output,
      selectedFocusIds: ['focus-a', 'focus-a'],
    })).toThrow(/selectedFocusIds/);
    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(parent, child, {
      ...output,
      repositoryTypes: { ...output.repositoryTypes, platform: 'primary' },
    })).toThrow(/repositoryTypes/);
    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(parent, child, {
      ...output,
      purpose: 'wrong' as 'planner-planning-read-context',
    })).toThrow(/purpose/);
    expect(() => __plannerChildScopeTestHooks.assertPlannerPlanningReloadScopePostcondition(parent, child, {
      ...output,
      contextPackId: 'other',
    })).toThrow(/contextPackId/);
  });
});
