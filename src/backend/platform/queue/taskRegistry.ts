/**
 * Centralized task registry — JSON-based index of all tasks keyed by context pack.
 *
 * The registry lives at `.platform-state/task-registry.json` and is updated
 * at each state transition by the pipeline alongside the existing file moves.
 * The Task Board reads from the registry instead of scanning directories.
 */
import path from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ensureDir, readTextFile } from '../core/index.js';
import {
  extractTaskTitle,
  extractContextPackBinding,
  type TaskContextPackTarget,
} from './markdown.js';

const REGISTRY_RELATIVE_PATH = '.platform-state/task-registry.json';
const SCHEMA_VERSION = 1;

export type TaskState = 'open' | 'pending' | 'active' | 'failed' | 'completed';

export interface TaskRegistryEntry {
  taskId: string;
  fileName: string;
  title: string | null;
  state: TaskState;
  contextPackId: string | null;
  contextPackDir: string | null;
  scopeMode: string | null;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled?: boolean;
  selectedFocusPath?: string;
  selectedFocusTargetKind?: 'directory' | 'file';
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
  createdAt: string | null;
  completedAt: string | null;
  archivePath: string | null;
}

export interface ContextPackTaskSet {
  open: TaskRegistryEntry[];
  pending: TaskRegistryEntry[];
  active: TaskRegistryEntry | null;
  failed: TaskRegistryEntry[];
  completed: TaskRegistryEntry[];
}

export interface TaskRegistry {
  schema_version: number;
  tasks: Record<string, ContextPackTaskSet>;
}

function emptyTaskSet(): ContextPackTaskSet {
  return { open: [], pending: [], active: null, failed: [], completed: [] };
}

function emptyRegistry(): TaskRegistry {
  return { schema_version: SCHEMA_VERSION, tasks: {} };
}

function registryPath(repoRoot: string): string {
  return path.join(repoRoot, REGISTRY_RELATIVE_PATH);
}

function contextPackKey(entry: Pick<TaskRegistryEntry, 'contextPackId'>): string {
  return entry.contextPackId || '_unbound';
}

function ensurePackSet(registry: TaskRegistry, key: string): ContextPackTaskSet {
  if (!registry.tasks[key]) {
    registry.tasks[key] = emptyTaskSet();
  }
  return registry.tasks[key];
}

export async function loadTaskRegistry(repoRoot: string): Promise<TaskRegistry> {
  try {
    const raw = await readFile(registryPath(repoRoot), 'utf-8');
    const parsed = JSON.parse(raw) as TaskRegistry;
    if (parsed.schema_version !== SCHEMA_VERSION) return emptyRegistry();
    return parsed;
  } catch {
    return emptyRegistry();
  }
}

export async function saveTaskRegistry(
  repoRoot: string,
  registry: TaskRegistry,
): Promise<void> {
  const filePath = registryPath(repoRoot);
  await ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, filePath);
}

export async function registerTask(
  repoRoot: string,
  entry: TaskRegistryEntry,
): Promise<void> {
  const registry = await loadTaskRegistry(repoRoot);
  const key = contextPackKey(entry);
  const set = ensurePackSet(registry, key);
  const list = stateList(set, entry.state);
  if (list && !list.some((e) => e.taskId === entry.taskId)) {
    list.push(entry);
  } else if (entry.state === 'active' && set.active?.taskId !== entry.taskId) {
    set.active = entry;
  }
  await saveTaskRegistry(repoRoot, registry);
}

export async function transitionTask(
  repoRoot: string,
  taskId: string,
  fromState: TaskState,
  toState: TaskState,
  updates?: Partial<TaskRegistryEntry>,
): Promise<void> {
  const registry = await loadTaskRegistry(repoRoot);
  const entry = findAndRemove(registry, taskId, fromState);
  if (!entry) return;

  const updated: TaskRegistryEntry = { ...entry, state: toState, ...updates };
  const key = contextPackKey(updated);
  const set = ensurePackSet(registry, key);
  if (toState === 'active') {
    set.active = updated;
  } else {
    const list = stateList(set, toState);
    if (list) list.push(updated);
  }
  await saveTaskRegistry(repoRoot, registry);
}

