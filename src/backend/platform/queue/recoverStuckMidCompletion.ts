import path from 'node:path';
import { existsSync, type Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/active.js';
import { completePendingItem, type CompletingSentinelPayload } from './completePendingItem.js';
import { resolveQueuePaths } from './paths.js';
import { loadTaskRegistry, type TaskRegistryEntry } from './taskRegistry.js';

export interface RecoverStuckMidCompletionResult {
  recovered: boolean;
  reason?: 'archive-not-proven';
}

export async function recoverStuckMidCompletion(options: {
  taskId: string;
  repoRoot?: string;
}): Promise<RecoverStuckMidCompletionResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);
  const sentinelPath = path.join(queuePaths.activeItemsDir, `${options.taskId}.completing`);
  const sentinel = await readSentinel(sentinelPath);
  const registryEntry = await findRegistryEntry(repoRoot, options.taskId);

  const proof = await proveArchiveSuccess({
    repoRoot,
    taskId: options.taskId,
    sentinel,
    registryEntry,
  });

  if (!proof.proven) {
    return { recovered: false, reason: 'archive-not-proven' };
  }

  await completePendingItem({
    taskId: options.taskId,
    repoRoot,
    skipArchive: true,
    skipValidation: true,
    recoveryArchivePath: proof.archivePath,
    contextPackDir: proof.contextPackDir,
    skipRetrospectiveSync: sentinel.retrospectiveSynced === true,
  });

  return { recovered: true };
}

interface ArchiveProof {
  proven: boolean;
  archivePath: string | null;
  contextPackDir?: string;
}

async function readSentinel(sentinelPath: string): Promise<CompletingSentinelPayload> {
  try {
    const parsed: unknown = JSON.parse(await readFile(sentinelPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof (parsed as { ts?: unknown }).ts === 'number') {
      return parsed as CompletingSentinelPayload;
    }
  } catch {
    // Invalid JSON is a legacy unknown-progress sentinel.
  }
  return { ts: Date.now() };
}

async function findRegistryEntry(
  repoRoot: string,
  taskId: string,
): Promise<TaskRegistryEntry | null> {
  const registry = await loadTaskRegistry(repoRoot);
  for (const set of Object.values(registry.tasks)) {
    for (const entry of [
      ...set.open,
      ...set.pending,
      ...set.active,
      ...set.failed,
      ...set.completed,
    ]) {
      if (entry.taskId === taskId) return entry;
    }
  }
  return null;
}

async function proveArchiveSuccess(options: {
  repoRoot: string;
  taskId: string;
  sentinel: CompletingSentinelPayload;
  registryEntry: TaskRegistryEntry | null;
}): Promise<ArchiveProof> {
  if (options.sentinel.archiveSucceeded === true) {
    return {
      proven: true,
      archivePath: typeof options.sentinel.archivePath === 'string'
        ? options.sentinel.archivePath
        : null,
      contextPackDir: options.sentinel.contextPackDir,
    };
  }

  if (
    options.registryEntry?.archivePath
    && options.registryEntry.state !== 'open'
    && options.registryEntry.state !== 'pending'
    && options.registryEntry.state !== 'active'
  ) {
    return {
      proven: true,
      archivePath: options.registryEntry.archivePath,
      contextPackDir: options.registryEntry.contextPackDir ?? undefined,
    };
  }

  for (const contextPackDir of await candidateContextPackDirs(options)) {
    const archiveRecord = await findArchiveTaskRecord(contextPackDir, options.taskId);
    if (archiveRecord) {
      return {
        proven: true,
        archivePath: archiveRecord.markdownPath,
        contextPackDir,
      };
    }
  }

  return { proven: false, archivePath: null };
}

async function candidateContextPackDirs(options: {
  repoRoot: string;
  taskId: string;
  sentinel: CompletingSentinelPayload;
  registryEntry: TaskRegistryEntry | null;
}): Promise<string[]> {
  const candidates: string[] = [];
  if (options.sentinel.contextPackDir) {
    candidates.push(options.sentinel.contextPackDir);
  }
  if (options.registryEntry?.contextPackDir) {
    candidates.push(options.registryEntry.contextPackDir);
  }
  try {
    candidates.push(await requireAuthorizedActiveContextPack({
      repoRoot: options.repoRoot,
      taskId: options.taskId,
    }));
  } catch {
    // No authorized active context pack is available; other candidates may still prove archival.
  }

  return [...new Set(candidates.map((candidate) => path.resolve(options.repoRoot, candidate)))];
}

interface ArchiveTaskRecord {
  markdownPath: string | null;
}

async function findArchiveTaskRecord(
  contextPackDir: string,
  taskId: string,
): Promise<ArchiveTaskRecord | null> {
  if (!existsSync(contextPackDir)) return null;

  const jsonPaths = await collectArchiveTaskJsonPaths(contextPackDir, contextPackDir);
  for (const jsonPath of jsonPaths) {
    const parsed = await readJsonRecord(jsonPath);
    if (!parsed || typeof parsed !== 'object') continue;
    const recordTaskId = (parsed as { task_id?: unknown; taskId?: unknown }).task_id
      ?? (parsed as { taskId?: unknown }).taskId;
    if (recordTaskId !== taskId) continue;

    const markdownPath = jsonPath.slice(0, -'.json'.length) + '.md';
    return {
      markdownPath: existsSync(markdownPath) ? markdownPath : null,
    };
  }

  return null;
}

async function collectArchiveTaskJsonPaths(
  rootDir: string,
  dir: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonPaths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('.staging-')) continue;

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      jsonPaths.push(...await collectArchiveTaskJsonPaths(rootDir, entryPath));
    } else if (
      entry.isFile()
      && entry.name.endsWith('.json')
      && isArchiveTaskJsonPath(rootDir, entryPath)
    ) {
      jsonPaths.push(entryPath);
    }
  }

  return jsonPaths.sort();
}

function isArchiveTaskJsonPath(rootDir: string, jsonPath: string): boolean {
  const relative = path.relative(rootDir, jsonPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;

  const segments = relative.split(path.sep);
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === 'archive' && segments[i + 1] === 'tasks') {
      return true;
    }
  }
  return false;
}

async function readJsonRecord(jsonPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}
