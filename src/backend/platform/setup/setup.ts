import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { createLogger, findRepoRoot, ensureEnvFile, ensureDir, getErrorMessage } from '../core/index.js';
import { classifyPythonVersion, formatPythonVersion, resolveRuntimePython } from '../core/pythonResolver.js';
import { createRuntimeFromConfig } from '../container/runtime.js';
import { createSharedMcpComposeBootstrapEnv, sweepLegacyPortAllocationsOnce } from '../container/sharedMcp.js';
import { resolveDefaultComposeFile } from '../container/types.js';
import { seedMcpRegistry } from '../mcp-registry/index.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { seedPlatformConfig } from '../platform-config/seed.js';
import { resolveContainerRuntime } from '../platform-config/resolve.js';
import { seedDeepFocusIgnoreConfig } from '../deep-focus-ignore/seed.js';
import { runEnterpriseMirrorsStep } from './enterpriseMirrors.js';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/setup/setup');

export type PlatformOS = 'darwin' | 'linux' | 'win32';

export function detectOS(): PlatformOS {
  return process.platform as PlatformOS;
}

export interface SetupOptions {
  repoRoot?: string;
  skipContainerServices?: boolean;
  /** @deprecated Use skipContainerServices instead. */
  skipDocker?: boolean;
}

export interface SetupResult {
  os: PlatformOS;
  steps: { name: string; status: 'ok' | 'skipped' | 'failed'; message?: string }[];
}

async function configureGitHooks(repoRoot: string): Promise<string> {
  try {
    await execFileAsync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: repoRoot,
    });
    return 'ok';
  } catch (err: unknown) {
    log.warn('git_hooks.configure.failed', { error: getErrorMessage(err) });
    return 'failed';
  }
}

async function markRuntimeFilesSkipWorktree(repoRoot: string): Promise<string> {
  try {
    const trackedPaths = new Set<string>(['tasksail.code-workspace']);
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', 'AgentWorkSpace/'],
      { cwd: repoRoot },
    );
    for (const file of splitCommandOutputLines(stdout)) {
      if (file.startsWith('AgentWorkSpace/templates/')) continue;
      trackedPaths.add(file);
    }
    const files = [...trackedPaths];
    if (files.length > 0) {
      await execFileAsync(
        'git',
        ['update-index', '--skip-worktree', ...files],
        { cwd: repoRoot },
      );
    }
    return 'ok';
  } catch (err: unknown) {
    log.warn('skip_worktree.failed', { error: getErrorMessage(err) });
    return 'failed';
  }
}

export async function assertPythonOnPath(repoRoot?: string): Promise<void> {
  let resolved;
  try {
    resolved = resolveRuntimePython({ repoRoot });
  } catch {
    log.error('python.missing', {
      message: 'container_runtime is set to "direct", but no usable Python interpreter was found. Install Python 3.12+ (Windows: `py -3.12` or `python`), or set TASKSAIL_PYTHON_312_BIN / TASKSAIL_PYTHON_BIN / PYTHON_BIN.',
    });
    process.exit(1);
  }

  const classification = classifyPythonVersion(resolved.version);
  if (classification === 'reject') {
    log.error('python.version_too_old', {
      message: `container_runtime is set to "direct", but the resolved Python interpreter (${resolved.candidate.source}: "${resolved.candidate.bin}") is ${formatPythonVersion(resolved.version)}; Python 3.12 is the minimum. Install Python 3.12+ (Windows: \`py -3.12\` or \`python\`), or set TASKSAIL_PYTHON_312_BIN / TASKSAIL_PYTHON_BIN / PYTHON_BIN to a Python 3.12+ interpreter.`,
    });
    process.exit(1);
  }
  if (classification === 'compatible') {
    log.warn('python.compatible_fallback', {
      message: `Using compatible fallback Python ${formatPythonVersion(resolved.version)} from ${resolved.candidate.source}; Python 3.12 is preferred.`,
    });
  }
}

export async function startContainerServices(repoRoot: string): Promise<string> {
  try {
    const runtime = await createRuntimeFromConfig(repoRoot);
    if (!runtime.requiresComposeFile) {
      const { ensureSharedMcpRunning } = await import('../container/sharedMcp.js');
      await ensureSharedMcpRunning(repoRoot);
      return 'ok';
    }

    const composeFileRel = resolveDefaultComposeFile(runtime.backend);
    if (composeFileRel === undefined) {
      return 'skipped';
    }
    const composeFile = path.join(repoRoot, composeFileRel);
    if (!fs.existsSync(composeFile)) {
      return 'skipped';
    }

    // Pass the same merged compose env as bootstrap so a repo .env
    // TASKSAIL_PYTHON_BASE_IMAGE override is not bypassed by pnpm run setup.
    const config = await getPlatformConfig(repoRoot);
    const composeEnv = await createSharedMcpComposeBootstrapEnv(config.mcp_port, repoRoot);
    await sweepLegacyPortAllocationsOnce(repoRoot);
    await runtime.composeUp({
      composeFile,
      detach: true,
      build: true,
      env: composeEnv,
    });

    return 'ok';
  } catch (err: unknown) {
    try {
      log.warn('container_services.start.failed', { error: getErrorMessage(err) });
    } catch {
      // Setup may be exercised before a repository root exists; service startup still reports failure.
    }
    return 'failed';
  }
}

