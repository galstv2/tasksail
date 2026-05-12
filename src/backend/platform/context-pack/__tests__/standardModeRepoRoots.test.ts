import { describe, expect, it } from 'vitest';
import { deriveStandardModeReadonlyRepoRoots } from '../standardModeRepoRoots.js';

describe('deriveStandardModeReadonlyRepoRoots', () => {
  it('returns empty roots when primary or support repos are missing', () => {
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: undefined,
      supportRepos: [{ repoId: 'tools', repoRoot: '/repos/tools' }],
    })).toEqual([]);
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: '  ',
      supportRepos: [{ repoId: 'tools', repoRoot: '/repos/tools' }],
    })).toEqual([]);
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: 'platform',
      supportRepos: [],
    })).toEqual([]);
  });

  it('filters primary entries and empty roots', () => {
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: 'platform',
      supportRepos: [
        { repoId: 'platform', repoRoot: '/repos/platform' },
        { repoId: 'tools', repoRoot: '  ' },
      ],
    })).toEqual([]);
  });

  it('returns one whole-repo readonly root per non-primary support repo', () => {
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: 'platform',
      supportRepos: [
        { repoId: 'tools', repoRoot: '/repos/tools' },
        { repoId: 'shared-lib', repoRoot: '/repos/shared-lib' },
      ],
    })).toEqual([
      {
        repoLocalPath: '/repos/tools',
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
      {
        repoLocalPath: '/repos/shared-lib',
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
    ]);
  });

  it('dedupes support repo ids with first root winning', () => {
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: 'platform',
      supportRepos: [
        { repoId: 'tools', repoRoot: '/repos/tools' },
        { repoId: 'tools', repoRoot: '/repos/tools-copy' },
      ],
    })).toEqual([
      {
        repoLocalPath: '/repos/tools',
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
    ]);
  });

  it('trims repo ids before comparison and dedupe', () => {
    expect(deriveStandardModeReadonlyRepoRoots({
      primaryRepoId: ' platform ',
      supportRepos: [
        { repoId: ' platform ', repoRoot: '/repos/platform' },
        { repoId: ' tools ', repoRoot: '/repos/tools' },
        { repoId: 'tools', repoRoot: '/repos/tools-again' },
      ],
    })).toEqual([
      {
        repoLocalPath: '/repos/tools',
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
    ]);
  });
});
