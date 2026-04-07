import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { findRepoRoot, readTextFile } from '../core/index.js';
import { FILE_SIZE_LIMITS, REFACTOR_THRESHOLD, loadBaseline } from './fileSizes.js';

const execFileAsync = promisify(execFile);

export async function getGitStagedFiles(repoRoot?: string): Promise<string[]> {
  const root = repoRoot ?? await findRepoRoot();
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { cwd: root },
  );
  return splitCommandOutputLines(stdout);
}

export interface PreCommitResult {
  passed: boolean;
  failures: string[];
}

export async function preCommitHook(repoRoot?: string): Promise<PreCommitResult> {
  const root = repoRoot ?? await findRepoRoot();
  const stagedFiles = await getGitStagedFiles(root);
  const failures: string[] = [];

  const defaultBaseline = path.join(root, 'packages', 'validation', 'data', 'file-size-pmseline.txt');
  const pmseline = await loadBaseline(defaultBaseline);

  const relevantExtensions = new Set(Object.keys(FILE_SIZE_LIMITS));

  for (const file of stagedFiles) {
    const ext = path.extname(file);
    if (!relevantExtensions.has(ext)) continue;

    const fullPath = path.join(root, file);
    const content = (await readTextFile(fullPath)) ?? '';
    if (!content) continue;

    const lines = content.split('\n').length;
    const limit = FILE_SIZE_LIMITS[ext] ?? 0;
    if (limit === 0) continue;

    const pmselineMax = pmseline.get(file);
    const effectiveMax = pmselineMax ?? limit;
    const refactorLimit = Math.floor(effectiveMax * REFACTOR_THRESHOLD);

    if (lines > refactorLimit) {
      failures.push(
        `${file}: ${lines} lines (>= 50% over ${pmselineMax !== undefined ? 'pmseline' : 'limit'} ${effectiveMax}, threshold ${refactorLimit})`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}
