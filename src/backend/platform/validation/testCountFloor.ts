import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { createLogger, findRepoRoot, readTextFile, getErrorMessage } from '../core/index.js';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/validation/testCountFloor');

// Test-declaration patterns matching the counting convention used to seed the floor
// manifest: `it(` / `test(` for Vitest, `def test_` for pytest.
// `it.each(` is intentionally NOT matched — the floor counts declared cases, not rows.
const TS_TEST_RE = /^\s*(it|test)\(/;
const PY_TEST_RE = /^\s*(?:async\s+)?def\s+test_/;

export interface FloorViolation {
  module: string;
  count: number;
  floor: number;
}

export interface ModuleCount {
  module: string;
  count: number;
  floor: number;
}

export interface TestCountFloorResult {
  violations: FloorViolation[];
  modules: ModuleCount[];
}

export async function loadFloorManifest(manifestPath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let content: string;
  try {
    content = (await readTextFile(manifestPath)) ?? '';
  } catch {
    return map;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;
    const minCount = parseInt(trimmed.slice(0, spaceIdx), 10);
    const modulePath = trimmed.slice(spaceIdx + 1).trim();
    if (!isNaN(minCount) && modulePath) {
      map.set(modulePath, minCount);
    }
  }

  return map;
}

function isPythonModule(modulePath: string): boolean {
  // Python pytest domains live under tests/; everything else is Vitest (.test.ts/.test.tsx).
  return modulePath.startsWith('tests/');
}

function isTestFileForModule(file: string, modulePath: string, python: boolean): boolean {
  if (file !== modulePath && !file.startsWith(modulePath + '/')) return false;
  return python
    ? file.endsWith('.py')
    : file.endsWith('.test.ts') || file.endsWith('.test.tsx');
}

async function countMatches(fullPath: string, re: RegExp): Promise<number> {
  const content = await fs.promises.readFile(fullPath, 'utf-8');
  let count = 0;
  for (const line of content.split('\n')) {
    if (re.test(line)) count += 1;
  }
  return count;
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: repoRoot },
    );
    return splitCommandOutputLines(stdout);
  } catch (err: unknown) {
    log.warn('git.ls_files.failed', { error: getErrorMessage(err) });
    return [];
  }
}

/**
 * The high-signal test-count floor: each listed module must retain at least its
 * recorded number of test declarations. A count below the floor fails the check —
 * lowering a floor is a deliberate manifest edit, exactly as growing a baselined file
 * size is. This regression guard catches accidental
 * coverage loss and makes any intentional reduction explicit and reviewable.
 */
export async function checkTestCountFloor(
  repoRoot?: string,
  manifestPath?: string,
): Promise<TestCountFloorResult> {
  const root = repoRoot ?? findRepoRoot();
  const defaultManifest = path.join(root, 'src', 'backend', 'platform', 'validation', 'data', 'test-count-floor.txt');
  const floors = await loadFloorManifest(manifestPath ?? defaultManifest);

  const files = await listTrackedFiles(root);
  const violations: FloorViolation[] = [];
  const modules: ModuleCount[] = [];

  for (const [modulePath, floor] of floors) {
    const python = isPythonModule(modulePath);
    const re = python ? PY_TEST_RE : TS_TEST_RE;

    let count = 0;
    for (const file of files) {
      if (!isTestFileForModule(file, modulePath, python)) continue;
      const fullPath = path.join(root, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile()) continue;
      } catch {
        // Expected for deleted/staged files not yet on disk.
        continue;
      }
      count += await countMatches(fullPath, re);
    }

    modules.push({ module: modulePath, count, floor });
    if (count < floor) {
      violations.push({ module: modulePath, count, floor });
    }
  }

  return { violations, modules };
}
