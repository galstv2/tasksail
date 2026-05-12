import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentId } from '../../core/types.js';

const readTextFile = vi.fn<(path: string) => Promise<string | null>>();
const resolveReinforcementContext = vi.fn();

vi.mock('../../core/index.js', () => ({
  readTextFile,
}));

vi.mock('../reinforcement.js', () => ({
  resolveReinforcementContext,
}));

const { buildReinforcementOverlay } = await import('../reinforcementOverlay.js');

describe('buildReinforcementOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveReinforcementContext.mockResolvedValue({
      status: 'available',
      reason: 'ok',
      injectionEnabled: true,
      contextFile: '/repo/.platform-state/runtime/reinforcement/software-engineer.md',
    });
    readTextFile.mockResolvedValue([
      '# Reinforcement Context',
      '',
      '- Status: available',
      '- Agent: software-engineer (Dalton)',
      '',
      '## Your Reward Standing',
      '',
      '- Lifetime Reward: 4,000',
      '- Streak Progress: 2 of 10 successful tasks toward your next reward checkpoint',
      '',
      '## Behavioral Guidance',
      '',
      '- Keep changes focused and validated.',
    ].join('\n'));
  });

  it('embeds available rendered context with role-local motivation', async () => {
    const overlay = await buildReinforcementOverlay({
      agentId: 'dalton' as AgentId,
      contextPackDir: '/ctx/pack-a',
      repoRoot: '/repo',
    });

    expect(resolveReinforcementContext).toHaveBeenCalledWith('dalton', '/ctx/pack-a', '/repo');
    expect(readTextFile).toHaveBeenCalledWith('/repo/.platform-state/runtime/reinforcement/software-engineer.md');
    expect(overlay).toContain('## Private Reinforcement Context');
    expect(overlay).toContain('private reinforcement context for your role only');
    expect(overlay).toContain('improve your own reward outcome');
    expect(overlay).toContain('Do not infer, request, compare, or rely on another agent');
    expect(overlay).toContain('# Reinforcement Context');
    expect(overlay).toContain('Keep changes focused and validated.');
  });

  it('returns no overlay when reinforcement is unavailable', async () => {
    resolveReinforcementContext.mockResolvedValue({
      status: 'unavailable',
      reason: 'No private data.',
      injectionEnabled: false,
    });

    await expect(buildReinforcementOverlay({
      agentId: 'alice' as AgentId,
      contextPackDir: '/ctx/pack-a',
      repoRoot: '/repo',
    })).resolves.toBe('');
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('returns no overlay when rendered context fails to load', async () => {
    readTextFile.mockRejectedValue(new Error('read failed'));

    await expect(buildReinforcementOverlay({
      agentId: 'ron' as AgentId,
      contextPackDir: '/ctx/pack-a',
      repoRoot: '/repo',
    })).resolves.toBe('');
  });

  it('returns no overlay for stale rendered context without a context file', async () => {
    resolveReinforcementContext.mockResolvedValue({
      status: 'available',
      reason: 'stale',
      injectionEnabled: true,
    });

    await expect(buildReinforcementOverlay({
      agentId: 'lily' as AgentId,
      contextPackDir: '/ctx/pack-a',
      repoRoot: '/repo',
    })).resolves.toBe('');
  });

  it('fails closed when forbidden shared or peer reward details appear', async () => {
    const forbiddenSamples = [
      'AgentWorkSpace/qmd/global/reinforcement/agent-rewards/software-engineer.md',
      'AgentWorkSpace/qmd/global/agent-rewards/software-engineer.md',
      'AgentWorkSpace/qmd/reinforcement/agent-rewards.json',
      'agent-rewards.json',
      'settlements.json',
      'Reward Pool: 12,000',
      'Unrewarded reward total: 5,000',
      'Peer reward total: 9,000',
      'per_agent_rewards: {"qa": 1}',
      'Last Settlement: settlement-1 — you earned 3,000',
      'private sidecar path',
    ];

    for (const sample of forbiddenSamples) {
      readTextFile.mockResolvedValueOnce([
        '# Reinforcement Context',
        '',
        '- Status: available',
        sample,
      ].join('\n'));

      await expect(buildReinforcementOverlay({
        agentId: 'dalton' as AgentId,
        contextPackDir: '/ctx/pack-a',
        repoRoot: '/repo',
      })).resolves.toBe('');
    }
  });

  it('uses the same rendered context resolver for all launch roles', async () => {
    for (const agentId of ['lily', 'alice', 'dalton', 'ron'] as AgentId[]) {
      await buildReinforcementOverlay({
        agentId,
        contextPackDir: '/ctx/pack-a',
        repoRoot: '/repo',
      });
    }

    expect(resolveReinforcementContext.mock.calls.map((call) => call[0])).toEqual([
      'lily',
      'alice',
      'dalton',
      'ron',
    ]);
  });
});

