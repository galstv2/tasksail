import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { AgentId } from '../../core/types.js';

const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: mockExistsSync };
});

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
  resolvePaths: vi.fn(),
  resolvePath: vi.fn(),
  ensurePathWithinDropbox: vi.fn(),
}));

import {
  resolveReinforcementContext,
  roleRequiresReinforcement,
} from '../reinforcement.js';

describe('roleRequiresReinforcement', () => {
  it('returns true for workflow agents', () => {
    expect(roleRequiresReinforcement('lily' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement('alice' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement('dalton' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement('ron' as AgentId)).toBe(true);
  });

  it('returns false for non-workflow agents', () => {
    expect(roleRequiresReinforcement('unknown-agent' as AgentId)).toBe(false);
  });
});

describe('resolveReinforcementContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available when per-agent .md exists', async () => {
    const agentMdPath = path.join(
      '/fake/repo', 'AgentWorkSpace', 'qmd', 'glopml', 'agent-rewards',
      'software-engineer.md',
    );

    mockExistsSync.mockImplementation((p: string) => p === agentMdPath);

    const result = await resolveReinforcementContext(
      'dalton' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result.status).toBe('available');
    expect(result.injectionEnabled).toBe(true);
    expect(result.contextFile).toBe(agentMdPath);
  });

  it('returns unavailable when per-agent .md absent', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await resolveReinforcementContext(
      'dalton' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result.status).toBe('unavailable');
    expect(result.injectionEnabled).toBe(false);
    expect(result.reason).toBe('No per-agent reward memory has been generated yet.');
  });

  it('returns not-applicable for non-reinforcement agents', async () => {
    const result = await resolveReinforcementContext(
      'unknown-agent' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result.status).toBe('not-applicable');
    expect(result.injectionEnabled).toBe(false);
  });

  it('returns unavailable when no context pack is set', async () => {
    const result = await resolveReinforcementContext(
      'dalton' as AgentId,
      undefined,
      '/fake/repo',
    );

    expect(result.status).toBe('unavailable');
    expect(result.injectionEnabled).toBe(false);
  });
});
