import { describe, expect, it } from 'vitest';

import {
  createNamedWorkflowAgentRoster,
  FALLBACK_PLANNER_DISPLAY,
  getPlanningAgentDisplayName,
  getPlannerDisplayModel,
  getPlannerConversationLabel,
} from './agentRoster';
import type { ProviderFrontendDescriptor } from './desktopContractProvider';

const descriptor: ProviderFrontendDescriptor = {
  providerId: 'test',
  cliDisplayName: 'Test CLI',
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

const averyDescriptor: ProviderFrontendDescriptor = {
  ...descriptor,
  providerId: 'synthetic-cli',
  roster: descriptor.roster.map((entry) => (
    entry.agentId === 'provider-planner'
      ? { ...entry, humanName: 'Avery', roleName: 'Planning Strategist' }
      : entry
  )),
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

describe('getPlannerDisplayModel', () => {
  it('derives the current Copilot planner display from the descriptor roster', () => {
    expect(getPlannerDisplayModel(descriptor)).toEqual({
      plannerName: 'Lily',
      plannerDisplayName: 'Lily (Planning Specialist)',
      plannerRoleName: 'Planning Specialist',
    });
  });

  it('derives a synthetic non-Lily planner display from the descriptor roster', () => {
    expect(getPlannerDisplayModel(averyDescriptor)).toEqual({
      plannerName: 'Avery',
      plannerDisplayName: 'Avery (Planning Strategist)',
      plannerRoleName: 'Planning Strategist',
    });
  });

  it('falls back when descriptor data is unavailable or incomplete', () => {
    expect(getPlannerDisplayModel(null)).toEqual(FALLBACK_PLANNER_DISPLAY);
    expect(getPlannerDisplayModel({ ...descriptor, plannerAgentId: null })).toEqual(FALLBACK_PLANNER_DISPLAY);
    expect(getPlannerDisplayModel({ ...descriptor, plannerAgentId: 'missing-planner' })).toEqual(FALLBACK_PLANNER_DISPLAY);
  });
});

describe('getPlannerConversationLabel', () => {
  it('returns the provider planning agent human name for planner role', () => {
    expect(getPlannerConversationLabel(descriptor, descriptor.plannerAgentId, 'planner')).toBe('Lily');
  });

  it('returns the synthetic provider planning agent human name for planner role', () => {
    expect(getPlannerConversationLabel(averyDescriptor, averyDescriptor.plannerAgentId, 'planner')).toBe('Avery');
  });

  it('returns "Operator" for operator role', () => {
    expect(getPlannerConversationLabel(descriptor, descriptor.plannerAgentId, 'operator')).toBe('Operator');
  });
});
