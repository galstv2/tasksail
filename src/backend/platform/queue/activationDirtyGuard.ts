import path from 'node:path';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { ensureDir, createLogger, RuntimeTerminalEvents, moveFile } from '../core/index.js';
import { splitCommandOutputLines } from '../core/commandOutput.js';
import type { QueuePaths } from './paths.js';
import { removeFromQueueOrderManifest } from './queueOrderManifest.js';
import { extractTaskTitle } from './markdown.js';
import { transitionTask } from './taskRegistry.js';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/queue/activationDirtyGuard');

export interface MaterializationOrigin {
  contextRoot: string;
  gitRoot: string;
}

export interface DirtyTargetRepo {
  label: string;
  gitRoot: string;
  statusLines: string[];
}

async function headSha(gitRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return '';
  }
}

function repoBaseLabel(origin: MaterializationOrigin): string {
  try {
    return path.basename(realpathSync(origin.contextRoot));
  } catch {
    return path.basename(origin.contextRoot);
  }
}

export async function resolveRepoLabels(
  origins: readonly MaterializationOrigin[],
): Promise<string[]> {
  const bases = origins.map(repoBaseLabel);
  const counts = new Map<string, number>();
  for (const base of bases) {
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  return Promise.all(origins.map(async (origin, index) => {
    const base = bases[index] ?? 'repo';
    if ((counts.get(base) ?? 0) <= 1) {
      return base;
    }
    const sha = await headSha(origin.gitRoot);
    const sha8 = sha.length >= 8 ? sha.slice(0, 8) : (sha || 'unknown');
    return `${base}-${sha8}`;
  }));
}

export async function findDirtyTargetRepos(
  origins: readonly MaterializationOrigin[],
): Promise<DirtyTargetRepo[]> {
  const labels = await resolveRepoLabels(origins);

  const results = await Promise.all(origins.map(async (origin, i) => {
    try {
      await execFileAsync('git', ['-C', origin.gitRoot, 'rev-parse', '--verify', 'HEAD']);
    } catch {
      return null;
    }
    try {
      const { stdout } = await execFileAsync('git', [
        '-C',
        origin.gitRoot,
        'status',
        '--porcelain=v1',
        '--untracked-files=normal',
      ]);
      const statusLines = splitCommandOutputLines(stdout);
      if (statusLines.length === 0) return null;
      return {
        label: labels[i]!,
        gitRoot: origin.gitRoot,
        statusLines,
      } satisfies DirtyTargetRepo;
    } catch {
      return null;
    }
  }));

  return results
    .filter((r): r is DirtyTargetRepo => r !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function failPendingActivationForDirtyRepos(input: {
  repoRoot: string;
  paths: QueuePaths;
  taskId: string;
  pendingItemPath: string;
  content: string;
  dirtyRepos: readonly DirtyTargetRepo[];
}): Promise<void> {
  const { repoRoot, paths, taskId, pendingItemPath, content, dirtyRepos } = input;

  const repoLabels = dirtyRepos.map((repo) => repo.label);
  const repoRoots = dirtyRepos.map((repo) => repo.gitRoot);
  const taskTitle = extractTaskTitle(content) || taskId;
  const errorFile = path.join(paths.errorItemsDir, `${taskId}.md`);

  await ensureDir(paths.errorItemsDir);
  try {
    await moveFile(pendingItemPath, errorFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`activation-dirty-guard-pending-missing: ${pendingItemPath}`);
    }
    throw error;
  }
  await removeFromQueueOrderManifest(paths.queueOrderPath, `${taskId}.md`);

  try {
    await transitionTask(repoRoot, taskId, 'pending', 'failed');
  } catch (error: unknown) {
    log.warn('activation_dirty_guard.registry_transition_failed', {
      taskId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const terminal = RuntimeTerminalEvents.forTask(repoRoot, taskId);
  await terminal.activationBlockedDirtyRepos({ taskTitle, repoLabels, repoRoots });
  await terminal.taskFailed();
  await terminal.errorItemsMoved({ errorPath: errorFile, reason: 'uncommitted-changes' });

  log.warn('activation_dirty_guard.blocked', {
    taskId,
    repoRoots,
    repoLabels,
    dirtyLineCounts: dirtyRepos.map((repo) => repo.statusLines.length),
  });
}
