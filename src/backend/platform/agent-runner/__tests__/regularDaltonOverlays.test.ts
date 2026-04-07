import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn<(path: string) => boolean>();
const readTextFile = vi.fn<(path: string) => Promise<string | null>>();
const resolveConventionsContext = vi.fn();
const resolveCorrectionsContext = vi.fn();
const resolveReinforcementContext = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync,
  };
});

vi.mock('../../core/index.js', () => ({
  readTextFile,
}));

vi.mock('../conventions.js', () => ({
  resolveConventionsContext,
}));

vi.mock('../corrections.js', () => ({
  resolveCorrectionsContext,
}));

vi.mock('../reinforcement.js', () => ({
  resolveReinforcementContext,
}));

const { formatRegularDaltonOverlaySections } = await import('../pipeline/regularDaltonOverlays.js');

describe('formatRegularDaltonOverlaySections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConventionsContext.mockResolvedValue({
      contextFile: '/repo/.platform-state/runtime/context-pack-conventions.md',
    });
    resolveCorrectionsContext.mockResolvedValue({
      contextFile: '/repo/.platform-state/runtime/context-pack-corrections.md',
    });
    resolveReinforcementContext.mockResolvedValue({
      contextFile: '/repo/AgentWorkSpace/qmd/global/agent-rewards/software-engineer.md',
    });
  });

  it('checks overlay existence before reading and skips missing overlays', async () => {
    existsSync.mockImplementation((candidate: string) => candidate !== '/repo/.platform-state/runtime/context-pack-corrections.md');
    readTextFile.mockImplementation(async (candidate: string) => {
      if (candidate === '/repo/.platform-state/runtime/context-pack-conventions.md') {
        return '# Conventions\nFollow the pack rules.';
      }
      if (candidate === '/repo/AgentWorkSpace/qmd/global/agent-rewards/software-engineer.md') {
        return '# Reinforcement\nKeep changes tightly scoped.';
      }
      return null;
    });

    const prompt = await formatRegularDaltonOverlaySections('/ctx/pack-a', '/repo');

    expect(prompt).toContain('## Behavioral Overlays');
    expect(prompt).toContain(
      'Supplemental behavioral guidance begins below. Apply these overlays in addition to the primary task content above.',
    );
    expect(prompt).toContain('---\n\n### Conventions');
    expect(prompt).toContain('### Conventions');
    expect(prompt).toContain('Follow the pack rules.');
    expect(prompt).not.toContain('### Corrections');
    expect(prompt).toContain('---\n\n### Reinforcement');
    expect(prompt).toContain('### Reinforcement');
    expect(prompt).toContain('Keep changes tightly scoped.');
    expect(existsSync).toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-conventions.md');
    expect(existsSync).toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-corrections.md');
    expect(existsSync).toHaveBeenCalledWith('/repo/AgentWorkSpace/qmd/global/agent-rewards/software-engineer.md');
    expect(readTextFile).toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-conventions.md');
    expect(readTextFile).toHaveBeenCalledWith('/repo/AgentWorkSpace/qmd/global/agent-rewards/software-engineer.md');
    expect(readTextFile).not.toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-corrections.md');
  });
});
