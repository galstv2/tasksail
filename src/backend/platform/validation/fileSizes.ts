import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { findRepoRoot, readTextFile, getErrorMessage } from '../core/index.js';

const execFileAsync = promisify(execFile);

export const FILE_SIZE_LIMITS: Record<string, number> = {
  '.py': 500,
  '.sh': 1000,
  '.ts': 1000,
  '.tsx': 1000,
  '.css': 600,
};

export const REFACTOR_THRESHOLD = 1.5;

export interface Violation {
  path: string;
  lines: number;
  limit: number;
}

export interface Warning {
  path: string;
  lines: number;
  baseline: number;
}

export interface FileSizeResult {
  violations: Violation[];
  warnings: Warning[];
}

export async function loadBaseline(baselinePath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let content: string;
  try {
    content = (await readTextFile(baselinePath)) ?? '';
  } catch {
    return map;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;
    const maxLines = parseInt(trimmed.slice(0, spaceIdx), 10);
    const filePath = trimmed.slice(spaceIdx + 1).trim();
    if (!isNaN(maxLines) && filePath) {
      map.set(filePath, maxLines);
    }
  }

  return map;
}

function getLimitForFile(filePath: string): number {
  const ext = path.extname(filePath);
  return FILE_SIZE_LIMITS[ext] ?? 0;
}

async function countLines(filePath: string): Promise<number> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content.split('\n').length;
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
    process.stderr.write(`Warning: git ls-files failed: ${getErrorMessage(err)}\n`);
    return [];
  }
}

export async function checkFileSizes(
  repoRoot?: string,
  baselinePath?: string,
): Promise<FileSizeResult> {
  const root = repoRoot ?? await findRepoRoot();
  const defaultBaseline = path.join(root, 'src', 'backend', 'platform', 'validation', 'data', 'file-size-baseline.txt');
  const baseline = await loadBaseline(baselinePath ?? defaultBaseline);

  const violations: Violation[] = [];
  const warnings: Warning[] = [];

  const files = await listTrackedFiles(root);
  const relevantExtensions = new Set(Object.keys(FILE_SIZE_LIMITS));

  for (const file of files) {
    const ext = path.extname(file);
    if (!relevantExtensions.has(ext)) continue;

    const fullPath = path.join(root, file);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      // Expected for deleted/staged files not yet on disk
      continue;
    }

    const lines = await countLines(fullPath);
    const limit = getLimitForFile(file);
    if (limit === 0) continue;

    const baselineMax = baseline.get(file);

    if (baselineMax !== undefined) {
      const refactorLimit = Math.floor(baselineMax * REFACTOR_THRESHOLD);
      if (lines > refactorLimit) {
        violations.push({ path: file, lines, limit: refactorLimit });
      } else if (lines > baselineMax) {
        warnings.push({ path: file, lines, baseline: baselineMax });
      } else if (lines > limit) {
        warnings.push({ path: file, lines, baseline: baselineMax });
      }
    } else {
      const refactorLimit = Math.floor(limit * REFACTOR_THRESHOLD);
      if (lines > refactorLimit) {
        violations.push({ path: file, lines, limit: refactorLimit });
      } else if (lines > limit) {
        warnings.push({ path: file, lines, baseline: limit });
      }
    }
  }

  return { violations, warnings };
}
