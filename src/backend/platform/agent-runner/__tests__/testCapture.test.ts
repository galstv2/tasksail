import { describe, expect, it, vi } from 'vitest';

const resolveSelectedPrimaryRepoRoot = vi.fn();

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveSelectedPrimaryRepoRoot,
}));

const { resolveTestCaptureCwd } = await import('../pipeline/testCapture.js');

describe('resolveTestCaptureCwd', () => {
  it('uses the platform repo root when no context pack is active', async () => {
    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
    })).resolves.toBe('/platform');
  });

  it('uses the selected primary repo root when context-pack targeting is active', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
    });

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo');
  });

  it('returns undefined when the selected primary repo cannot be resolved', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });
});
