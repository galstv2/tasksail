import { basename, join, resolve } from 'node:path';

import type { ContextPackListResponse } from '../../src/shared/desktopContract';
import {
  extractContextPackBinding,
} from '../../../../backend/platform/queue/markdown';
import type {
  TaskRegistry,
  TaskRegistryEntry,
} from '../../../../backend/platform/queue/taskRegistry.js';
import { pathExists, repoFs, type ReadOnlyRepoFs } from '../utils';

export type ActiveContextPackTaskScope = {
  contextPackId: string;
  contextPackDir: string;
  contextPackName: string;
};

export type ContextPackLister = () => Promise<ContextPackListResponse>;
export type ActiveScopeProvider = () => ActiveContextPackTaskScope | null;

export type VisibleTaskMarkdownItem = {
  fileName: string;
  filePath: string;
  content: string;
  taskId: string | null;
  title: string | null;
};

let currentActiveContextPackTaskScope: ActiveContextPackTaskScope | null = null;
let currentActiveContextPackTaskScopeInitialized = false;

function normalizeAbsolutePath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? resolve(trimmed) : null;
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function extractHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function extractTaskId(content: string): string | null {
  const match = content.match(/^- Task ID:\s*(.+?)$/m);
  return match?.[1]?.trim() || null;
}

export function bindingMatchesScope(
  binding: {
    contextPackId?: string | null;
    contextPackDir?: string | null;
  },
  scope: ActiveContextPackTaskScope | null,
): boolean {
  if (!scope) {
    return false;
  }

  const bindingContextPackId = normalizeIdentifier(binding.contextPackId);
  if (bindingContextPackId) {
    return bindingContextPackId === scope.contextPackId;
  }

  const bindingContextPackDir = normalizeAbsolutePath(binding.contextPackDir);
  return bindingContextPackDir === scope.contextPackDir;
}

export function allRegistryEntries(registry: TaskRegistry): TaskRegistryEntry[] {
  return Object.values(registry.tasks).flatMap((taskSet) => [
    ...taskSet.open,
    ...taskSet.pending,
    ...taskSet.active,
    ...taskSet.failed,
    ...taskSet.completed,
  ]);
}

export function activeContextPackTaskScopesEqual(
  left: ActiveContextPackTaskScope | null,
  right: ActiveContextPackTaskScope | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.contextPackId === right.contextPackId &&
    left.contextPackDir === right.contextPackDir &&
    left.contextPackName === right.contextPackName
  );
}

export async function resolveActiveContextPackTaskScope(
  listContextPacks: ContextPackLister,
): Promise<ActiveContextPackTaskScope | null> {
  const catalog = await listContextPacks();
  const activeEntry = catalog.contextPacks.find((entry) => entry.isActive);
  if (!activeEntry) {
    return null;
  }

  const contextPackId = normalizeIdentifier(activeEntry.contextPackId);
  const contextPackDir = normalizeAbsolutePath(activeEntry.contextPackDir);
  if (!contextPackId || !contextPackDir) {
    return null;
  }

  return {
    contextPackId,
    contextPackDir,
    contextPackName: basename(contextPackDir),
  };
}

export function getCurrentActiveContextPackTaskScope(): ActiveContextPackTaskScope | null {
  return currentActiveContextPackTaskScope;
}

export const defaultActiveScopeProvider: ActiveScopeProvider =
  getCurrentActiveContextPackTaskScope;

export function isCurrentActiveContextPackTaskScopeInitialized(): boolean {
  return currentActiveContextPackTaskScopeInitialized;
}

export function setCurrentActiveContextPackTaskScope(
  scope: ActiveContextPackTaskScope | null,
): { previous: ActiveContextPackTaskScope | null; changed: boolean } {
  const previous = currentActiveContextPackTaskScope;
  const changed = !activeContextPackTaskScopesEqual(previous, scope);
  currentActiveContextPackTaskScope = scope;
  currentActiveContextPackTaskScopeInitialized = true;
  return { previous, changed };
}

export async function refreshCurrentActiveContextPackTaskScope(
  listContextPacks: ContextPackLister,
): Promise<{
  previous: ActiveContextPackTaskScope | null;
  next: ActiveContextPackTaskScope | null;
  changed: boolean;
}> {
  const next = await resolveActiveContextPackTaskScope(listContextPacks);
  const { previous, changed } = setCurrentActiveContextPackTaskScope(next);
  return { previous, next, changed };
}

export function isRegistryEntryVisibleForScope(
  entry: { contextPackId?: string | null; contextPackDir?: string | null },
  scope: ActiveContextPackTaskScope | null,
): boolean {
  return bindingMatchesScope(entry, scope);
}

export function isTaskMarkdownVisibleForScope(
  content: string,
  scope: ActiveContextPackTaskScope | null,
): boolean {
  const bindingResult = extractContextPackBinding(content);
  return bindingResult.kind === 'binding' && bindingMatchesScope(bindingResult.binding, scope);
}

