import { describe, expect, it } from 'vitest';
import { buildAgentArgs, formatAgentCommand, resolveAutonomyProfile } from '../autonomy.js';
import type { AgentProfile } from '../types.js';

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'dalton',
    registryId: 'software-engineer',
    displayName: 'Dalton',
    role: 'Software Engineer',
    requiredModel: 'gpt-4.1',
    autonomyProfile: 'repo-executor',
    workflowOrder: 4,
    allowedDirs: ['src/', 'tests/'],
    denyRules: ['git add', 'git commit'],
    ...overrides,
  };
}

function makeArtifactAuthor(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return makeProfile({
    id: 'alice',
    registryId: 'product-manager',
    autonomyProfile: 'artifact-author',
    denyRules: undefined,
    ...overrides,
  });
}

function makePlanningAuthor(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return makeProfile({
    id: 'lily',
    registryId: 'planning-agent',
    displayName: 'Lily',
    role: 'Planning Intake',
    autonomyProfile: 'artifact-author',
    denyRules: undefined,
    ...overrides,
  });
}

function makeQaExecutor(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return makeProfile({
    id: 'ron',
    registryId: 'qa',
    displayName: 'Ron',
    role: 'QA and Closeout',
    autonomyProfile: 'qa-executor',
    requiredModel: 'gpt-5.4',
    denyRules: undefined,
    ...overrides,
  });
}

function buildArgs(profile: AgentProfile, contextPackDir?: string) {
  const intent = resolveAutonomyProfile(profile, contextPackDir, '/repo');
  return buildAgentArgs('/repo', profile, intent, {
    launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
  });
}

describe('resolveAutonomyProfile', () => {
  it('returns semantic repo-executor intent without CLI flags or deny grammar', () => {
    const intent = resolveAutonomyProfile(makeProfile({ denyRules: ['shell(custom:foo)'] }), '/ctx/pack', '/repo');

    expect(intent).toEqual({
      model: 'gpt-4.1',
      autonomyProfile: 'repo-executor',
      allowedDirs: ['/repo/src', '/repo/tests', '/ctx/pack'],
      disallowTempDir: true,
    });
    expect(intent).not.toHaveProperty('additionalFlags');
    expect(intent).not.toHaveProperty('denyTools');
    expect(intent).not.toHaveProperty('allowTools');
  });

  it('does not add context pack dir to Lily allowed dirs', () => {
    const intent = resolveAutonomyProfile(makePlanningAuthor(), '/path/to/context-pack');
    expect(intent.allowedDirs).not.toContain('/path/to/context-pack');
    expect(intent.disallowTempDir).toBe(true);
  });

  it('does not bake per-task dirs into the resolver — that responsibility moved to roleAgent.ts', () => {
    // This resolver is intentionally taskId-unaware: per-task --add-dir scoping
    // is applied in roleAgent.ts so a single source of truth handles cross-task
    // filesystem isolation for every agent uniformly (see roleAgent.ts §3b).
    const intent = resolveAutonomyProfile(makeQaExecutor(), undefined, '/repo');
    expect(intent.allowedDirs).not.toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs');
    expect(intent.allowedDirs).not.toContain('/repo/AgentWorkSpace/ImplementationSteps');
  });
});

describe('buildAgentArgs Copilot parity', () => {
  it('preserves argv order and resolved tool policy for repo-executor', () => {
    const profile = makeProfile({ denyRules: ['shell(custom:foo)'] });
    const result = buildArgs(profile, '/ctx/pack');

    expect(result.args).toEqual([
      '--agent',
      'software-engineer',
      '--model',
      'gpt-4.1',
      '--allow-all-tools',
      '--no-ask-user',
      '--disallow-temp-dir',
      '--deny-tool',
      'shell(git add)',
      '--deny-tool',
      'shell(git commit)',
      '--deny-tool',
      'shell(git push)',
      '--deny-tool',
      'shell(gh pr create)',
      '--deny-tool',
      'shell(rm:*)',
      '--deny-tool',
      'shell(sudo)',
      '--deny-tool',
      'shell(su)',
      '--deny-tool',
      'shell(doas)',
      '--deny-tool',
      'shell(chown:*)',
      '--deny-tool',
      'shell(custom:foo)',
      '--add-dir',
      '/repo/src',
      '--add-dir',
      '/repo/tests',
      '--add-dir',
      '/ctx/pack',
    ]);
    expect(result.resolvedToolPolicy).toMatchObject({
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
    });
    expect(result.launchCwd).toBe('/repo');
    expect(result.inlineAgentContext).toBe(false);
  });

  it('preserves artifact-author tool policy', () => {
    const result = buildArgs(makeArtifactAuthor());
    expect(result.args).toEqual(expect.arrayContaining(['--no-ask-user', '--allow-tool', 'write', '--deny-tool', 'shell']));
    expect(result.resolvedToolPolicy).toEqual({
      allowAllTools: false,
      noAskUser: true,
      allowTools: ['write'],
      denyTools: ['shell'],
    });
  });

  it('does not inject per-task handoff add-dir at the resolver layer', () => {
    // Per-task --add-dir scoping is now applied downstream in roleAgent.ts.
    // The resolver layer must NOT know about taskId, so it cannot leak the
    // legacy singleton handoffs path either.
    const result = buildArgs(makeQaExecutor(), undefined);
    expect(result.args).not.toContain('/repo/AgentWorkSpace/handoffs');
    expect(result.args).not.toContain('/repo/AgentWorkSpace/tasks/task-xyz-789/handoffs');
  });

  it('formats through the active provider', () => {
    expect(formatAgentCommand('/repo', ['--agent', 'software-engineer', '--model', 'gpt-4.1']))
      .toBe('copilot --agent software-engineer --model gpt-4.1');
    expect(formatAgentCommand('/repo', ['--agent', 'some agent'])).toBe('copilot --agent "some agent"');
  });
});
