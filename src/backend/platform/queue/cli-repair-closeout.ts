import path from 'node:path';
import { readdir } from 'node:fs/promises';

import { findRepoRoot } from '../core/index.js';
import { resumeCloseoutFromSentinel } from './resumeCloseout.js';
import { resolveQueuePaths } from './paths.js';

function parseArgs(argv: string[]): { taskId?: string; scan: boolean; dryRun: boolean; repoRoot: string } {
  let taskId: string | undefined;
  let repoRoot = findRepoRoot();
  let scan = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--task-id') taskId = argv[++i];
    else if (arg === '--repo-root') repoRoot = argv[++i] ?? repoRoot;
    else if (arg === '--scan') scan = true;
    else if (arg === '--dry-run') dryRun = true;
  }
  return { taskId, scan, dryRun, repoRoot };
}

async function scanSentinelTaskIds(repoRoot: string): Promise<string[]> {
  const paths = resolveQueuePaths(repoRoot);
  try {
    return (await readdir(paths.activeItemsDir))
      .filter((entry) => entry.endsWith('.completing'))
      .map((entry) => entry.replace(/\.completing$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { taskId, scan, dryRun, repoRoot } = parseArgs(argv);
  const taskIds = taskId ? [taskId] : scan ? await scanSentinelTaskIds(repoRoot) : [];
  if (taskIds.length === 0) {
    process.stderr.write('Usage: repair-stuck-closeout --task-id <id> [--dry-run] [--repo-root <path>] or --scan\n');
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    process.stdout.write(JSON.stringify({ repoRoot: path.resolve(repoRoot), wouldRepair: taskIds }, null, 2) + '\n');
    return;
  }

  const results = [];
  for (const id of taskIds) {
    const result = await resumeCloseoutFromSentinel(id, repoRoot);
    results.push({ taskId: id, ...result });
    if (result.status === 'no-archive-record') {
      process.stderr.write(`Refusing to repair ${id}: no archive record. Use pnpm run requeue-error-item -- --task-id ${id}\n`);
    }
  }
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`repair-stuck-closeout failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
