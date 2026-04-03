import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  findRepoRoot,
  resolvePaths,
  resolvePath,
  ensurePathWithinDropbox,
} from '../paths.js';

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
    const paths = resolvePaths();
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
    const paths = resolvePaths('/tmp/test-repo');
    expect(paths.repoRoot).toBe('/tmp/test-repo');
    expect(paths.agentWorkSpace).toBe(
      path.join('/tmp/test-repo', 'AgentWorkSpace'),
    );
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
