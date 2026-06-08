import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  buildTargetedTestEnv,
  buildTargetedTestArgs,
  discoverChangedFiles,
  parseChangedDomainArgs,
} from '../changedDomainFiles.js';

describe('discoverChangedFiles', () => {
  it('uses explicit changed paths when provided (trimmed + deduped, no git)', () => {
    let gitCalled = false;
    const files = discoverChangedFiles({
      cwd: '/repo',
      explicitPaths: [' a.py ', 'b.ts', 'a.py', ''],
      gitRunner: () => {
        gitCalled = true;
        return '';
      },
    });
    expect(files).toEqual(['a.py', 'b.ts']);
    expect(gitCalled).toBe(false);
  });

  it('runs git diff --name-only base..head via argv arrays and splits CRLF/LF', () => {
    const calls: string[][] = [];
    const files = discoverChangedFiles({
      cwd: '/repo',
      baseSha: 'BASE',
      headSha: 'HEAD',
      gitRunner: (args) => {
        calls.push(args);
        return 'x.py\r\ny.ts\n\n';
      },
    });
    expect(calls[0]).toEqual(['diff', '--name-only', 'BASE', 'HEAD']);
    expect(files).toEqual(['x.py', 'y.ts']);
  });

  it('returns empty when neither explicit paths nor base/head are given', () => {
    expect(discoverChangedFiles({ cwd: '/repo' })).toEqual([]);
  });
});

describe('buildTargetedTestArgs', () => {
  it('builds resolve-only args with repeatable --changed-path', () => {
    expect(
      buildTargetedTestArgs({ scriptPath: 's.py', manifestPath: 'm.json', changedFiles: ['a', 'b'], resolveOnly: true }),
    ).toEqual(['s.py', '--manifest', 'm.json', '--resolve-only', '--changed-path', 'a', '--changed-path', 'b']);
  });

  it('omits --resolve-only for the run phase', () => {
    expect(
      buildTargetedTestArgs({ scriptPath: 's.py', manifestPath: 'm.json', changedFiles: ['a'], resolveOnly: false }),
    ).toEqual(['s.py', '--manifest', 'm.json', '--changed-path', 'a']);
  });
});

describe('buildTargetedTestEnv', () => {
  it('passes the active provider registry path to Python test subprocesses', () => {
    const repoRoot = path.resolve('/workspace/tasksail');

    expect(buildTargetedTestEnv(repoRoot, { EXISTING: '1' })).toEqual({
      EXISTING: '1',
      TASKSAIL_AGENT_REGISTRY_PATH: path.join(repoRoot, '.github', 'agents', 'registry.json'),
    });
  });
});

describe('parseChangedDomainArgs', () => {
  it('parses base/head/manifest and repeatable changed-path', () => {
    expect(
      parseChangedDomainArgs([
        '--base-sha', 'B',
        '--head-sha', 'H',
        '--manifest', 'm.json',
        '--changed-path', 'a',
        '--changed-path', 'b',
      ]),
    ).toEqual({ baseSha: 'B', headSha: 'H', manifest: 'm.json', changedPaths: ['a', 'b'] });
  });

  it('defaults the manifest when not provided', () => {
    expect(parseChangedDomainArgs([]).manifest).toBe('tests/test_manifest.json');
  });
});
