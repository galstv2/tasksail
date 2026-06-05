import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { readChildTaskChains, type ChildTaskChainTaskRecord } from '../../../backend/platform/queue/childTaskChains.js';
import type {
  ArchivedParentChainArchiveBundle,
  ArchivedParentChainArchiveBundleTask,
  ArchivedTaskEntry,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
  PlannerReadParentChainArchiveBundleRequest,
  PlannerReadParentChainArchiveBundleResponse,
} from '../src/shared/desktopContract';
import { isInsideOrEqual, utf8SafeSlice } from './main.archiveBundleShared';
import { createLogger } from './log/logger';
import { listArchivedTasksAction } from './main.archivedTasks';
import type { ContextPackLister } from './main.contextPackTaskVisibility';
import { REPO_ROOT } from './paths';

const log = createLogger('electron/main.parentChainArchiveBundle');

const MAX_CHAIN_ARCHIVE_FILE_BYTES = 65_536;
const MAX_CHAIN_ARCHIVE_BUNDLE_BYTES = 262_144;

type Payload = PlannerReadParentChainArchiveBundleRequest['payload'];

function invalid(error: string): DesktopInvokeResult {
  return { ok: false, action: 'planner.readParentChainArchiveBundle', error };
}

function readOnlyResponse(bundle: ArchivedParentChainArchiveBundle): DesktopInvokeResult {
  const response: PlannerReadParentChainArchiveBundleResponse = {
    action: 'planner.readParentChainArchiveBundle',
    mode: 'loaded',
    accepted: true,
    message: `Parent chain archive bundle ${bundle.status}: included ${bundle.tasks.length}, missing ${bundle.missingTaskIds.length}, truncated ${bundle.truncated ? 'yes' : 'no'}.`,
    bundle,
  };
  return { ok: true, response };
}

function isStandaloneRoot(parent: ArchivedTaskEntry, parentTaskId: string): boolean {
  return (!parent.rootTaskId || parent.rootTaskId === parentTaskId) && !parent.parentTaskId;
}

function roleFor(taskId: string, parentTaskId: string, depth: number): ArchivedParentChainArchiveBundleTask['role'] {
  if (taskId === parentTaskId && depth === 0) return 'root-selected-parent';
  if (taskId === parentTaskId) return 'selected-parent';
  if (depth === 0) return 'root';
  return 'child';
}

function warnSkipped(taskId: string, reason: string, archivePath?: string): void {
  log.warn('Skipped parent chain archive.', { taskId, reason, ...(archivePath ? { archivePath } : {}) });
}

