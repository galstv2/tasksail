import { describe, it, expect, afterEach } from 'vitest';
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
      wall_clock_timeout_s: 600,
      workflow_order: 4,
      allowed_dirs: ['src/', 'tests/', 'packages/'],
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
  it('maps dalton to software-engineer', () => {
    expect(toRegistryId('dalton')).toBe('software-engineer');
  });

  it('maps software-engineer pmck to dalton', () => {
    expect(fromRegistryId('software-engineer')).toBe('dalton');
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
    expect(profile.autonomyProfile).toBe('repo-executor');
    expect(profile.allowedDirs).toEqual(['src/', 'tests/', 'packages/']);
    expect(profile.denyRules).toEqual(['git add', 'git commit', 'git push', 'rm -rf']);
    expect(profile.workflowOrder).toBe(4);
  });

  it('resolves alice profile as artifact-author', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'alice');
    expect(profile.autonomyProfile).toBe('artifact-author');
    expect(profile.requiredModel).toBe('gpt-5.4');
  });

  it('throws for agent not in registry', () => {
    expect(() => resolveAgentProfile(MOCK_REGISTRY, 'lily')).toThrow(
      /not found in registry/,
    );
  });
});

describe('resolveActiveModel', () => {
  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ACTIVE_MODEL'];
    delete process.env['COPILOT_MODEL'];
  });

  it('returns env RUN_ROLE_AGENT_ACTIVE_MODEL when set', () => {
    process.env['RUN_ROLE_AGENT_ACTIVE_MODEL'] = 'override-model';
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(resolveActiveModel('dalton', profile)).toBe('override-model');
  });

  it('falls back to COPILOT_MODEL when active model not set', () => {
    process.env['COPILOT_MODEL'] = 'copilot-model';
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(resolveActiveModel('dalton', profile)).toBe('copilot-model');
  });

  it('falls back to profile.requiredModel when no env vars set', () => {
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(resolveActiveModel('dalton', profile)).toBe('gpt-4.1');
  });

  it('prioritizes RUN_ROLE_AGENT_ACTIVE_MODEL over COPILOT_MODEL', () => {
    process.env['RUN_ROLE_AGENT_ACTIVE_MODEL'] = 'primary';
    process.env['COPILOT_MODEL'] = 'secondary';
    const profile = resolveAgentProfile(MOCK_REGISTRY, 'dalton');
    expect(resolveActiveModel('dalton', profile)).toBe('primary');
  });
});
