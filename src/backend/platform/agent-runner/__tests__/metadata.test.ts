import { describe, it, expect } from 'vitest';
import {
  ALL_AGENT_IDS,
  FAST_PATH_AGENT_ORDER,
  STANDARD_AGENT_ORDER,
} from '../../core/types.js';
import {
  resolveAgentProfile,
  resolveActiveModel,
  toRegistryId,
  fromRegistryId,
  findRegistryEntry,
} from '../metadata.js';
import type { RegistryJson } from '../types.js';

const MOCK_REGISTRY: RegistryJson = {
  schema_version: 1,
  default_wall_clock_timeout_s: 300,
  parallel_wall_clock_timeout_s: 900,
  agents: [
    {
      agent_id: 'software-engineer',
      role_name: 'Software Engineer',
      human_name: 'Dalton',
      instruction_path: '.github/copilot/instructions/software-engineer.instructions.md',
      agent_profile_path: '.github/agents/software-engineer.md',
      autonomy_profile: 'repo-executor',
      required_model: 'gpt-4.1',
      reasoning_effort: 'high',
      wall_clock_timeout_s: 600,
      workflow_order: 4,
      allowed_dirs: ['src/', 'tests/', 'packages/'],
      deny_rules: ['git add', 'git commit', 'git push', 'rm -rf'],
    },
    {
      agent_id: 'software-engineer-verify',
      role_name: 'Verification Engineer',
      human_name: 'Dalton (Verify)',
      instruction_path: '.github/copilot/instructions/software-engineer.instructions.md',
      agent_profile_path: '.github/agents/software-engineer-verify.md',
      autonomy_profile: 'repo-executor',
      required_model: 'claude-sonnet-4.6',
      wall_clock_timeout_s: 900,
      workflow_order: 99,
      deny_rules: ['git add', 'git commit', 'git push', 'rm -rf'],
    },
    {
      agent_id: 'product-manager',
      role_name: 'Product Manager',
      human_name: 'Alice',
      instruction_path: '.github/copilot/instructions/product-manager.instructions.md',
      agent_profile_path: '.github/agents/product-manager.md',
      autonomy_profile: 'artifact-author',
      required_model: 'gpt-5.4',
      wall_clock_timeout_s: 300,
      workflow_order: 1,
    },
    {
      agent_id: 'qa',
      role_name: 'QA',
      human_name: 'Ron',
      instruction_path: '.github/copilot/instructions/qa.instructions.md',
      agent_profile_path: '.github/agents/qa.md',
      autonomy_profile: 'artifact-author',
      required_model: 'gpt-5.4',
      wall_clock_timeout_s: 600,
      workflow_order: 6,
    },
  ],
};

describe('toRegistryId / fromRegistryId', () => {
  it('includes dalton-verify in the full agent id list only', () => {
    expect(ALL_AGENT_IDS).toContain('dalton-verify');
    expect(STANDARD_AGENT_ORDER).not.toContain('dalton-verify');
    expect(FAST_PATH_AGENT_ORDER).not.toContain('dalton-verify');
  });

  it('maps dalton to software-engineer', () => {
    expect(toRegistryId('dalton')).toBe('software-engineer');
  });

  it('maps dalton-verify to software-engineer-verify', () => {
    expect(toRegistryId('dalton-verify')).toBe('software-engineer-verify');
  });

  it('maps software-engineer pmck to dalton', () => {
    expect(fromRegistryId('software-engineer')).toBe('dalton');
  });

  it('maps software-engineer-verify back to dalton-verify', () => {
    expect(fromRegistryId('software-engineer-verify')).toBe('dalton-verify');
  });

  it('returns undefined for unknown registry id', () => {
    expect(fromRegistryId('nonexistent')).toBeUndefined();
  });
});

describe('findRegistryEntry', () => {
  it('finds dalton in the registry', () => {
    const entry = findRegistryEntry(MOCK_REGISTRY, 'dalton');
    expect(entry).toBeDefined();
    expect(entry!.agent_id).toBe('software-engineer');
    expect(entry!.human_name).toBe('Dalton');
  });

  it('returns undefined for unknown agent', () => {
    const entry = findRegistryEntry(MOCK_REGISTRY, 'lily');
    expect(entry).toBeUndefined();
  });
});

describe('resolveAgentProfile', () => {
  it('resolves dalton profile with correct fields', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(profile.id).toBe('dalton');
    expect(profile.registryId).toBe('software-engineer');
    expect(profile.displayName).toBe('Dalton');
    expect(profile.role).toBe('Software Engineer');
    expect(profile.requiredModel).toBe('gpt-4.1');
    expect(profile.reasoningEffort).toBe('high');
    expect(profile.autonomyProfile).toBe('repo-executor');
    expect(profile.allowedDirs).toEqual(['src/', 'tests/', 'packages/']);
    expect(profile.denyRules).toEqual(['git add', 'git commit', 'git push', 'rm -rf']);
    expect(profile.workflowOrder).toBe(4);
  });

  it('resolves alice profile as artifact-author', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'alice');
    expect(profile.autonomyProfile).toBe('artifact-author');
    expect(profile.requiredModel).toBe('gpt-5.4');
    expect(profile.reasoningEffort).toBeUndefined();
  });

  it('normalizes registry none effort to no runtime effort', () => {
    const profile = resolveAgentProfile({
      ...MOCK_REGISTRY,
      agents: MOCK_REGISTRY.agents.map((entry) => entry.agent_id === 'product-manager'
        ? { ...entry, reasoning_effort: 'none' }
        : entry),
    }, 'alice');

    expect(profile.reasoningEffort).toBeUndefined();
  });

  it('resolves dalton-verify profile with its verification registry entry', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton-verify');
    expect(profile.id).toBe('dalton-verify');
    expect(profile.registryId).toBe('software-engineer-verify');
    expect(profile.displayName).toBe('Dalton (Verify)');
    expect(profile.role).toBe('Verification Engineer');
    expect(profile.requiredModel).toBe('claude-sonnet-4.6');
    expect(profile.autonomyProfile).toBe('repo-executor');
    expect(profile.workflowOrder).toBe(99);
    expect(profile.agentProfilePath).toBe('.github/agents/software-engineer-verify.md');
  });

  it('throws for agent not in registry', () => {
    expect(() => resolveAgentProfile(MOCK_REGISTRY, 'lily')).toThrow(
      /not found in registry/,
    );
  });
});

describe('resolveActiveModel', () => {
  it('returns profile.requiredModel (registry-authoritative, ignores env)', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(resolveActiveModel('dalton', profile)).toBe('gpt-4.1');
  });

  it('throws role-registry-model-missing when profile.requiredModel is empty', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    const missingModelProfile = { ...profile, requiredModel: '' };
    expect(() => resolveActiveModel('dalton', missingModelProfile)).toThrow(
      /role-registry-model-missing/,
    );
  });
});
