import { describe, it, expect, afterEach } from 'vitest';
import { resolveAutonomyProfile, buildCopilotArgs, formatCopilotCommand } from '../autonomy.js';
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

describe('resolveAutonomyProfile', () => {
  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ACTIVE_MODEL'];
    delete process.env['COPILOT_MODEL'];
  });

  it('repo-executor includes --allow-all-tools and --no-ask-user', () => {
    const args = resolveAutonomyProfile(makeProfile());
    expect(args.additionalFlags).toContain('--allow-all-tools');
    expect(args.additionalFlags).toContain('--no-ask-user');
  });

  it('artifact-author includes --no-ask-user but not --allow-all-tools', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor());
    expect(args.additionalFlags).not.toContain('--allow-all-tools');
    expect(args.additionalFlags).toContain('--no-ask-user');
  });

  it('artifact-author includes --allow-tool write', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor());
    expect(args.allowTools).toContain('write');
  });

  it('repo-executor does not include --allow-tool write (has --allow-all-tools instead)', () => {
    const args = resolveAutonomyProfile(makeProfile());
    expect(args.allowTools).not.toContain('write');
  });

  it('includes profile allowed dirs resolved to absolute paths', () => {
    const args = resolveAutonomyProfile(makeProfile(), undefined, '/repo');
    expect(args.allowedDirs).toContain('/repo/src');
    expect(args.allowedDirs).toContain('/repo/tests');
  });

  it('adds context pack dir to allowed dirs', () => {
    const args = resolveAutonomyProfile(makeProfile(), '/path/to/context-pack');
    expect(args.allowedDirs).toContain('/path/to/context-pack');
  });

  it('does not add context pack dir to Lily allowed dirs', () => {
    const args = resolveAutonomyProfile(makePlanningAuthor(), '/path/to/context-pack');
    expect(args.allowedDirs).not.toContain('/path/to/context-pack');
  });

  it('resolves model from profile', () => {
    const args = resolveAutonomyProfile(makeProfile());
    expect(args.model).toBe('gpt-4.1');
  });

  it('repo-executor with repoRoot does NOT add workflow artifact dirs', () => {
    const args = resolveAutonomyProfile(makeProfile(), undefined, '/repo');
    expect(args.allowedDirs).not.toContain('/repo/AgentWorkSpace/handoffs');
    expect(args.allowedDirs).not.toContain('/repo/AgentWorkSpace/ImplementationSteps');
  });

  it('artifact-author with repoRoot does not add workflow artifact dirs', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor(), undefined, '/repo');
    expect(args.allowedDirs).not.toContain('/repo/AgentWorkSpace/handoffs');
    expect(args.allowedDirs).not.toContain('/repo/AgentWorkSpace/ImplementationSteps');
  });

  it('repo-executor with contextPackDir adds --disallow-temp-dir', () => {
    const args = resolveAutonomyProfile(makeProfile(), '/ctx/pack');
    expect(args.additionalFlags).toContain('--disallow-temp-dir');
  });

  it('repo-executor without contextPackDir does not add --disallow-temp-dir', () => {
    const args = resolveAutonomyProfile(makeProfile());
    expect(args.additionalFlags).not.toContain('--disallow-temp-dir');
  });

  it('artifact-author with contextPackDir adds --disallow-temp-dir', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor(), '/ctx/pack');
    expect(args.additionalFlags).toContain('--disallow-temp-dir');
  });

  it('Lily with contextPackDir still adds --disallow-temp-dir', () => {
    const args = resolveAutonomyProfile(makePlanningAuthor(), '/ctx/pack');
    expect(args.additionalFlags).toContain('--disallow-temp-dir');
  });

  it('deny rules populate denyTools', () => {
    const args = resolveAutonomyProfile(makeProfile());
    expect(args.denyTools).toContain('git add');
    expect(args.denyTools).toContain('git commit');
  });

  it('repo-executor gets hardcoded deny-tool floor even with no registry deny_rules', () => {
    const args = resolveAutonomyProfile(makeProfile({ denyRules: undefined }));
    expect(args.denyTools).toContain('shell(git add)');
    expect(args.denyTools).toContain('shell(git commit)');
    expect(args.denyTools).toContain('shell(git push)');
    expect(args.denyTools).toContain('shell(rm:*)');
    expect(args.denyTools).toContain('shell(sudo)');
  });

  it('repo-executor merges registry deny_rules with floor without duplicates', () => {
    const args = resolveAutonomyProfile(makeProfile({ denyRules: ['shell(git add)', 'shell(custom:foo)'] }));
    const gitAddCount = args.denyTools.filter((r) => r === 'shell(git add)').length;
    expect(gitAddCount).toBe(1);
    expect(args.denyTools).toContain('shell(custom:foo)');
  });

  it('artifact-author does not get repo-executor deny-tool floor', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor());
    expect(args.denyTools).not.toContain('shell(git add)');
    expect(args.denyTools).not.toContain('shell(rm:*)');
  });

  it('artifact-author gets blanket shell deny', () => {
    const args = resolveAutonomyProfile(makeArtifactAuthor());
    expect(args.denyTools).toContain('shell');
  });

  it('qa-executor includes --allow-all-tools and --no-ask-user', () => {
    const args = resolveAutonomyProfile(makeQaExecutor());
    expect(args.additionalFlags).toContain('--allow-all-tools');
    expect(args.additionalFlags).toContain('--no-ask-user');
  });

  it('qa-executor gets REPO_EXECUTOR_DENY_FLOOR deny rules', () => {
    const args = resolveAutonomyProfile(makeQaExecutor());
    expect(args.denyTools).toContain('shell(git add)');
    expect(args.denyTools).toContain('shell(git commit)');
    expect(args.denyTools).toContain('shell(git push)');
    expect(args.denyTools).toContain('shell(rm:*)');
    expect(args.denyTools).toContain('shell(sudo)');
  });

  it('qa-executor with repoRoot gets handoff dir but not ImplementationSteps', () => {
    const args = resolveAutonomyProfile(makeQaExecutor(), undefined, '/repo');
    expect(args.allowedDirs).toContain('/repo/AgentWorkSpace/handoffs');
    expect(args.allowedDirs).not.toContain('/repo/AgentWorkSpace/ImplementationSteps');
  });

  it('qa-executor without contextPackDir does not add --disallow-temp-dir', () => {
    const args = resolveAutonomyProfile(makeQaExecutor());
    expect(args.additionalFlags).not.toContain('--disallow-temp-dir');
  });

  it('qa-executor does not get blanket shell deny', () => {
    const args = resolveAutonomyProfile(makeQaExecutor());
    expect(args.denyTools).not.toContain('shell');
  });

  it('qa-executor does not get --allow-tool write (has --allow-all-tools instead)', () => {
    const args = resolveAutonomyProfile(makeQaExecutor());
    expect(args.allowTools).not.toContain('write');
  });
});

