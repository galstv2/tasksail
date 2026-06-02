// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn() })),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

import { executeContextPackDiscoveryAction } from './discovery';

describe('context-pack discovery normalization', () => {
  const message =
    'repo web does not have .git folder, if you would like it part of this context pack please initialize git in this repo.';

  const run = (extra: Record<string, unknown>) =>
    executeContextPackDiscoveryAction(
      { rootPath: '/tmp/estate-root', mode: 'distributed' },
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          discovery_mode: 'distributed',
          estate_type: 'distributed',
          warnings: [],
          candidate_repos: [],
          candidate_focus_areas: [],
          high_signal_paths: [],
          ...extra,
        }),
        stderr: '',
      }),
    );

  it('exposes snake_case skipped_repos_missing_git as camelCase skippedReposMissingGit', async () => {
    const result = await run({
      skipped_repos_missing_git: [
        { repo_name: 'web', path: '/tmp/estate-root/web', relative_path: 'web', message },
      ],
    });

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        skippedReposMissingGit: [
          { repoName: 'web', path: '/tmp/estate-root/web', relativePath: 'web', message },
        ],
      }),
    });
  });

  it('accepts an older discovery response without skipped_repos_missing_git', async () => {
    const result = await run({});

    expect(result.ok).toBe(true);
    expect(
      (result as { response: { skippedReposMissingGit?: unknown } }).response.skippedReposMissingGit,
    ).toEqual([]);
  });
});
