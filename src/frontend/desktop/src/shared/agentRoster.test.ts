import { describe, expect, it } from 'vitest';

import {
  namedWorkflowAgentRoster,
  planningAgentDisplayName,
  getPlannerConversationLabel,
} from './agentRoster';

describe('namedWorkflowAgentRoster', () => {
  it('contains the active workflow roster', () => {
    const keys = Object.keys(namedWorkflowAgentRoster);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual([
      'planning-agent',
      'product-manager',
      'software-engineer',
      'qa',
    ]);
  });

  it('formats displayName as "Name (Role)"', () => {
    const profile = namedWorkflowAgentRoster['software-engineer'];
    expect(profile.displayName).toBe('Dalton (Software Engineer)');
    expect(profile.humanName).toBe('Dalton');
    expect(profile.role).toBe('Software Engineer');
  });
});

describe('planningAgentDisplayName', () => {
  it('matches the planning-agent roster entry', () => {
    expect(planningAgentDisplayName).toBe('Lily (Planning Specialist)');
  });
});

describe('getPlannerConversationLabel', () => {
  it('returns Lily for planner role', () => {
    expect(getPlannerConversationLabel('planner')).toBe('Lily');
  });

  it('returns "Operator" for operator role', () => {
    expect(getPlannerConversationLabel('operator')).toBe('Operator');
  });
});
