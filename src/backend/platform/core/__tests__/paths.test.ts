import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  findRepoRoot,
  resolvePaths,
  resolvePath,
  ensurePathWithinDropbox,
  isPathInsideOrEqual,
  isPathWithinBoundary,
  relativePathEscapes,
  pathIdentityKey,
  samePathIdentity,
} from '../paths.js';

describe('relativePathEscapes', () => {
  it('SEC-TS-04: flags relative paths that escape via ..', () => {
    expect(relativePathEscapes('../../outside')).toBe(true);
    expect(relativePathEscapes('..')).toBe(true);
    expect(relativePathEscapes('a/../../b')).toBe(true);
  });
  it('passes absolute and contained-relative paths', () => {
    expect(relativePathEscapes('/etc/passwd')).toBe(false);
    expect(relativePathEscapes('contextpacks/mypack')).toBe(false);
    expect(relativePathEscapes('./local')).toBe(false);
    expect(relativePathEscapes('a/b/c')).toBe(false);
    expect(relativePathEscapes('a/../b')).toBe(false);
  });
});

describe('findRepoRoot', () => {
  it('finds the repo root from the current directory', () => {
    const root = findRepoRoot();
    expect(root).toBeTruthy();
    expect(path.isAbsolute(root)).toBe(true);
  });

  it('finds the repo root from a nested directory', () => {
    const root = findRepoRoot(path.join(process.cwd(), 'packages', 'platform-core'));
    expect(root).toBeTruthy();
  });

  it('throws when no .git directory is found', () => {
    expect(() => findRepoRoot('/')).toThrow('Could not find repo root');
  });
});

describe('resolvePaths', () => {
  it('returns all expected path keys', () => {
    const paths = resolvePaths({ taskId: 'smoke-task' });
    expect(paths.repoRoot).toBeTruthy();
    expect(paths.agentWorkSpace).toContain('AgentWorkSpace');
    expect(paths.dropbox).toContain('dropbox');
    expect(paths.pendingItems).toContain('pendingitems');
    expect(paths.handoffs).toContain('handoffs');
    expect(paths.templates).toContain('templates');
    expect(paths.implementationSteps).toContain('ImplementationSteps');
    expect(paths.qmd).toContain('qmd');
    expect(paths.platformState).toContain('.platform-state');
    expect(paths.guardrails).toContain('guardrails');
  });

  it('uses provided repo root', () => {
    const paths = resolvePaths({ repoRoot: '/tmp/test-repo', taskId: 't1' });
    expect(paths.repoRoot).toBe('/tmp/test-repo');
    expect(paths.agentWorkSpace).toBe(
      path.join('/tmp/test-repo', 'AgentWorkSpace'),
    );
  });

  it('routes handoffs, implementationSteps, and taskRuntime under per-task paths', () => {
    const paths = resolvePaths({ repoRoot: '/tmp/test-repo', taskId: 't1' });
    expect(paths.handoffs).toBe(path.join('/tmp/test-repo', 'AgentWorkSpace', 'tasks', 't1', 'handoffs'));
    expect(paths.implementationSteps).toBe(path.join('/tmp/test-repo', 'AgentWorkSpace', 'tasks', 't1', 'ImplementationSteps'));
    expect(paths.taskRuntime).toBe(path.join('/tmp/test-repo', '.platform-state', 'runtime', 'tasks', 't1'));
  });

  it('does not affect dropbox, templates, qmd, or guardrails', () => {
    const base = resolvePaths({ repoRoot: '/tmp/test-repo', taskId: 'base-task' });
    const task = resolvePaths({ repoRoot: '/tmp/test-repo', taskId: 't1' });
    expect(task.dropbox).toBe(base.dropbox);
    expect(task.templates).toBe(base.templates);
    expect(task.qmd).toBe(base.qmd);
    expect(task.guardrails).toBe(base.guardrails);
  });

  it('requires taskId: omitting it is a runtime error (TypeScript enforces at compile time)', () => {
    // taskId is required — calling without it is a TypeScript compile-time error.
    // At runtime, the missing taskId causes path.join to throw a TypeError.
    // @ts-expect-error taskId is required
    expect(() => resolvePaths({ repoRoot: '/tmp/test-repo' })).toThrow(TypeError);
  });
});

describe('resolvePath', () => {
  it('returns absolute paths unchanged', () => {
    expect(resolvePath('/pmse', '/absolute/path')).toBe('/absolute/path');
  });

  it('resolves relative paths against pmse directory', () => {
    expect(resolvePath('/pmse', 'relative/path')).toBe(
      path.join('/pmse', 'relative', 'path'),
    );
  });

  it('strips leading ./ from relative paths', () => {
    expect(resolvePath('/pmse', './relative/path')).toBe(
      path.join('/pmse', 'relative', 'path'),
    );
  });
});

