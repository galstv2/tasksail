import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync,
  };
});

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveSelectedPrimaryRepoRoot,
}));

const { resolveTestCaptureCwd } = await import('../pipeline/testCapture.js');

describe('resolveTestCaptureCwd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReset();
    resolveSelectedPrimaryRepoRoot.mockReset();
  });

  it('uses the platform repo root when no context pack is active', async () => {
    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
    })).resolves.toBe('/platform');
  });

  it('uses the selected primary repo root when context-pack targeting is active without a monolith focus path', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
    });

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo');
  });

  it('uses the selected monolith focus subfolder when it exists on disk', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink',
    });
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/services/sink');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/services/sink');
  });

  it('returns undefined when the selected monolith focus subfolder is missing on disk', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink',
    });
    existsSync.mockReturnValue(false);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });

  it('returns undefined when the selected primary repo cannot be resolved', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });
});
