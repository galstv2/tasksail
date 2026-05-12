import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

import { resolveQueuePaths } from './paths.js';

export interface CloseoutHealthReport {
  closeoutFailedReceipts: string[];
  orphanSentinels: string[];
  deferredRetroMarkers: string[];
}

export async function getCloseoutHealth(repoRoot: string): Promise<CloseoutHealthReport> {
  const report: CloseoutHealthReport = {
    closeoutFailedReceipts: [],
    orphanSentinels: [],
    deferredRetroMarkers: [],
  };

  const runtimeTasksDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks');
  let taskIds: string[] = [];
  try {
    taskIds = await readdir(runtimeTasksDir);
  } catch {
    taskIds = [];
  }

  for (const taskId of taskIds) {
    const receiptPath = path.join(runtimeTasksDir, taskId, 'pipeline-receipt.json');
    try {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf-8')) as { status?: string };
      if (receipt.status === 'closeout-failed') {
        report.closeoutFailedReceipts.push(taskId);
      }
    } catch {
      // Missing or corrupt receipts are outside this health report.
    }

    const markerPath = path.join(runtimeTasksDir, taskId, 'closeout-deferred-retro.json');
    if (existsSync(markerPath)) {
      report.deferredRetroMarkers.push(taskId);
    }
  }

  const queuePaths = resolveQueuePaths(repoRoot);
  try {
    const activeEntries = await readdir(queuePaths.activeItemsDir);
    const activeMarkers = new Set(
      activeEntries
        .filter((entry) => !entry.endsWith('.completing'))
        .map((entry) => entry.replace(/\.md$/, '')),
    );
    for (const sentinel of activeEntries.filter((entry) => entry.endsWith('.completing'))) {
      const taskId = sentinel.replace(/\.completing$/, '');
      if (!activeMarkers.has(taskId)) {
        report.orphanSentinels.push(taskId);
      }
    }
  } catch {
    // No active-items directory means no sentinels.
  }

  report.closeoutFailedReceipts.sort();
  report.orphanSentinels.sort();
  report.deferredRetroMarkers.sort();
  return report;
}