export async function setupRepo(options?: SetupOptions): Promise<SetupResult> {
  const root = options?.repoRoot ?? await findRepoRoot();
  const skipContainerServices = options?.skipContainerServices ?? options?.skipDocker ?? false;
  const os = detectOS();
  const steps: SetupResult['steps'] = [];

  // 1. Detect OS
  steps.push({ name: 'detect-os', status: 'ok', message: os });

  // 2. Ensure .env from .env.example
  try {
    await ensureEnvFile(root);
    steps.push({ name: 'ensure-env', status: 'ok' });
  } catch (err) {
    steps.push({
      name: 'ensure-env',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Apply enterprise mirror config (after ensure-env, before platform-config-seed)
  try {
    steps.push(await runEnterpriseMirrorsStep(root));
  } catch (err) {
    steps.push({
      name: 'enterprise-mirrors',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Seed platform config
  try {
    const platformSeedResult = await seedPlatformConfig(root);
    if (platformSeedResult.action !== 'failed' && await resolveContainerRuntime(root) === 'direct') {
      await assertPythonOnPath(root);
    }
    steps.push({
      name: 'platform-config-seed',
      status: platformSeedResult.action === 'failed' ? 'failed' : 'ok',
      message: platformSeedResult.action,
    });
  } catch (err) {
    steps.push({
      name: 'platform-config-seed',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Configure git hooks
  const hookStatus = await configureGitHooks(root);
  steps.push({
    name: 'git-hooks',
    status: hookStatus as 'ok' | 'failed',
    message: hookStatus === 'ok' ? 'core.hooksPath set to .githooks' : undefined,
  });

  // 5. Create queue directories
  const queueDirs = [
    path.join(root, 'AgentWorkSpace', 'dropbox'),
    path.join(root, 'AgentWorkSpace', 'pendingitems'),
    path.join(root, 'AgentWorkSpace', 'tasks'),
  ];
  try {
    for (const dir of queueDirs) {
      await ensureDir(dir);
    }
    // Seed .gitkeep so AgentWorkSpace/tasks/ is tracked on a fresh clone
    // before any task has been activated (prevents pnpm run validate failures).
    const tasksGitkeep = path.join(root, 'AgentWorkSpace', 'tasks', '.gitkeep');
    if (!fs.existsSync(tasksGitkeep)) {
      await fs.promises.writeFile(tasksGitkeep, '');
    }
    steps.push({ name: 'queue-dirs', status: 'ok' });
  } catch (err) {
    steps.push({
      name: 'queue-dirs',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Seed MCP registry
  try {
    const seedResult = await seedMcpRegistry(root);
    steps.push({
      name: 'mcp-registry-seed',
      status: seedResult.action === 'failed' ? 'failed' : 'ok',
      message: seedResult.action,
    });
  } catch (err) {
    steps.push({
      name: 'mcp-registry-seed',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 7. Seed Deep Focus ignore config
  try {
    const seedResult = await seedDeepFocusIgnoreConfig(root);
    steps.push({
      name: 'deep-focus-ignore-seed',
      status: seedResult.action === 'failed' ? 'failed' : 'ok',
      message: seedResult.action === 'failed' ? seedResult.error : seedResult.action,
    });
  } catch (err) {
    steps.push({
      name: 'deep-focus-ignore-seed',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 8. Mark tracked runtime files as skip-worktree
  const skipStatus = await markRuntimeFilesSkipWorktree(root);
  steps.push({
    name: 'skip-worktree',
    status: skipStatus as 'ok' | 'failed',
  });

  // 9. Optionally start container services
  if (skipContainerServices) {
    steps.push({
      name: 'container-services',
      status: 'skipped',
      message: 'skipContainerServices=true',
    });
  } else {
    const containerServicesStatus = await startContainerServices(root);
    steps.push({
      name: 'container-services',
      status: containerServicesStatus as 'ok' | 'skipped' | 'failed',
      message: containerServicesStatus === 'skipped' ? 'compose file not found' : undefined,
    });
  }

  return { os, steps };
}
