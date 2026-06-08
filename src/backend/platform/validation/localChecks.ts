import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { findRepoRoot, isWindowsPlatform, runPython, readEnvAssignment, PLACEHOLDER_MCP_TOKEN } from '../core/index.js';
import { getActiveProvider } from '../cli-provider/index.js';
import { validateStructure } from './structure.js';
import { checkFileSizes } from './fileSizes.js';
import { checkTestCountFloor } from './testCountFloor.js';
import { checkExternalMcpRegistry } from './externalMcpCheck.js';
import { validateMarkdownContract } from '../workflow-policy/contracts/markdownContract.js';
import {
  checkCommentDiscipline,
  type CommentDisciplineMode,
} from './commentDiscipline.js';
import { checkOpenSourceReadiness } from './openSourceReadiness.js';

const execFileAsync = promisify(execFile);

export type LocalChecksProfile = 'full' | 'smoke' | 'integration' | 'contracts';

export interface LocalChecksOptions {
  profile?: LocalChecksProfile;
  changedPath?: string;
  domain?: string;
  repoRoot?: string;
  comments?: boolean;
  commentMode?: CommentDisciplineMode;
  baseRef?: string;
  headRef?: string;
  staged?: boolean;
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

async function runDesktopNpmCommand(
  args: string[],
  cwd: string,
): Promise<void> {
  const logDir = await fs.mkdtemp(path.join(tmpdir(), 'tasksail-local-checks-logs-'));
  const env = { ...process.env, LOG_DIR: logDir };
  try {
    if (isWindowsPlatform()) {
      const command = process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe';
      await execFileAsync(command, ['/d', '/s', '/c', 'npm', ...args], {
        cwd,
        env,
        timeout: 120_000,
      });
      return;
    }

    await execFileAsync('npm', args, { cwd, env, timeout: 120_000 });
  } finally {
    await fs.rm(logDir, { recursive: true, force: true });
  }
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

export async function runMarkdownContractValidation(repoRoot: string): Promise<void> {
  validateMarkdownContract(path.join(repoRoot, 'config', 'markdown-contract.default.json'));
  await runPython(
    '-c',
    ['import sys, pathlib; sys.path.insert(0, str(pathlib.Path.cwd() / "src" / "backend" / "scripts" / "python")); from lib.markdown_contract import validate_markdown_contract; validate_markdown_contract()'],
    { cwd: repoRoot, timeout: 30_000 },
  );
}

async function runPytest(
  repoRoot: string,
  options: LocalChecksOptions,
): Promise<void> {
  const pythonEnv = {
    TASKSAIL_AGENT_REGISTRY_PATH: path.join(repoRoot, getActiveProvider(repoRoot).agentConfigPaths().registry),
  };

  if (options.profile === 'smoke') {
    await runPython(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'run-targeted-tests.py'),
      [
        '--manifest',
        path.join(repoRoot, 'tests', 'test_manifest.json'),
        '--lane',
        'smoke',
      ],
      { cwd: repoRoot, env: pythonEnv, timeout: 300_000 },
    );
    return;
  }

  const testPath = options.domain
    ? `tests/domains/${options.domain}/`
    : 'tests/';

  await runPython('-m', ['pytest', testPath, '-v'], { cwd: repoRoot, env: pythonEnv });
}

async function runDesktopTests(repoRoot: string): Promise<void> {
  const desktopDir = path.join(repoRoot, 'src', 'frontend', 'desktop');
  await runDesktopNpmCommand(['test'], desktopDir);
}

async function runDesktopCssColorTokenDiscipline(repoRoot: string): Promise<void> {
  const desktopDir = path.join(repoRoot, 'src', 'frontend', 'desktop');
  await runDesktopNpmCommand(['run', 'test:css-colors'], desktopDir);
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
  const advisoryWarnings: string[] = [];

  const scope = opts.changedPath
    ? resolveChangedPathScope(opts.changedPath)
    : { python: true, desktop: true };

  // Structure validation runs for all profiles
  results.push(await timedCheck('structure', async () => {
    const r = await validateStructure(root);
    if (!r.valid) throw new Error(r.errors.join('\n'));
  }));

  results.push(await timedCheck('markdown-contract', () => runMarkdownContractValidation(root)));

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

  // Env-file security (advisory): warn on a group/world-accessible .env or a
  // placeholder MCP token. Per-machine artifact — never fails the gate;
  // enforcement happens at `pnpm run setup`. Skipped when .env is absent (CI).
  results.push(await timedCheck('env-security', async () => {
    const envFile = path.join(root, '.env');
    let mode: number;
    try {
      const stat = await fs.stat(envFile);
      mode = stat.mode & 0o777;
    } catch {
      return; // no .env present — nothing to check
    }
    if (!isWindowsPlatform() && mode > 0o600) {
      advisoryWarnings.push(
        `.env is mode ${mode.toString(8)} (group/world-accessible); run: chmod 600 .env`,
      );
    }
    const token = await readEnvAssignment(envFile, 'REPO_CONTEXT_MCP_AUTH_TOKEN');
    if (token === PLACEHOLDER_MCP_TOKEN) {
      advisoryWarnings.push(
        'REPO_CONTEXT_MCP_AUTH_TOKEN is the public placeholder; run `pnpm run setup` to generate a secret',
      );
    }
  }));

  // Test-count floor check runs for all profiles as a coverage regression guard.
  results.push(await timedCheck('test-count-floor', async () => {
    const r = await checkTestCountFloor(root);
    if (r.violations.length > 0) {
      const msgs = r.violations.map(
        v => `${v.module}: ${v.count} tests (floor ${v.floor})`,
      );
      throw new Error(msgs.join('\n'));
    }
  }));

  results.push(await timedCheck('open-source-readiness', async () => {
    const r = await checkOpenSourceReadiness({ repoRoot: root });
    advisoryWarnings.push(...r.warnings);
    if (!r.valid) {
      throw new Error(r.errors.join('\n'));
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
    results.push(await timedCheck(
      'desktop-css-color-token-discipline',
      () => runDesktopCssColorTokenDiscipline(root),
    ));
    results.push(await timedCheck('desktop-tests', () => runDesktopTests(root)));
    results.push(await timedCheck('desktop-build', () => runDesktopBuild(root)));
  }

  // External MCP registry validation — runs for full and smoke profiles.
  // Errors fail the check; stale agent scope references are advisory warnings.
  if (profile === 'full' || profile === 'smoke') {
    results.push(await timedCheck('external-mcp-registry', async () => {
      const r = await checkExternalMcpRegistry(root);
      if (!r.valid) throw new Error(r.errors.join('\n'));
      advisoryWarnings.push(...r.warnings);
    }));
  }

  if (opts.comments) {
    results.push(await timedCheck('comment-discipline', async () => {
      const mode = opts.commentMode
        ?? (opts.staged || opts.baseRef || opts.headRef ? 'changed' : 'report');
      const r = await checkCommentDiscipline({
        repoRoot: root,
        mode,
        staged: opts.staged,
        baseRef: opts.baseRef,
        headRef: opts.headRef,
      });
      advisoryWarnings.push(...r.advisory.map(
        (finding) => `${finding.path}:${finding.line}: ${finding.ruleId}: ${finding.message}`,
      ));
      if (!r.valid) {
        throw new Error(r.errors.join('\n'));
      }
    }));
  }

  const passed = results.every(r => r.passed);
  return { passed, results, advisoryWarnings };
}
