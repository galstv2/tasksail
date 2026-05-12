import { describe, expect, it } from 'vitest';

import {
  createNamedWorkflowAgentRoster,
  getPlanningAgentDisplayName,
  getPlannerConversationLabel,
} from './agentRoster';
import type { ProviderFrontendDescriptor } from './desktopContractProvider';

const descriptor: ProviderFrontendDescriptor = {
  providerId: 'test',
  homeDirName: 'test-home',
  registryPath: '/repo/.provider/registry.json',
  agentConfigPaths: {
    root: '.provider',
    instructions: '.provider/instructions',
    prompts: '.provider/prompts',
    profiles: '.provider/agents',
    registry: '.provider/registry.json',
  },
  promptPathEnvVars: { handoffsDir: 'TEST_HANDOFFS_DIR', implStepsDir: 'TEST_IMPL_STEPS_DIR' },
  contextPackEnvVars: { paths: 'TEST_CONTEXT_PACK_PATHS', searchRoots: 'TEST_CONTEXT_PACK_SEARCH_ROOTS' },
  roster: [
    { agentId: 'provider-planner', roleName: 'Planning Specialist', humanName: 'Lily', workflowOrder: 1, roleKind: 'planner' },
    { agentId: 'provider-builder', roleName: 'Software Engineer', humanName: 'Dalton', workflowOrder: 2, roleKind: 'builder' },
  ],
  plannerAgentId: 'provider-planner',
};

describe('createNamedWorkflowAgentRoster', () => {
  it('derives roster profiles from the provider descriptor', () => {
    const roster = createNamedWorkflowAgentRoster(descriptor);
    expect(Object.keys(roster)).toEqual(['provider-planner', 'provider-builder']);
    expect(roster['provider-builder']).toEqual({
      displayName: 'Dalton (Software Engineer)',
      humanName: 'Dalton',
      role: 'Software Engineer',
    });
  });
});

describe('getPlanningAgentDisplayName', () => {
  it('matches the provider-planner descriptor entry', () => {
    expect(getPlanningAgentDisplayName(descriptor, descriptor.plannerAgentId)).toBe('Lily (Planning Specialist)');
  });
});

describe('getPlannerConversationLabel', () => {
  it('returns the provider planning agent human name for planner role', () => {
    expect(getPlannerConversationLabel(descriptor, descriptor.plannerAgentId, 'planner')).toBe('Lily');
  });

  it('returns "Operator" for operator role', () => {
    expect(getPlannerConversationLabel(descriptor, descriptor.plannerAgentId, 'operator')).toBe('Operator');
  });
});
