import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkTestCountFloor, loadFloorManifest } from '../testCountFloor.js';

describe('loadFloorManifest', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcf-manifest-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('parses MIN_COUNT MODULE_PATH lines and skips comments, blanks, and malformed lines', async () => {
    const p = path.join(tmpDir, 'floor.txt');
    fs.writeFileSync(p, [
      '# a comment',
      '',
      '10 src/a/__tests__',
      '999 tests/domains/x',
      '   ',
      'malformed-no-count',
    ].join('\n'));

    const map = await loadFloorManifest(p);
    expect(map.size).toBe(2);
    expect(map.get('src/a/__tests__')).toBe(10);
    expect(map.get('tests/domains/x')).toBe(999);
  });

  it('returns an empty map for a missing manifest', async () => {
    const map = await loadFloorManifest(path.join(tmpDir, 'does-not-exist.txt'));
    expect(map.size).toBe(0);
  });
});

describe('checkTestCountFloor', () => {
  let repo: string;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tcf-repo-'));
    // listTrackedFiles uses `git ls-files --others`, so an initialized repo with
    // written-but-unstaged files is enough — no commit needed.
    execFileSync('git', ['init', '-q'], { cwd: repo });
  });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  function write(rel: string, content: string): void {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it('flags a Vitest module below its floor and passes one at/above', async () => {
    write('src/a/__tests__/x.test.ts', "it('one', () => {});\nit('two', () => {});\n");
    write('src/b/__tests__/y.test.tsx', "test('only', () => {});\n");
    const manifest = path.join(repo, 'floor.txt');
    fs.writeFileSync(manifest, ['2 src/a/__tests__', '3 src/b/__tests__'].join('\n'));

    const result = await checkTestCountFloor(repo, manifest);
    const counts = Object.fromEntries(result.modules.map(m => [m.module, m.count]));
    expect(counts['src/a/__tests__']).toBe(2);
    expect(counts['src/b/__tests__']).toBe(1);
    expect(result.violations).toEqual([{ module: 'src/b/__tests__', count: 1, floor: 3 }]);
  });

  it('counts pytest def/async-def test_ for tests/ modules and excludes it.each rows from Vitest counts', async () => {
    write('tests/domains/d/test_thing.py', 'def test_a():\n    pass\n\nasync def test_b():\n    pass\n');
    write('src/c/__tests__/z.test.ts', "it.each([1, 2])('row %s', () => {});\nit('real', () => {});\n");
    const manifest = path.join(repo, 'floor.txt');
    fs.writeFileSync(manifest, ['2 tests/domains/d', '1 src/c/__tests__'].join('\n'));

    const result = await checkTestCountFloor(repo, manifest);
    const counts = Object.fromEntries(result.modules.map(m => [m.module, m.count]));
    expect(counts['tests/domains/d']).toBe(2);
    expect(counts['src/c/__tests__']).toBe(1);
    expect(result.violations).toEqual([]);
  });

  it('does not let a sibling module satisfy another module’s floor (non-overlapping match)', async () => {
    write('src/m/__tests__/a.test.ts', "it('p', () => {});\n");
    write('src/m/sub/__tests__/b.test.ts', "it('c1', () => {});\nit('c2', () => {});\n");
    const manifest = path.join(repo, 'floor.txt');
    fs.writeFileSync(manifest, ['1 src/m/__tests__', '2 src/m/sub/__tests__'].join('\n'));

    const result = await checkTestCountFloor(repo, manifest);
    const counts = Object.fromEntries(result.modules.map(m => [m.module, m.count]));
    expect(counts['src/m/__tests__']).toBe(1);
    expect(counts['src/m/sub/__tests__']).toBe(2);
    expect(result.violations).toEqual([]);
  });
});
