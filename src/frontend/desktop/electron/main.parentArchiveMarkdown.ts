import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
  PlannerReadParentArchiveMarkdownRequest,
  PlannerReadParentArchiveMarkdownResponse,
} from '../src/shared/desktopContract';
import { isInsideOrEqual } from './main.archiveBundleShared';
import { REPO_ROOT } from './paths';
import { listArchivedTasksAction } from './main.archivedTasks';
import type { ContextPackLister } from './main.contextPackTaskVisibility';

const MAX_PARENT_ARCHIVE_MARKDOWN_BYTES = 2 * 1024 * 1024;

type Payload = PlannerReadParentArchiveMarkdownRequest['payload'];

function invalid(error: string): DesktopInvokeResult {
  return { ok: false, action: 'planner.readParentArchiveMarkdown', error };
}

function hasAllowedArchiveName(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === 'archive.md' || base.endsWith('.md');
}

export async function readParentArchiveMarkdownAction(
  listContextPacks: ContextPackLister,
  payload: Payload,
): Promise<DesktopInvokeResult> {
  const parentTaskId = payload.parentTaskId.trim();
  const contextPackDir = payload.contextPackDir.trim();
  const contextPackId = payload.contextPackId.trim();
  if (!parentTaskId || !contextPackDir || !contextPackId) {
    return invalid('Parent task id, context pack directory, and context pack id are required.');
  }

  const contextPackName = path.basename(contextPackDir);
  const archiveResult = await listArchivedTasksAction(listContextPacks, {
    scope: { contextPackDir, contextPackId, contextPackName },
  });
  if (!archiveResult.ok) return invalid(archiveResult.error);
  const response = archiveResult.response as PlannerListArchivedTasksResponse;
  const parent = response.tasks.find((task) => task.taskId === parentTaskId);
  if (!parent) return invalid(`Archived parent task ${parentTaskId} was not found in the selected context pack.`);
  if (!parent.archivePath) return invalid('Archived parent task is missing its archive path.');

  const archiveRoot = path.join(REPO_ROOT, 'AgentWorkSpace', 'qmd', 'context-packs', contextPackName, 'archive', 'tasks');
  if (!isInsideOrEqual(archiveRoot, parent.archivePath)) {
    return invalid('Archived parent archive path is outside the selected context pack archive.');
  }
  if (!hasAllowedArchiveName(parent.archivePath)) {
    return invalid('Archived parent archive path must point to a markdown archive file.');
  }

  let stat;
  try {
    stat = await lstat(parent.archivePath);
  } catch {
    return invalid('Archived parent archive file metadata could not be read.');
  }
  if (stat.isSymbolicLink()) return invalid('Archived parent archive file cannot be a symlink.');
  if (!stat.isFile()) return invalid('Archived parent archive path is not a regular file.');
  if (stat.size > MAX_PARENT_ARCHIVE_MARKDOWN_BYTES) {
    return invalid('Parent archive is too large to preview. The limit is 2 MiB.');
  }

  let content: string;
  try {
    content = await readFile(parent.archivePath, 'utf8');
  } catch {
    return invalid('Archived parent archive file could not be read.');
  }

  const loaded: PlannerReadParentArchiveMarkdownResponse = {
    action: 'planner.readParentArchiveMarkdown',
    mode: 'loaded',
    accepted: true,
    message: 'Parent archive markdown loaded.',
    taskId: parent.taskId,
    title: parent.title,
    archivePath: parent.archivePath,
    archivedAt: parent.archivedAt,
    content,
    sizeBytes: stat.size,
  };
  return { ok: true, response: loaded };
}
