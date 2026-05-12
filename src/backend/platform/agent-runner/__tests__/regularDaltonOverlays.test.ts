import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTextFile = vi.fn<(path: string) => Promise<string | null>>();
const resolveConventionsContext = vi.fn();
const resolveCorrectionsContext = vi.fn();

vi.mock('../../core/index.js', () => ({
  readTextFile,
}));

vi.mock('../conventions.js', () => ({
  resolveConventionsContext,
}));

vi.mock('../corrections.js', () => ({
  resolveCorrectionsContext,
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
  });

  it('skips overlays whose content is unavailable and leaves reinforcement to launch code', async () => {
    readTextFile.mockImplementation(async (candidate: string) => {
      if (candidate === '/repo/.platform-state/runtime/context-pack-conventions.md') {
        return '# Conventions\nFollow the pack rules.';
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
    expect(prompt).not.toContain('### Reinforcement');
    expect(readTextFile).toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-conventions.md');
    expect(readTextFile).toHaveBeenCalledWith('/repo/.platform-state/runtime/context-pack-corrections.md');
  });
});
