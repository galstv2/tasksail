import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ArchivedParentContextBundle,
  ArchivedParentContextBundleFile,
  ArchivedTaskParentContextFile,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
  PlannerReadParentContextBundleRequest,
  PlannerReadParentContextBundleResponse,
} from '../src/shared/desktopContract';
import { isInsideOrEqual, utf8SafeSlice } from './main.archiveBundleShared';
import { createLogger } from './log/logger';
import { listArchivedTasksAction } from './main.archivedTasks';
import type { ContextPackLister } from './main.contextPackTaskVisibility';

const log = createLogger('electron/main.parentContextBundle');

const HANDOFF_BUNDLE_FILE_ORDER = [
  'intake.md',
  'implementation-spec.md',
  'final-summary.md',
  'issues.md',
  'parallel-ok.md',
] as const;

const MAX_PARENT_CONTEXT_FILE_BYTES = 32 * 1024;
const MAX_PARENT_CONTEXT_BUNDLE_BYTES = 192 * 1024;

type Payload = PlannerReadParentContextBundleRequest['payload'];

function invalid(error: string): DesktopInvokeResult {
  return { ok: false, action: 'planner.readParentContextBundle', error };
}

function orderedFiles(
  handoffs: ArchivedTaskParentContextFile[],
  implementationSteps: ArchivedTaskParentContextFile[],
): Array<{ kind: ArchivedParentContextBundleFile['kind']; entry: ArchivedTaskParentContextFile }> {
  const byHandoffName = new Map(handoffs.map((entry) => [entry.fileName, entry]));
  return [
    ...HANDOFF_BUNDLE_FILE_ORDER
      .map((fileName) => byHandoffName.get(fileName))
      .filter((entry): entry is ArchivedTaskParentContextFile => Boolean(entry))
      .map((entry) => ({ kind: 'handoff' as const, entry })),
    ...implementationSteps
      .filter((entry) => {
        const parts = entry.relativePath.split(/[\\/]/u);
        return entry.fileName.endsWith('.md')
          && entry.fileName !== 'tests.md'
          && parts.length <= 2
          && parts.at(-1) === entry.fileName;
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((entry) => ({ kind: 'implementation-step' as const, entry })),
  ];
}

function warnSkipped(reason: string, filePath: string, parentTaskId: string): void {
  log.warn('Skipped parent context bundle file.', { reason, filePath, parentTaskId });
}

export async function readParentContextBundleAction(
  listContextPacks: ContextPackLister,
  payload: Payload,
): Promise<DesktopInvokeResult> {
  const parentTaskId = payload.parentTaskId.trim();
  const contextPackDir = payload.contextPackDir.trim();
  const contextPackId = payload.contextPackId.trim();
  if (!parentTaskId || !contextPackDir || !contextPackId) {
    return invalid('Parent task id, context pack directory, and context pack id are required.');
  }

  const archiveResult = await listArchivedTasksAction(listContextPacks, {
    scope: {
      contextPackDir,
      contextPackId,
      contextPackName: path.basename(contextPackDir),
    },
  });
  if (!archiveResult.ok) return invalid(archiveResult.error);
  const response = archiveResult.response as PlannerListArchivedTasksResponse;
  const parent = response.tasks.find((task) => task.taskId === parentTaskId);
  if (!parent) return invalid(`Archived parent task ${parentTaskId} was not found in the selected context pack.`);
  const artifacts = parent.parentContextArtifacts;
  if (!artifacts) return invalid('Archived parent task is missing parent context artifact metadata.');

  const fallbackSummary = parent.parentTaskContent ?? null;
  if (artifacts.status === 'legacy-flat-archive') {
    const bundle: ArchivedParentContextBundle = {
      schemaVersion: 1,
      parentTaskId,
      rootTaskId: parent.rootTaskId,
      parentTaskTitle: parent.title,
      archivePath: parent.archivePath,
      archiveArtifactDir: null,
      status: 'legacy-flat-archive',
      missing: artifacts.missing,
      files: [],
      totalBytes: 0,
      truncated: false,
      fallbackSummary,
    };
    const loaded: PlannerReadParentContextBundleResponse = {
      action: 'planner.readParentContextBundle',
      mode: 'loaded',
      accepted: true,
      message: 'Parent context bundle loaded from legacy flat archive metadata.',
      bundle,
    };
    return { ok: true, response: loaded };
  }

  const archiveArtifactDir = artifacts.archiveArtifactDir;
  if (!archiveArtifactDir) return invalid('Archived parent task is missing its artifact directory.');

  const files: ArchivedParentContextBundleFile[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const { kind, entry } of orderedFiles(artifacts.handoffs, artifacts.implementationSteps)) {
    if (!isInsideOrEqual(archiveArtifactDir, entry.path)) {
      warnSkipped('path-escape', entry.path, parentTaskId);
      warnings.push(`Skipped ${entry.relativePath}: path escapes artifact directory.`);
      continue;
    }
    let stat;
    try {
      stat = await lstat(entry.path);
    } catch {
      warnSkipped('lstat-failed', entry.path, parentTaskId);
      warnings.push(`Skipped ${entry.relativePath}: file metadata could not be read.`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      warnSkipped('symlink', entry.path, parentTaskId);
      warnings.push(`Skipped ${entry.relativePath}: symlinks are not allowed.`);
      continue;
    }
    if (!stat.isFile()) {
      warnSkipped('not-regular-file', entry.path, parentTaskId);
      warnings.push(`Skipped ${entry.relativePath}: entry is not a regular file.`);
      continue;
    }

    if (totalBytes >= MAX_PARENT_CONTEXT_BUNDLE_BYTES) {
      truncated = true;
      warnings.push(`Skipped ${entry.relativePath}: parent context bundle byte cap reached.`);
      break;
    }

    let content: Buffer;
    try {
      content = await readFile(entry.path);
    } catch {
      warnSkipped('read-failed', entry.path, parentTaskId);
      warnings.push(`Skipped ${entry.relativePath}: file could not be read.`);
      continue;
    }

    const fileBudget = Math.min(MAX_PARENT_CONTEXT_FILE_BYTES, MAX_PARENT_CONTEXT_BUNDLE_BYTES - totalBytes);
    const slice = utf8SafeSlice(content, fileBudget);
    const fileTruncated = slice.length < content.length;
    files.push({
      kind,
      fileName: entry.fileName,
      relativePath: entry.relativePath.replaceAll(path.sep, '/'),
      sizeBytes: stat.size,
      content: slice.toString('utf8'),
      truncated: fileTruncated,
    });
    totalBytes += Buffer.byteLength(slice.toString('utf8'), 'utf8');
    if (fileTruncated) {
      truncated = true;
      if (totalBytes >= MAX_PARENT_CONTEXT_BUNDLE_BYTES) break;
    }
  }

  const bundle: ArchivedParentContextBundle = {
    schemaVersion: 1,
    parentTaskId,
    rootTaskId: parent.rootTaskId,
    parentTaskTitle: parent.title,
    archivePath: parent.archivePath,
    archiveArtifactDir,
    status: files.length > 0 ? 'available' : artifacts.status,
    missing: artifacts.missing,
    files,
    totalBytes,
    truncated,
    fallbackSummary,
  };
  const loaded: PlannerReadParentContextBundleResponse = {
    action: 'planner.readParentContextBundle',
    mode: 'loaded',
    accepted: true,
    message: warnings.length > 0
      ? `Parent context bundle loaded with warnings: ${warnings.join(' ')}`
      : 'Parent context bundle loaded.',
    bundle,
  };
  return { ok: true, response: loaded };
}
