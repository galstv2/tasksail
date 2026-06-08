import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { findRepoRoot, isWindowsPlatform, readTextFile } from '../core/index.js';
import { FILE_SIZE_LIMITS, REFACTOR_THRESHOLD, loadBaseline } from './fileSizes.js';
import { checkCommentDiscipline } from './commentDiscipline.js';

const execFileAsync = promisify(execFile);
const DESKTOP_RENDERER_STYLES_PREFIX = 'src/frontend/desktop/src/renderer/styles/';

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

export function stagedFilesRequireDesktopCssColorGate(stagedFiles: string[]): boolean {
  return stagedFiles.some((file) => {
    const normalized = file.replace(/\\/g, '/');
    return normalized.startsWith(DESKTOP_RENDERER_STYLES_PREFIX)
      && normalized.endsWith('.css')
      && path.basename(normalized) !== 'variables.css';
  });
}

async function runDesktopCssColorGate(root: string): Promise<void> {
  const desktopDir = path.join(root, 'src', 'frontend', 'desktop');
  if (isWindowsPlatform()) {
    const command = process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe';
    await execFileAsync(command, ['/d', '/s', '/c', 'npm', 'run', 'test:css-colors'], {
      cwd: desktopDir,
      timeout: 120_000,
    });
    return;
  }

  await execFileAsync('npm', ['run', 'test:css-colors'], {
    cwd: desktopDir,
    timeout: 120_000,
  });
}

function formatCommandFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const commandOutput = [
    'stderr' in err && typeof err.stderr === 'string' ? err.stderr.trim() : '',
    'stdout' in err && typeof err.stdout === 'string' ? err.stdout.trim() : '',
  ].filter(Boolean);
  return [err.message, ...commandOutput].filter(Boolean).join('\n');
}

export async function preCommitHook(repoRoot?: string): Promise<PreCommitResult> {
  const root = repoRoot ?? await findRepoRoot();
  const stagedFiles = await getGitStagedFiles(root);
  const failures: string[] = [];

  // Canonical baseline location — must match the path used by
  // `checkFileSizes` in `fileSizes.ts`. Diverging here would silently make
  // the hook ignore per-file baselines and fall back to the raw default
  // limits, which is what every file gets compared against when this path
  // doesn't resolve.
  const defaultBaseline = path.join(
    root, 'src', 'backend', 'platform', 'validation', 'data', 'file-size-baseline.txt',
  );
  const baseline = await loadBaseline(defaultBaseline);

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

    const baselineMax = baseline.get(file);
    const effectiveMax = baselineMax ?? limit;
    const refactorLimit = Math.floor(effectiveMax * REFACTOR_THRESHOLD);

    if (lines > refactorLimit) {
      failures.push(
        `${file}: ${lines} lines (>= 50% over ${baselineMax !== undefined ? 'baseline' : 'limit'} ${effectiveMax}, threshold ${refactorLimit})`,
      );
    }
  }

  if (stagedFilesRequireDesktopCssColorGate(stagedFiles)) {
    try {
      await runDesktopCssColorGate(root);
    } catch (err) {
      failures.push(`desktop CSS color token discipline failed:\n${formatCommandFailure(err)}`);
    }
  }

  const commentResult = await checkCommentDiscipline({
    repoRoot: root,
    mode: 'changed',
    staged: true,
  });
  if (!commentResult.valid) {
    failures.push(
      [
        'comment discipline failed:',
        ...commentResult.errors.map((error) => `  ${error}`),
      ].join('\n'),
    );
  }

  return { passed: failures.length === 0, failures };
}
