// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { inferGuardrailIdentity } from '../repoObservability';

describe('inferGuardrailIdentity', () => {
  it('matches an exact roster id', () => {
    expect(inferGuardrailIdentity('provider-planner.json', ['provider-planner', 'provider-builder'])).toEqual({
      agentId: 'provider-planner',
      instanceId: null,
      sessionId: 'role:provider-planner',
    });
  });

  it('matches an instance suffix for a roster id', () => {
    expect(inferGuardrailIdentity('provider-builder-slice-1.json', ['provider-planner', 'provider-builder'])).toEqual({
      agentId: 'provider-builder',
      instanceId: 'slice-1',
      sessionId: 'parallel:slice-1',
    });
  });

  it('does not special-case legacy agent ids outside the roster', () => {
    expect(inferGuardrailIdentity('software-engineer-slice-2.json', ['provider-planner', 'provider-builder'])).toEqual({
      agentId: 'software-engineer-slice-2',
      instanceId: null,
      sessionId: 'role:software-engineer-slice-2',
    });
  });

  it('prefers the longest roster id when prefixes collide', () => {
    expect(inferGuardrailIdentity('provider-builder-verify-slice-1.json', [
      'provider-builder',
      'provider-builder-verify',
    ])).toEqual({
      agentId: 'provider-builder-verify',
      instanceId: 'slice-1',
      sessionId: 'parallel:slice-1',
    });
  });
});
