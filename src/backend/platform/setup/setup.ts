import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import { findRepoRoot, ensureEnvFile, ensureDir, getErrorMessage } from '../core/index.js';
import { createRuntimeFromConfig } from '../container/runtime.js';
import { sweepLegacyPortAllocationsOnce } from '../container/sharedMcp.js';
import { resolveDefaultComposeFile } from '../container/types.js';
import { seedMcpRegistry } from '../mcp-registry/index.js';
import { seedPlatformConfig } from '../platform-config/seed.js';
import { resolveContainerRuntime } from '../platform-config/resolve.js';
import { seedDeepFocusIgnoreConfig } from '../deep-focus-ignore/seed.js';

const execFileAsync = promisify(execFile);

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
    process.stderr.write(`Warning: git hooks configuration failed: ${getErrorMessage(err)}\n`);
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
    process.stderr.write(`Warning: skip-worktree failed: ${getErrorMessage(err)}\n`);
    return 'failed';
  }
}

export async function assertPythonOnPath(): Promise<void> {
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn('python3', ['--version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
  if (ok) return;

  process.stderr.write(
    'container_runtime is set to "direct", but `python3` was not found on PATH.\n'
      + 'Install Python 3.13+ and ensure `python3` is discoverable, or set container_runtime\n'
      + 'to "docker" or "podman" in config/platform.default.json.\n',
  );
  process.exit(1);
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

    await sweepLegacyPortAllocationsOnce(repoRoot);
    await runtime.composeUp({
      composeFile,
      detach: true,
      build: true,
    });

    return 'ok';
  } catch (err: unknown) {
    process.stderr.write(`Warning: container service startup failed: ${getErrorMessage(err)}\n`);
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

  // 3. Seed platform config
  try {
    const platformSeedResult = await seedPlatformConfig(root);
    if (platformSeedResult.action !== 'failed' && await resolveContainerRuntime(root) === 'direct') {
      await assertPythonOnPath();
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