export async function removeTask(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const registry = await loadTaskRegistry(repoRoot);
  for (const key of Object.keys(registry.tasks)) {
    const set = registry.tasks[key];
    for (const state of ['open', 'pending', 'failed', 'completed'] as const) {
      set[state] = set[state].filter((e) => e.taskId !== taskId);
    }
    if (set.active?.taskId === taskId) {
      set.active = null;
    }
  }
  await saveTaskRegistry(repoRoot, registry);
}

export function getTasksForContextPack(
  registry: TaskRegistry,
  contextPackId: string,
): ContextPackTaskSet {
  return registry.tasks[contextPackId] ?? emptyTaskSet();
}

export function getAllTasks(registry: TaskRegistry): ContextPackTaskSet {
  const merged = emptyTaskSet();
  for (const set of Object.values(registry.tasks)) {
    merged.open.push(...set.open);
    merged.pending.push(...set.pending);
    if (set.active && !merged.active) merged.active = set.active;
    merged.failed.push(...set.failed);
    merged.completed.push(...set.completed);
  }
  return merged;
}

/**
 * Rebuild the registry from filesystem state. Scans dropbox, pendingitems,
 * and erroritems directories, reading context pack binding from each task's
 * markdown.
 */
export async function repairTaskRegistry(repoRoot: string): Promise<TaskRegistry> {
  const { readdir } = await import('node:fs/promises');
  const registry = emptyRegistry();
  const dirs: { dir: string; state: TaskState }[] = [
    { dir: path.join(repoRoot, 'AgentWorkSpace', 'dropbox'), state: 'open' },
    { dir: path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), state: 'pending' },
    { dir: path.join(repoRoot, 'AgentWorkSpace', 'erroritems'), state: 'failed' },
  ];

  // Check for active item
  const activeItemPath = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-item');
  let activeFileName: string | null = null;
  try {
    activeFileName = (await readFile(activeItemPath, 'utf-8')).trim() || null;
  } catch { /* absent */ }

  for (const { dir, state } of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = (await readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
    } catch { continue; }

    for (const fileName of entries) {
      const filePath = path.join(dir, fileName);
      const content = await readTextFile(filePath);
      const title = content ? extractTaskTitle(content) || null : null;
      const binding = content ? extractContextPackBinding(content) : null;
      const taskId = fileName.replace(/\.md$/, '');

      const effectiveState: TaskState =
        state === 'pending' && fileName === activeFileName ? 'active' : state;

      const entry: TaskRegistryEntry = {
        taskId,
        fileName,
        title,
        state: effectiveState,
        contextPackId: binding?.contextPackId ?? null,
        contextPackDir: binding?.contextPackDir ?? null,
        scopeMode: binding?.scopeMode ?? null,
        selectedRepoIds: binding?.selectedRepoIds ?? [],
        selectedFocusIds: binding?.selectedFocusIds ?? [],
        deepFocusEnabled: binding?.deepFocusEnabled,
        selectedFocusPath: binding?.selectedFocusPath,
        selectedFocusTargetKind: binding?.selectedFocusTargetKind,
        selectedTestTarget: binding?.selectedTestTarget,
        selectedSupportTargets: binding?.selectedSupportTargets,
        createdAt: null,
        completedAt: null,
        archivePath: null,
      };

      const key = contextPackKey(entry);
      const set = ensurePackSet(registry, key);
      if (effectiveState === 'active') {
        set.active = entry;
      } else {
        const list = stateList(set, effectiveState);
        if (list) list.push(entry);
      }
    }
  }

  await saveTaskRegistry(repoRoot, registry);
  return registry;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function stateList(
  set: ContextPackTaskSet,
  state: TaskState,
): TaskRegistryEntry[] | null {
  switch (state) {
    case 'open': return set.open;
    case 'pending': return set.pending;
    case 'failed': return set.failed;
    case 'completed': return set.completed;
    case 'active': return null; // active is singular, not a list
  }
}

function findAndRemove(
  registry: TaskRegistry,
  taskId: string,
  fromState: TaskState,
): TaskRegistryEntry | null {
  for (const key of Object.keys(registry.tasks)) {
    const set = registry.tasks[key];
    if (fromState === 'active') {
      if (set.active?.taskId === taskId) {
        const entry = set.active;
        set.active = null;
        return entry;
      }
    } else {
      const list = stateList(set, fromState);
      if (list) {
        const idx = list.findIndex((e) => e.taskId === taskId);
        if (idx >= 0) return list.splice(idx, 1)[0];
      }
    }
  }
  return null;
}
