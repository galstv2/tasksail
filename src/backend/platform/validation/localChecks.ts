import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { findRepoRoot, isWindowsPlatform, runPython } from '../core/index.js';
import { validateStructure } from './structure.js';
import { checkFileSizes } from './fileSizes.js';
import { checkExternalMcpRegistry } from './externalMcpCheck.js';

const execFileAsync = promisify(execFile);

export type LocalChecksProfile = 'full' | 'smoke' | 'integration' | 'contracts';

export interface LocalChecksOptions {
  profile?: LocalChecksProfile;
  changedPath?: string;
  domain?: string;
  repoRoot?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface LocalChecksResult {
  passed: boolean;
  results: CheckResult[];
  advisoryWarnings: string[];
}

function runDesktopNpmCommand(
  args: string[],
  cwd: string,
): Promise<void> {
  if (isWindowsPlatform()) {
    const command = process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe';
    return execFileAsync(command, ['/d', '/s', '/c', 'npm', ...args], {
      cwd,
      timeout: 120_000,
    }).then(() => undefined);
  }

  return execFileAsync('npm', args, { cwd, timeout: 120_000 }).then(() => undefined);
}

async function timedCheck(
  name: string,
  fn: () => Promise<void>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, duration: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, passed: false, duration: Date.now() - start, error: message };
  }
}

async function runRuff(repoRoot: string): Promise<void> {
  try {
    await execFileAsync('ruff', ['--version'], { timeout: 5_000 });
  } catch {
    // ruff not installed, skip
    return;
  }
  await execFileAsync('ruff', ['check', '.'], { cwd: repoRoot, timeout: 60_000 });
}

async function runPytest(
  repoRoot: string,
  options: LocalChecksOptions,
): Promise<void> {
  if (options.profile === 'smoke') {
    await runPython(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'run-targeted-tests.py'),
      [
        '--manifest',
        path.join(repoRoot, 'tests', 'test_manifest.json'),
        '--lane',
        'smoke',
      ],
      { cwd: repoRoot, timeout: 300_000 },
    );
    return;
  }

  const testPath = options.domain
    ? `tests/domains/${options.domain}/`
    : 'tests/';

  await runPython('-m', ['pytest', testPath, '-v'], { cwd: repoRoot });
}

async function runDesktopTests(repoRoot: string): Promise<void> {
  const desktopDir = path.join(repoRoot, 'src', 'frontend', 'desktop');
  await runDesktopNpmCommand(['test'], desktopDir);
}

async function runDesktopBuild(repoRoot: string): Promise<void> {
  const desktopDir = path.join(repoRoot, 'src', 'frontend', 'desktop');
  await runDesktopNpmCommand(['run', 'build'], desktopDir);
}

/**
 * Determine which check categories are relevant for a changed path.
 * Returns flags indicating whether python and desktop checks should run.
 * Structure and file-size checks always run regardless.
 */
function resolveChangedPathScope(changedPath: string): { python: boolean; desktop: boolean } {
  const normalized = changedPath.replace(/\\/g, '/');
  if (normalized.startsWith('src/frontend/desktop/') || normalized.startsWith('src/frontend/desktop')) {
    return { python: false, desktop: true };
  }
  if (
    normalized.startsWith('src/backend/') ||
    normalized.startsWith('tests/') ||
    normalized.startsWith('src/backend') ||
    normalized.startsWith('tests')
  ) {
    return { python: true, desktop: false };
  }
  // docs, config, or unknown — run everything
  return { python: true, desktop: true };
}

export async function runLocalChecks(
  options?: LocalChecksOptions,
): Promise<LocalChecksResult> {
  const opts = options ?? {};
  const profile = opts.profile ?? 'full';
  const root = opts.repoRoot ?? await findRepoRoot();
  const results: CheckResult[] = [];

  const scope = opts.changedPath
    ? resolveChangedPathScope(opts.changedPath)
    : { python: true, desktop: true };

  // Structure validation runs for all profiles
  results.push(await timedCheck('structure', async () => {
    const r = await validateStructure(root);
    if (!r.valid) throw new Error(r.errors.join('\n'));
  }));

  // File size check runs for all profiles
  results.push(await timedCheck('file-sizes', async () => {
    const r = await checkFileSizes(root);
    if (r.violations.length > 0) {
      const msgs = r.violations.map(
        v => `${v.path}: ${v.lines} lines (limit ${v.limit})`,
      );
      throw new Error(msgs.join('\n'));
    }
  }));

  // Python lint (ruff) — full and smoke, scoped by changedPath
  if ((profile === 'full' || profile === 'smoke') && scope.python) {
    results.push(await timedCheck('python-lint', () => runRuff(root)));
  }

  // Python tests — full, smoke, integration, scoped by changedPath
  if (profile !== 'contracts' && scope.python) {
    results.push(await timedCheck('python-tests', () => runPytest(root, opts)));
  }

  // Desktop tests — full and contracts, scoped by changedPath
  if ((profile === 'full' || profile === 'contracts') && scope.desktop) {
    results.push(await timedCheck('desktop-tests', () => runDesktopTests(root)));
    results.push(await timedCheck('desktop-build', () => runDesktopBuild(root)));
  }

  // External MCP registry validation — runs for full and smoke profiles.
  // Errors fail the check; stale agent scope references are advisory warnings.
  const advisoryWarnings: string[] = [];
  if (profile === 'full' || profile === 'smoke') {
    results.push(await timedCheck('external-mcp-registry', async () => {
      const r = await checkExternalMcpRegistry(root);
      if (!r.valid) throw new Error(r.errors.join('\n'));
      advisoryWarnings.push(...r.warnings);
    }));
  }

  const passed = results.every(r => r.passed);
  return { passed, results, advisoryWarnings };
}
