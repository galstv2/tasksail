import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findRepoRoot, ensureEnvFile, ensureDir, getErrorMessage } from '../core/index.js';
import { seedMcpRegistry } from '../mcp-registry/index.js';

const execFileAsync = promisify(execFile);

export type PlatformOS = 'darwin' | 'linux' | 'win32';

export function detectOS(): PlatformOS {
  return process.platform as PlatformOS;
}

export interface SetupOptions {
  repoRoot?: string;
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
    for (const file of stdout.split('\n').filter(Boolean)) {
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

async function startDockerServices(repoRoot: string): Promise<string> {
  const composeFile = path.join(repoRoot, 'docker', 'compose', 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) {
    return 'skipped';
  }
  try {
    await execFileAsync(
      'docker',
      ['compose', '-f', composeFile, 'up', '-d', '--build'],
      { cwd: repoRoot, timeout: 120_000 },
    );
    return 'ok';
  } catch {
    return 'failed';
  }
}

export async function setupRepo(options?: SetupOptions): Promise<SetupResult> {
  const root = options?.repoRoot ?? await findRepoRoot();
  const skipDocker = options?.skipDocker ?? false;
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

  // 3. Configure git hooks
  const hookStatus = await configureGitHooks(root);
  steps.push({
    name: 'git-hooks',
    status: hookStatus as 'ok' | 'failed',
    message: hookStatus === 'ok' ? 'core.hooksPath set to .githooks' : undefined,
  });

  // 4. Create queue directories
  const queueDirs = [
    path.join(root, 'AgentWorkSpace', 'dropbox'),
    path.join(root, 'AgentWorkSpace', 'pendingitems'),
    path.join(root, 'AgentWorkSpace', 'handoffs'),
  ];
  try {
    for (const dir of queueDirs) {
      await ensureDir(dir);
    }
    steps.push({ name: 'queue-dirs', status: 'ok' });
  } catch (err) {
    steps.push({
      name: 'queue-dirs',
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Seed MCP registry
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

  // 6. Mark tracked runtime files as skip-worktree
  const skipStatus = await markRuntimeFilesSkipWorktree(root);
  steps.push({
    name: 'skip-worktree',
    status: skipStatus as 'ok' | 'failed',
  });

  // 7. Optionally start Docker services
  if (skipDocker) {
    steps.push({ name: 'docker-services', status: 'skipped', message: 'skipDocker=true' });
  } else {
    const dockerStatus = await startDockerServices(root);
    steps.push({
      name: 'docker-services',
      status: dockerStatus as 'ok' | 'skipped' | 'failed',
      message: dockerStatus === 'skipped' ? 'docker-compose.yml not found' : undefined,
    });
  }

  return { os, steps };
}