function pathsMatch(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

async function readCandidateArchive(
  task: ChildTaskChainTaskRecord,
  entry: ArchivedTaskEntry,
  parentTaskId: string,
  archiveRoot: string,
  remainingBytes: number,
): Promise<{ item?: ArchivedParentChainArchiveBundleTask; missing?: true; totalBytes: number; truncated: boolean }> {
  const archivePath = entry.archivePath;
  if (task.archivePath && !pathsMatch(task.archivePath, archivePath)) {
    warnSkipped(task.taskId, 'archive-path-mismatch', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }
  if (path.basename(archivePath) !== 'archive.md') {
    warnSkipped(task.taskId, 'legacy-flat-markdown-path', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }
  if (!isInsideOrEqual(archiveRoot, archivePath)) {
    warnSkipped(task.taskId, 'path-escape', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }

  let stat;
  try {
    stat = await lstat(archivePath);
  } catch {
    warnSkipped(task.taskId, 'lstat-failed', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }
  if (stat.isSymbolicLink()) {
    warnSkipped(task.taskId, 'symlink', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }
  if (!stat.isFile()) {
    warnSkipped(task.taskId, 'not-regular-file', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }

  let content: Buffer;
  try {
    content = await readFile(archivePath);
  } catch {
    warnSkipped(task.taskId, 'read-failed', archivePath);
    return { missing: true, totalBytes: 0, truncated: false };
  }

  const budget = Math.min(MAX_CHAIN_ARCHIVE_FILE_BYTES, remainingBytes);
  const slice = utf8SafeSlice(content, budget);
  const text = slice.toString('utf8');
  const emittedBytes = Buffer.byteLength(text, 'utf8');
  const truncated = emittedBytes < content.length;
  if (truncated) {
    log.warn('Truncated parent chain archive.', {
      taskId: task.taskId,
      originalBytes: content.length,
      emittedBytes,
      totalBytes: MAX_CHAIN_ARCHIVE_BUNDLE_BYTES - remainingBytes + emittedBytes,
    });
  }
  return {
    item: {
      taskId: task.taskId,
      title: entry.title || task.taskId,
      depth: task.depth,
      role: roleFor(task.taskId, parentTaskId, task.depth),
      state: 'completed',
      archivedAt: entry.archivedAt,
      archivePath,
      sizeBytes: stat.size,
      content: text,
      truncated,
    },
    totalBytes: emittedBytes,
    truncated,
  };
}

export async function readParentChainArchiveBundleAction(
  listContextPacks: ContextPackLister,
  payload: Payload,
): Promise<DesktopInvokeResult> {
  const parentTaskId = payload.parentTaskId.trim();
  const rootTaskId = payload.rootTaskId.trim();
  const contextPackDir = payload.contextPackDir.trim();
  const contextPackId = payload.contextPackId.trim();
  if (!parentTaskId || !rootTaskId || !contextPackDir || !contextPackId) {
    return invalid('Parent task id, root task id, context pack directory, and context pack id are required.');
  }

  log.info('Reading parent chain archive bundle.', { contextPackId, parentTaskId, rootTaskId });
  const contextPackName = path.basename(contextPackDir);
  const archiveResult = await listArchivedTasksAction(listContextPacks, {
    scope: { contextPackDir, contextPackId, contextPackName },
  });
  if (!archiveResult.ok) return invalid(archiveResult.error);
  const response = archiveResult.response as PlannerListArchivedTasksResponse;
  const byTaskId = new Map(response.tasks.map((task) => [task.taskId, task]));
  const parent = byTaskId.get(parentTaskId);
  if (!parent) return invalid(`Archived parent task ${parentTaskId} was not found in the selected context pack.`);

  let state;
  try {
    state = await readChildTaskChains(REPO_ROOT);
  } catch (error) {
    log.warn('Invalid child-task chain state while reading parent chain archive bundle.', {
      taskId: parentTaskId,
      rootTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return invalid('Child-task chain state is invalid. Refresh archived tasks and try again.');
  }

  const parentRecord = state.tasks[parentTaskId];
  if (!parentRecord) {
    if (!isStandaloneRoot(parent, parentTaskId)) {
      return invalid('Archived parent task is missing from child-task chain state.');
    }
    return readOnlyResponse({
      schemaVersion: 1,
      parentTaskId,
      rootTaskId: parentTaskId,
      currentTipTaskId: null,
      status: 'no-chain-state',
      tasks: [],
      missingTaskIds: [],
      totalBytes: 0,
      truncated: false,
    });
  }
  if (parentRecord.rootTaskId !== rootTaskId) return invalid('Archived parent root task id does not match child-task chain state.');
  if (parentRecord.state !== 'completed') return invalid('Archived parent task is not completed in child-task chain state.');
  const chain = state.chains[parentRecord.rootTaskId];
  if (!chain) return invalid('Archived parent child-task chain record was not found.');
  const parentIndex = chain.taskIds.indexOf(parentTaskId);
  if (parentIndex < 0) return invalid('Archived parent task is missing from its child-task chain order.');

  const archiveRoot = path.join(REPO_ROOT, 'AgentWorkSpace', 'qmd', 'context-packs', contextPackName, 'archive', 'tasks');
  const tasks: ArchivedParentChainArchiveBundleTask[] = [];
  const missingTaskIds: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const taskId of chain.taskIds.slice(0, parentIndex + 1)) {
    const task = state.tasks[taskId];
    if (!task || task.state !== 'completed') continue;
    if (totalBytes >= MAX_CHAIN_ARCHIVE_BUNDLE_BYTES) {
      truncated = true;
      missingTaskIds.push(taskId);
      continue;
    }
    const entry = byTaskId.get(taskId);
    if (!entry) {
      missingTaskIds.push(taskId);
      continue;
    }
    const read = await readCandidateArchive(task, entry, parentTaskId, archiveRoot, MAX_CHAIN_ARCHIVE_BUNDLE_BYTES - totalBytes);
    if (read.missing) {
      missingTaskIds.push(taskId);
      continue;
    }
    if (read.item) {
      tasks.push(read.item);
      totalBytes += read.totalBytes;
    }
    if (read.truncated) {
      truncated = true;
      // Remaining completed chain tasks past this point are unread; record them
      // as missing so `status` reflects an incomplete bundle rather than 'available'.
      const ordered = chain.taskIds.slice(0, parentIndex + 1);
      for (const remainingId of ordered.slice(ordered.indexOf(taskId) + 1)) {
        const remaining = state.tasks[remainingId];
        if (remaining && remaining.state === 'completed') {
          missingTaskIds.push(remainingId);
        }
      }
      break;
    }
  }

  const bundle: ArchivedParentChainArchiveBundle = {
    schemaVersion: 1,
    parentTaskId,
    rootTaskId: parentRecord.rootTaskId,
    currentTipTaskId: chain.currentTipTaskId,
    status: missingTaskIds.length > 0 ? 'missing-archives' : 'available',
    tasks,
    missingTaskIds,
    totalBytes,
    truncated,
  };
  log.info('Parent chain archive bundle read completed.', {
    status: bundle.status,
    includedCount: tasks.length,
    missingCount: missingTaskIds.length,
    totalBytes,
    truncated,
  });
  return readOnlyResponse(bundle);
}