describe('buildCopilotArgs', () => {
  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ACTIVE_MODEL'];
    delete process.env['COPILOT_MODEL'];
  });

  it('builds args with agent flag and model', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);

    expect(args).toContain('--agent');
    expect(args).toContain('software-engineer');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-4.1');
  });

  it('includes --allow-all-tools for repo-executor', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).toContain('--allow-all-tools');
  });

  it('includes --no-ask-user for artifact-author', () => {
    const profile = makeArtifactAuthor();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).toContain('--no-ask-user');
  });

  it('includes --allow-tool write for artifact-author', () => {
    const profile = makeArtifactAuthor();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    const allowToolIdx = args.indexOf('--allow-tool');
    expect(allowToolIdx).toBeGreaterThan(-1);
    expect(args[allowToolIdx + 1]).toBe('write');
  });

  it('includes --deny-tool for deny rules', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    const denyIdx = args.indexOf('--deny-tool');
    expect(denyIdx).toBeGreaterThan(-1);
    // Floor rules come first, then registry rules
    expect(args[denyIdx + 1]).toBe('shell(git add)');
  });

  it('includes --deny-tool shell for artifact-author in copilot args', () => {
    const profile = makeArtifactAuthor();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).toContain('--deny-tool');
    const denyIdx = args.indexOf('--deny-tool');
    expect(args[denyIdx + 1]).toBe('shell');
  });

  it('includes --add-dir for allowed dirs', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile, undefined, '/repo');
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).toContain('--add-dir');
    expect(args).toContain('/repo/src');
  });

  it('includes --disallow-temp-dir for repo-executor with context pack', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile, '/ctx/pack');
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).toContain('--disallow-temp-dir');
  });

  it('does not include skip-workflow-check in copilot args', () => {
    const profile = makeProfile();
    const autonomy = resolveAutonomyProfile(profile);
    const args = buildCopilotArgs(profile, autonomy);
    expect(args).not.toContain('--skip-workflow-check');
  });
});

describe('formatCopilotCommand', () => {
  it('formats args into a readable command string', () => {
    const result = formatCopilotCommand(['--agent', 'software-engineer', '--model', 'gpt-4.1']);
    expect(result).toBe('copilot --agent software-engineer --model gpt-4.1');
  });

  it('quotes args with spaces', () => {
    const result = formatCopilotCommand(['--agent', 'some agent']);
    expect(result).toBe('copilot --agent "some agent"');
  });
});
