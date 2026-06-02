import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

// ── contextPack.listRepoTree relativePath validation ──────────────────────────
//
// These tests focus on cross-OS path-safety for the shared validateRepoRelativePath
// validator as applied via contextPack.listRepoTree and contextPack.create.
// New cases only — existing listRepoTree tests remain in desktopContractValidators.test.ts.

const BASE_LIST_REPO_TREE = {
  action: 'contextPack.listRepoTree',
  payload: { repoLocalPath: '/home/user/repo' },
} as const;

describe('contextPack.listRepoTree relativePath — shared repo-relative validator', () => {
  it('accepts a simple forward-slash relative path', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src/app' },
      }),
    ).toEqual([]);
  });

  it('accepts a backslash-separated relative path (Windows-style segments)', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src\\app' },
      }),
    ).toEqual([]);
  });

  it('accepts a non-traversal name containing ".." (over-match guard)', () => {
    // "v1..draft" contains ".." but is not a ".." traversal segment; an
    // over-broad substring check would wrongly reject this valid name.
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'docs/v1..draft/notes.md' },
      }),
    ).toEqual([]);
  });

  it('accepts undefined (optional field)', () => {
    expect(validateDesktopActionRequest(BASE_LIST_REPO_TREE)).toEqual([]);
  });

  it('rejects POSIX absolute path (leading /)', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: '/src/app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects leading backslash', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: '\\src\\app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects Windows drive path (uppercase)', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'C:\\src\\app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects Windows drive path (mixed slash)', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'C:/src/app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects UNC-like path', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: '\\\\server\\share' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects path with .. traversal', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src/../app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects path with backslash .. traversal', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src\\..\\app' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects trailing forward slash', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src/app/' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects trailing backslash', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: 'src\\app\\' },
      }),
    ).toContain('payload.relativePath must be a repo-root-relative path without traversal.');
  });

  it('rejects empty string', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: '' },
      }),
    ).toContain('payload.relativePath must be a non-empty string.');
  });

  it('rejects whitespace-only string', () => {
    expect(
      validateDesktopActionRequest({
        ...BASE_LIST_REPO_TREE,
        payload: { ...BASE_LIST_REPO_TREE.payload, relativePath: '   ' },
      }),
    ).toContain('payload.relativePath must be a non-empty string.');
  });
});

// ── contextPack.create focusableAreas[].relativePath validation ───────────────

function buildCreateRequest(focusableAreas: unknown[]) {
  return {
    action: 'contextPack.create',
    payload: {
      contextPackDir: '/home/user/packs/my-pack',
      discoveryRoot: '/home/user/repo',
      mode: 'monolith',
      bootstrapAnswers: {
        contextPackId: 'my-pack',
        estateName: 'My Pack',
        repositories: [
          {
            repoRoot: '/home/user/repo',
            repoName: 'repo',
            repoId: 'repo',
            systemLayer: 'backend',
          },
        ],
        focusableAreas,
      },
    },
  };
}

describe('contextPack.create focusableAreas[].relativePath — path-safety validation', () => {
  it('accepts a focus area with a valid repo-relative relativePath', () => {
    expect(
      validateDesktopActionRequest(
        buildCreateRequest([{ relativePath: 'src/app', focusId: 'app' }]),
      ),
    ).toEqual([]);
  });

  it('accepts a focus area identified by focusId only (no relativePath)', () => {
    expect(
      validateDesktopActionRequest(
        buildCreateRequest([{ focusId: 'core' }]),
      ),
    ).toEqual([]);
  });

  it('accepts a focus area identified by absolute path only', () => {
    expect(
      validateDesktopActionRequest(
        buildCreateRequest([{ path: '/home/user/repo/src' }]),
      ),
    ).toEqual([]);
  });

  it('rejects POSIX absolute relativePath', () => {
    const errors = validateDesktopActionRequest(
      buildCreateRequest([{ relativePath: '/src/app', focusId: 'app' }]),
    );
    expect(errors.some((e) => e.includes('relativePath') && e.includes('repo-root-relative'))).toBe(true);
  });

  it('rejects Windows drive relativePath', () => {
    const errors = validateDesktopActionRequest(
      buildCreateRequest([{ relativePath: 'C:\\src\\app', focusId: 'app' }]),
    );
    expect(errors.some((e) => e.includes('relativePath') && e.includes('repo-root-relative'))).toBe(true);
  });

  it('rejects leading backslash in relativePath', () => {
    const errors = validateDesktopActionRequest(
      buildCreateRequest([{ relativePath: '\\src\\app', focusId: 'app' }]),
    );
    expect(errors.some((e) => e.includes('relativePath') && e.includes('repo-root-relative'))).toBe(true);
  });

  it('rejects traversal in relativePath', () => {
    const errors = validateDesktopActionRequest(
      buildCreateRequest([{ relativePath: 'src/../app', focusId: 'app' }]),
    );
    expect(errors.some((e) => e.includes('relativePath') && e.includes('repo-root-relative'))).toBe(true);
  });

  it('rejects trailing slash in relativePath', () => {
    const errors = validateDesktopActionRequest(
      buildCreateRequest([{ relativePath: 'src/app/', focusId: 'app' }]),
    );
    expect(errors.some((e) => e.includes('relativePath') && e.includes('repo-root-relative'))).toBe(true);
  });
});
