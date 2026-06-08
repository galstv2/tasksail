import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCommentDiscipline } from '../commentDiscipline.js';

const execFileAsync = promisify(execFile);

describe('checkCommentDiscipline', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comment-discipline-'));
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('does not flag comment-looking text inside TypeScript strings, templates, regex, or JSX text', async () => {
    await writeFile('src/frontend/desktop/src/renderer/App.tsx', [
      'const text = "Phase 2: not a comment";',
      'const tpl = `// --------`;',
      'const re = /\\/\\/ TODO nope/;',
      'export function App() { return <div>{"// Phase 2: text"}</div>; }',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(true);
    expect([...result.violations, ...result.advisory]).toEqual([]);
  });

  it('does not re-tokenize glob markers inside line comments as block comments', async () => {
    await writeFile('src/backend/platform/queue/example.ts', [
      '// The glob src/**/*.ts is prose, not a nested block comment.',
      'export const value = 1;',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(true);
    expect([...result.violations, ...result.advisory]).toEqual([]);
  });

  it('does not flag comment-looking text inside Python strings', async () => {
    await writeFile('src/backend/scripts/python/example.py', [
      'value = "Phase 2: not a comment"',
      'doc = """',
      '# --------',
      '"""',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(true);
    expect([...result.violations, ...result.advisory]).toEqual([]);
  });

  it('skips directives, shebangs, encoding comments, licenses, and protocol markers', async () => {
    await writeFile('src/backend/platform/queue/example.ts', [
      '// @ts-expect-error legacy fixture',
      '// eslint-disable-next-line no-console',
      '// Copyright 2026 TaskSail',
      '// tasksail: protocol-output',
      'const value = 1;',
    ].join('\n'));
    await writeFile('src/backend/scripts/python/example.py', [
      '#!/usr/bin/env python3',
      '# coding: utf-8',
      '# noqa: E501',
      '# type: ignore[arg-type]',
      'value = 1',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails deterministic hard rules and leaves TODO/narration advisory', async () => {
    await writeFile('src/backend/platform/queue/example.ts', [
      '// ----------',
      '// Phase 2: path checks.',
      '// const disabled = true;',
      '// TODO clean this up',
      '// Set the value.',
      'export const value = 1;',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.ruleId)).toEqual([
      'comment.decorative-separator',
      'comment.process-reference-label',
      'comment.disabled-source',
    ]);
    expect(result.advisory.map((item) => item.ruleId)).toEqual(expect.arrayContaining([
      'comment.todo-format',
      'comment.obvious-narration',
    ]));
  });

  it('does not treat prose beginning with code words as disabled source', async () => {
    await writeFile('src/backend/platform/queue/example.ts', [
      "// return 'already-running'. This explains lifecycle ordering.",
      '// .test(filePath) is mentioned as prose, not disabled code.',
      'export const value = 1;',
    ].join('\n'));
    await writeFile('src/backend/scripts/python/example.py', [
      '# with a "error:"-prefixed reason so callers can detect failure.',
      'value = 1',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('hard-fails excessive ordinary line comments but treats long JSDoc and docstrings as advisory', async () => {
    await writeFile('src/backend/platform/queue/example.ts', [
      '// one',
      '// two',
      '// three',
      '// four',
      '// five',
      '// six',
      '// seven',
      '/**',
      ` * ${Array.from({ length: 125 }, () => 'word').join(' ')}`,
      ' */',
      'export const value = 1;',
    ].join('\n'));
    await writeFile('src/backend/scripts/python/example.py', [
      'def f():',
      `    """${Array.from({ length: 125 }, () => 'word').join(' ')}"""`,
      '    return 1',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'full' });

    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.ruleId)).toEqual(['comment.excessive-length']);
    expect(result.advisory.filter((item) => item.ruleId === 'comment.long-doc')).toHaveLength(2);
  });

  it('report mode stays valid even when hard findings exist', async () => {
    await writeFile('src/backend/platform/queue/example.ts', '// ----------\nexport const value = 1;\n');

    const result = await checkCommentDiscipline({ repoRoot, mode: 'report' });

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(1);
  });

  it('changed mode fails only when a hard violation intersects changed lines', async () => {
    await initGitRepo();
    await writeFile('src/backend/platform/queue/example.ts', [
      '// ----------',
      'export const value = 1;',
    ].join('\n'));
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await writeFile('src/backend/platform/queue/example.ts', [
      '// ----------',
      'export const value = 2;',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', baseRef: 'HEAD' });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('changed mode fails when editing inside an over-limit multiline comment token', async () => {
    await initGitRepo();
    await writeFile('src/backend/platform/queue/example.ts', [
      '/*',
      ...Array.from({ length: 15 }, (_, index) => ` * line ${index}`),
      ' */',
      'export const value = 1;',
    ].join('\n'));
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await writeFile('src/backend/platform/queue/example.ts', [
      '/*',
      ...Array.from({ length: 15 }, (_, index) => ` * edited line ${index}`),
      ' */',
      'export const value = 1;',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', baseRef: 'HEAD' });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ ruleId: 'comment.excessive-length' }),
    ]);
  });

  it('staged mode reads staged blobs and ignores unstaged bad comments', async () => {
    await initGitRepo();
    await writeFile('src/backend/platform/queue/example.ts', 'export const value = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await writeFile('src/backend/platform/queue/example.ts', [
      '// Phase 2: staged label.',
      'export const value = 2;',
    ].join('\n'));
    await git('add', 'src/backend/platform/queue/example.ts');
    await writeFile('src/backend/platform/queue/example.ts', [
      '// ----------',
      'export const value = 2;',
    ].join('\n'));

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', staged: true });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        ruleId: 'comment.process-reference-label',
        snippet: 'Phase 2: staged label.',
      }),
    ]);
  });

  it('staged mode handles CRLF and mixed Python and TSX paths', async () => {
    await initGitRepo();
    await writeFile('src/backend/scripts/python/example.py', 'value = 1\n');
    await writeFile('src/frontend/desktop/src/renderer/App.tsx', 'export const value = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await writeRawFile('src/backend/scripts/python/example.py', '# Phase 2: python label.\r\nvalue = 2\r\n');
    await writeRawFile('src/frontend/desktop/src/renderer/App.tsx', '// ----------\r\nexport const value = 2;\r\n');
    await git('add', '.');

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', staged: true });

    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => `${item.path}:${item.ruleId}`)).toEqual([
      'src/backend/scripts/python/example.py:comment.process-reference-label',
      'src/frontend/desktop/src/renderer/App.tsx:comment.decorative-separator',
    ]);
  });

  it('staged mode ignores deleted files', async () => {
    await initGitRepo();
    await writeFile('src/backend/platform/queue/example.ts', '// ----------\nexport const value = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await git('rm', 'src/backend/platform/queue/example.ts');

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', staged: true });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('staged mode checks renamed files at their new path', async () => {
    await initGitRepo();
    await writeFile('src/backend/platform/queue/oldName.ts', 'export const value = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await git('mv', 'src/backend/platform/queue/oldName.ts', 'src/backend/platform/queue/newName.ts');
    await writeFile('src/backend/platform/queue/newName.ts', [
      '// Phase 2: renamed file label.',
      'export const value = 2;',
    ].join('\n'));
    await git('add', '.');

    const result = await checkCommentDiscipline({ repoRoot, mode: 'changed', staged: true });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        path: 'src/backend/platform/queue/newName.ts',
        ruleId: 'comment.process-reference-label',
      }),
    ]);
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    await writeRawFile(relativePath, `${content.replace(/\n$/, '')}\n`);
  }

  async function writeRawFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  async function initGitRepo(): Promise<void> {
    await git('init');
    await git('config', 'user.email', 'test@example.invalid');
    await git('config', 'user.name', 'Test User');
  }

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: repoRoot });
  }
});
