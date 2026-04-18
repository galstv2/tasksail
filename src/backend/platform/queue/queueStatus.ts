import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { getErrorMessage } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { handoffWorkspaceIsReady, handoffPublishInProgress } from './lifecycle.js';

export interface QueueStatusResult {
  dropboxItems: string[];
  pendingItems: string[];
  activeItem: string | null;
  workspaceReady: boolean;
  /** True when .active-item exists but handoffs/ is blank — crash-recovery state. */
  activeItemWithBlankWorkspace: boolean;
  /** True when a .publish-in-progress marker exists — handoffs partially initialized. */
  partialPublish: boolean;
  /** Count of .md files in error-items/ (failed tasks moved out of the queue). */
  errorItemsCount: number;
}

/**
 * Report the current queue state: dropbox items, pending items,
 * active item, and workspace readiness.
 */
export async function getQueueStatus(
  repoRoot?: string,
): Promise<QueueStatusResult> {
  const queuePaths = resolveQueuePaths(repoRoot);

  // Dropbox items
  let dropboxItems: string[] = [];
  if (existsSync(queuePaths.dropboxDir)) {
    const entries = await readdir(queuePaths.dropboxDir);
    dropboxItems = entries
      .filter((e) => !e.startsWith('.') && e.endsWith('.md'))
      .sort();
  }

  // Pending items
  let pendingItems: string[] = [];
  if (existsSync(queuePaths.pendingDir)) {
    const entries = await readdir(queuePaths.pendingDir);
    pendingItems = entries
      .filter((e) => !e.startsWith('.') && e.endsWith('.md'))
      .sort();
  }

  // Active item
  let activeItem: string | null = null;
  if (existsSync(queuePaths.activeItemLink)) {
    try {
      const name = (await readFile(queuePaths.activeItemLink, 'utf-8')).trim();
      if (name && existsSync(path.join(queuePaths.pendingDir, name))) {
        activeItem = name;
      }
    } catch (err: unknown) {
      process.stderr.write(`Warning: failed to read active-item: ${getErrorMessage(err)}\n`);
    }
  }

  // Workspace readiness
  const workspaceReady = await handoffWorkspaceIsReady(
    queuePaths.handoffsDir,
    queuePaths.templatesDir,
  );

  // Detect crash-recovery state: .active-item present but workspace is blank
  const activeItemWithBlankWorkspace = activeItem !== null && workspaceReady;

  // Detect partial publish
  const partialPublish = handoffPublishInProgress(queuePaths.handoffsDir);

  // Count error items
  let errorItemsCount = 0;
  if (existsSync(queuePaths.errorItemsDir)) {
    const errorEntries = await readdir(queuePaths.errorItemsDir);
    errorItemsCount = errorEntries.filter(
      (e) => !e.startsWith('.') && e.endsWith('.md'),
    ).length;
  }

  return {
    dropboxItems,
    pendingItems,
    activeItem,
    workspaceReady,
    activeItemWithBlankWorkspace,
    partialPublish,
    errorItemsCount,
  };
}