describe('ensurePathWithinDropbox', () => {
  it('accepts paths within the dropbox directory', () => {
    expect(() =>
      ensurePathWithinDropbox('/dropbox', '/dropbox/task.md'),
    ).not.toThrow();
  });

  it('accepts paths in subdirectories of dropbox', () => {
    expect(() =>
      ensurePathWithinDropbox('/dropbox', '/dropbox/drafts/task.md'),
    ).not.toThrow();
  });

  it('rejects paths outside the dropbox directory', () => {
    expect(() =>
      ensurePathWithinDropbox('/dropbox', '/other/task.md'),
    ).toThrow('must be written through dropbox');
  });
});

describe('isPathInsideOrEqual (POSIX shapes)', () => {
  const posix = { impl: path.posix };
  it('treats equal and descendant paths as inside', () => {
    expect(isPathInsideOrEqual('/root', '/root', posix)).toBe(true);
    expect(isPathInsideOrEqual('/root', '/root/pack/a', posix)).toBe(true);
  });
  it('treats prefix siblings and `..` escapes as outside', () => {
    expect(isPathInsideOrEqual('/root', '/rootother', posix)).toBe(false);
    expect(isPathInsideOrEqual('/root', '/root/../etc', posix)).toBe(false);
    expect(isPathInsideOrEqual('/root', '/other', posix)).toBe(false);
  });
});

describe('isPathInsideOrEqual (Windows shapes)', () => {
  const win = { impl: path.win32 };
  it('treats equal, descendant, mixed-separator, and UNC paths as inside', () => {
    expect(isPathInsideOrEqual('C:\\root', 'C:\\root', win)).toBe(true);
    expect(isPathInsideOrEqual('C:\\root', 'C:\\root\\pack', win)).toBe(true);
    expect(isPathInsideOrEqual('C:\\root', 'C:/root/pack', win)).toBe(true);
    expect(isPathInsideOrEqual('\\\\server\\share', '\\\\server\\share\\x', win)).toBe(true);
  });
  it('ignores drive/segment casing for identity', () => {
    expect(isPathInsideOrEqual('C:\\Root', 'c:\\root\\pack', win)).toBe(true);
  });
  it('treats prefix siblings, cross-drive, and `..` escapes as outside', () => {
    expect(isPathInsideOrEqual('C:\\root', 'C:\\rootother', win)).toBe(false);
    expect(isPathInsideOrEqual('C:\\root', 'D:\\root\\pack', win)).toBe(false);
    expect(isPathInsideOrEqual('C:\\root', 'C:\\root\\..\\x', win)).toBe(false);
  });
});

describe('isPathWithinBoundary delegates to the hardened check', () => {
  it('no longer treats a prefix sibling as inside (regression guard)', () => {
    // path.resolve on the host normalizes these; a prefix sibling must be rejected.
    expect(isPathWithinBoundary('/srv/app', '/srv/app-extra')).toBe(false);
    expect(isPathWithinBoundary('/srv/app', '/srv/app/sub')).toBe(true);
    expect(isPathWithinBoundary('/srv/app', '/srv/app')).toBe(true);
  });
});

describe('pathIdentityKey / samePathIdentity', () => {
  it('case-folds on Windows but preserves POSIX case sensitivity', () => {
    expect(pathIdentityKey('C:\\Repo\\Pack', { impl: path.win32 })).toBe(
      pathIdentityKey('c:\\repo\\pack', { impl: path.win32 }),
    );
    expect(pathIdentityKey('/Repo/Pack', { impl: path.posix })).not.toBe(
      pathIdentityKey('/repo/pack', { impl: path.posix }),
    );
  });

  it('samePathIdentity matches Windows drive/segment casing, rejects siblings', () => {
    expect(samePathIdentity('C:\\Repo', 'c:\\repo', { impl: path.win32 })).toBe(true);
    expect(samePathIdentity('C:\\Repo', 'C:\\Repo2', { impl: path.win32 })).toBe(false);
    expect(samePathIdentity('/repo', '/repo', { impl: path.posix })).toBe(true);
    expect(samePathIdentity('/repo', '/Repo', { impl: path.posix })).toBe(false);
  });

  it('does not mutate the input value (identity key is comparison-only)', () => {
    const original = 'C:\\Repo\\Pack';
    pathIdentityKey(original, { impl: path.win32 });
    expect(original).toBe('C:\\Repo\\Pack');
  });
});