export function filterRegistryTaskSetsForScope(
  registry: TaskRegistry,
  scope: ActiveContextPackTaskScope | null,
): {
  open: TaskRegistryEntry[];
  pending: TaskRegistryEntry[];
  active: TaskRegistryEntry[];
  failed: TaskRegistryEntry[];
  completed: TaskRegistryEntry[];
} {
  const filtered = {
    open: [] as TaskRegistryEntry[],
    pending: [] as TaskRegistryEntry[],
    active: [] as TaskRegistryEntry[],
    failed: [] as TaskRegistryEntry[],
    completed: [] as TaskRegistryEntry[],
  };

  if (!scope) {
    return filtered;
  }

  for (const taskSet of Object.values(registry.tasks)) {
    filtered.open.push(...taskSet.open.filter((entry) => isRegistryEntryVisibleForScope(entry, scope)));
    filtered.pending.push(...taskSet.pending.filter((entry) => isRegistryEntryVisibleForScope(entry, scope)));
    filtered.active.push(...taskSet.active.filter((entry) => isRegistryEntryVisibleForScope(entry, scope)));
    filtered.failed.push(...taskSet.failed.filter((entry) => isRegistryEntryVisibleForScope(entry, scope)));
    filtered.completed.push(...taskSet.completed.filter((entry) => isRegistryEntryVisibleForScope(entry, scope)));
  }

  return filtered;
}

export function collectVisibleTaskIdsFromRegistry(
  registry: TaskRegistry,
  scope: ActiveContextPackTaskScope | null,
): Set<string> {
  return new Set(
    allRegistryEntries(registry)
      .filter((entry) => isRegistryEntryVisibleForScope(entry, scope))
      .map((entry) => entry.taskId),
  );
}

export function registryContainsTaskId(registry: TaskRegistry, taskId: string): boolean {
  return allRegistryEntries(registry).some((entry) => entry.taskId === taskId);
}

export function findVisibleRegistryEntryByTaskId(
  registry: TaskRegistry,
  scope: ActiveContextPackTaskScope | null,
  taskId: string,
): TaskRegistryEntry | null {
  for (const entry of allRegistryEntries(registry)) {
    if (entry.taskId === taskId && isRegistryEntryVisibleForScope(entry, scope)) {
      return entry;
    }
  }
  return null;
}

export async function readVisibleTaskMarkdownItems(
  dir: string,
  scope: ActiveContextPackTaskScope | null,
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<VisibleTaskMarkdownItem[]> {
  if (!scope || !(await pathExists(dir, fsAdapter))) {
    return [];
  }

  let entries: string[];
  try {
    entries = await fsAdapter.readdir(dir);
  } catch {
    return [];
  }

  const fileNames = entries
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
    .sort();
  const visibleItems: VisibleTaskMarkdownItem[] = [];

  for (const fileName of fileNames) {
    const filePath = join(dir, fileName);
    let content: string;
    try {
      content = await fsAdapter.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (!isTaskMarkdownVisibleForScope(content, scope)) {
      continue;
    }
    visibleItems.push({
      fileName,
      filePath,
      content,
      taskId: extractTaskId(content),
      title: extractHeading(content),
    });
  }

  return visibleItems;
}

export async function readVisibleTaskMarkdownItemsByTaskId(
  dir: string,
  scope: ActiveContextPackTaskScope | null,
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<Map<string, VisibleTaskMarkdownItem>> {
  const byTaskId = new Map<string, VisibleTaskMarkdownItem>();
  for (const item of await readVisibleTaskMarkdownItems(dir, scope, fsAdapter)) {
    const taskId = item.taskId ?? basename(item.fileName, '.md');
    if (taskId) {
      byTaskId.set(taskId, { ...item, taskId });
    }
  }
  return byTaskId;
}

export async function filterActiveTaskIdsForScope(
  activeTaskIds: string[],
  options: {
    registry: TaskRegistry;
    scope: ActiveContextPackTaskScope | null;
    pendingDir: string;
    fsAdapter?: ReadOnlyRepoFs;
  },
): Promise<string[]> {
  if (!options.scope || activeTaskIds.length === 0) {
    return [];
  }

  const visibleRegistryTaskIds = collectVisibleTaskIdsFromRegistry(options.registry, options.scope);
  const visiblePendingMarkdownTaskIds = new Set(
    [...(await readVisibleTaskMarkdownItemsByTaskId(
      options.pendingDir,
      options.scope,
      options.fsAdapter ?? repoFs,
    )).keys()],
  );

  return activeTaskIds
    .filter((taskId) => (
      visibleRegistryTaskIds.has(taskId)
      || (!registryContainsTaskId(options.registry, taskId) && visiblePendingMarkdownTaskIds.has(taskId))
    ))
    .sort();
}
