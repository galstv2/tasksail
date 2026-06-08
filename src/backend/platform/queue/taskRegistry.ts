/**
 * Centralized task registry — JSON-based index of all tasks keyed by context pack.
 *
 * The registry lives at `.platform-state/task-registry.json` and is updated
 * at each state transition by the pipeline alongside the existing file moves.
 * The Task Board reads from the registry instead of scanning directories.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ensureDir, readTextFile } from '../core/index.js';
import {
  extractTaskTitle,
  extractContextPackBinding,
  type TaskContextPackBinding,
  type TaskContextPackTarget,
} from './markdown.js';
import type { PrimaryFocusTarget } from '../context-pack/deepFocusNormalization.js';
import { acquireRegistryLock } from './registryLock.js';

const REGISTRY_RELATIVE_PATH = '.platform-state/task-registry.json';
const SCHEMA_VERSION = 2;

export type TaskState = 'open' | 'pending' | 'active' | 'failed' | 'completed';

export interface TaskRegistryEntry {
  taskId: string;
  taskGuid?: string;
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
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
  createdAt: string | null;
  completedAt: string | null;
  archivePath: string | null;
}

export interface ContextPackTaskSet {
  open: TaskRegistryEntry[];
  pending: TaskRegistryEntry[];
  /** Breaking change: active is now an array (was TaskRegistryEntry | null). */
  active: TaskRegistryEntry[];
  failed: TaskRegistryEntry[];
  completed: TaskRegistryEntry[];
}

export interface TaskRegistry {
  schema_version: number;
  tasks: Record<string, ContextPackTaskSet>;
}

// In-process async mutex (no third-party deps).

let _registryMutexChain: Promise<void> = Promise.resolve();

/**
 * Acquire the in-process registry mutex. Returns a release function.
 * All load→mutate→save pairs in registerTask / transitionTask go through this.
 */
function acquireRegistryMutex(): Promise<() => void> {
  let releaseFn!: () => void;
  const next = new Promise<void>((resolve) => { releaseFn = resolve; });
  const gate = _registryMutexChain.then(() => releaseFn);
  _registryMutexChain = _registryMutexChain.then(() => next);
  return gate;
}

async function withRegistryWrite<T>(
  repoRoot: string,
  mutator: (registry: TaskRegistry) => T | Promise<T>,
): Promise<T> {
  const releaseMutex = await acquireRegistryMutex();
  try {
    const releaseFile = await acquireRegistryLock(repoRoot);
    try {
      const registry = await loadTaskRegistry(repoRoot);
      const result = await mutator(registry);
      await saveTaskRegistry(repoRoot, registry);
      return result;
    } finally {
      await releaseFile();
    }
  } finally {
    releaseMutex();
  }
}

function emptyTaskSet(): ContextPackTaskSet {
  return { open: [], pending: [], active: [], failed: [], completed: [] };
}

function emptyRegistry(): TaskRegistry {
  return { schema_version: SCHEMA_VERSION, tasks: {} };
}

function registryPath(repoRoot: string): string {
  return path.join(repoRoot, REGISTRY_RELATIVE_PATH);
}

/**
 * Public accessor for the registry file path. Callers outside this module
 * (e.g. the Task Board fs-watcher) MUST use this instead of reconstructing
 * the literal path — the registry's on-disk location is an internal detail.
 */
export function getRegistryPath(repoRoot: string): string {
  return registryPath(repoRoot);
}

function contextPackKey(entry: Pick<TaskRegistryEntry, 'contextPackId'>): string {
  return entry.contextPackId || '_unbound';
}

function extractBinding(content: string | undefined): TaskContextPackBinding | null {
  if (!content) {
    return null;
  }
  const result = extractContextPackBinding(content);
  return result.kind === 'binding' ? result.binding : null;
}

function ensurePackSet(registry: TaskRegistry, key: string): ContextPackTaskSet {
  if (!registry.tasks[key]) {
    registry.tasks[key] = emptyTaskSet();
  }
  return registry.tasks[key];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function ensureTaskGuid(entry: TaskRegistryEntry): TaskRegistryEntry {
  const taskGuid = typeof entry.taskGuid === 'string' && UUID_PATTERN.test(entry.taskGuid)
    ? entry.taskGuid
    : randomUUID();
  return { ...entry, taskGuid };
}

function normalizeTaskSet(set: ContextPackTaskSet): ContextPackTaskSet {
  return {
    open: set.open.map(ensureTaskGuid),
    pending: set.pending.map(ensureTaskGuid),
    active: set.active.map(ensureTaskGuid),
    failed: set.failed.map(ensureTaskGuid),
    completed: set.completed.map(ensureTaskGuid),
  };
}

function collectTaskGuids(registry: TaskRegistry): Map<string, string> {
  const taskGuids = new Map<string, string>();
  for (const set of Object.values(registry.tasks)) {
    for (const entry of [
      ...set.open,
      ...set.pending,
      ...set.active,
      ...set.failed,
      ...set.completed,
    ]) {
      if (entry.taskGuid) {
        taskGuids.set(entry.taskId, entry.taskGuid);
      }
    }
  }
  return taskGuids;
}

// Schema version handling.

/**
 * Raw on-disk v1 shape: active was TaskRegistryEntry | null.
 */
interface RawContextPackTaskSetV1 {
  open?: TaskRegistryEntry[];
  pending?: TaskRegistryEntry[];
  active?: TaskRegistryEntry | TaskRegistryEntry[] | null;
  failed?: TaskRegistryEntry[];
  completed?: TaskRegistryEntry[];
}

interface RawRegistryOnDisk {
  schema_version?: number;
  tasks?: Record<string, RawContextPackTaskSetV1>;
}

function migrateV1Set(raw: RawContextPackTaskSetV1): ContextPackTaskSet {
  let active: TaskRegistryEntry[];
  if (Array.isArray(raw.active)) {
    active = raw.active;
  } else if (raw.active != null) {
    active = [raw.active];
  } else {
    active = [];
  }
  return {
    open: (raw.open ?? []).map(ensureTaskGuid),
    pending: (raw.pending ?? []).map(ensureTaskGuid),
    active: active.map(ensureTaskGuid),
    failed: (raw.failed ?? []).map(ensureTaskGuid),
    completed: (raw.completed ?? []).map(ensureTaskGuid),
  };
}

export async function loadTaskRegistry(repoRoot: string): Promise<TaskRegistry> {
  try {
    const raw = await readFile(registryPath(repoRoot), 'utf-8');
    const parsed = JSON.parse(raw) as RawRegistryOnDisk;
    const version = parsed.schema_version;

    // Reject future / corrupt versions (downgrade guard)
    if (version !== undefined && version !== null && (version < 1 || version > 2)) {
      const err = new Error(`task-registry-stale-schema: unsupported schema_version ${version}`);
      (err as Error & { code: string }).code = 'task-registry-stale-schema';
      throw err;
    }

    // v1 (no schema_version, or schema_version: 1) — migrate active field in-memory
    if (!version || version === 1) {
      const migrated: TaskRegistry = {
        schema_version: SCHEMA_VERSION,
        tasks: {},
      };
      for (const [key, rawSet] of Object.entries(parsed.tasks ?? {})) {
        migrated.tasks[key] = migrateV1Set(rawSet);
      }
      return migrated;
    }

    // v2 — already correct shape; normalise missing arrays
    const registry: TaskRegistry = {
      schema_version: SCHEMA_VERSION,
      tasks: {},
    };
    for (const [key, rawSet] of Object.entries(parsed.tasks ?? {})) {
      registry.tasks[key] = {
        open: ((rawSet as ContextPackTaskSet).open ?? []).map(ensureTaskGuid),
        pending: ((rawSet as ContextPackTaskSet).pending ?? []).map(ensureTaskGuid),
        active: Array.isArray((rawSet as ContextPackTaskSet).active)
          ? (rawSet as ContextPackTaskSet).active.map(ensureTaskGuid)
          : [],
        failed: ((rawSet as ContextPackTaskSet).failed ?? []).map(ensureTaskGuid),
        completed: ((rawSet as ContextPackTaskSet).completed ?? []).map(ensureTaskGuid),
      };
    }
    return registry;
  } catch (err: unknown) {
    // Re-throw stale-schema errors so callers can handle them
    if (
      err instanceof Error &&
      'code' in err &&
      (err as Error & { code: string }).code === 'task-registry-stale-schema'
    ) {
      throw err;
    }
    return emptyRegistry();
  }
}

export async function saveTaskRegistry(
  repoRoot: string,
  registry: TaskRegistry,
): Promise<void> {
  const filePath = registryPath(repoRoot);
  await ensureDir(path.dirname(filePath));
  // Always stamp schema_version: 2 on write
  const toWrite: TaskRegistry = {
    ...registry,
    schema_version: 2,
    tasks: Object.fromEntries(
      Object.entries(registry.tasks).map(([key, set]) => [key, normalizeTaskSet(set)]),
    ),
  };
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(toWrite, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, filePath);
}

export async function registerTask(
  repoRoot: string,
  entry: TaskRegistryEntry,
): Promise<void> {
  await withRegistryWrite(repoRoot, (registry) => {
    const normalizedEntry = ensureTaskGuid(entry);
    const key = contextPackKey(normalizedEntry);
    const set = ensurePackSet(registry, key);
    if (normalizedEntry.state === 'active') {
      if (!set.active.some((e) => e.taskId === normalizedEntry.taskId)) {
        set.active.push(normalizedEntry);
      }
    } else {
      const list = stateList(set, normalizedEntry.state);
      if (list && !list.some((e) => e.taskId === normalizedEntry.taskId)) {
        list.push(normalizedEntry);
      }
    }
  });
}

export async function transitionTask(
  repoRoot: string,
  taskId: string,
  fromState: TaskState,
  toState: TaskState,
  updates?: Partial<TaskRegistryEntry>,
): Promise<void> {
  await withRegistryWrite(repoRoot, (registry) => {
    const entry = findAndRemove(registry, taskId, fromState);
    if (!entry) return;

    const updated: TaskRegistryEntry = { ...entry, state: toState, ...updates };
    const key = contextPackKey(updated);
    const set = ensurePackSet(registry, key);
    if (toState === 'active') {
      if (!set.active.some((e) => e.taskId === updated.taskId)) {
        set.active.push(updated);
      }
    } else {
      const list = stateList(set, toState);
      if (list) list.push(updated);
    }
  });
}

export async function removeTask(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  await withRegistryWrite(repoRoot, (registry) => {
    for (const key of Object.keys(registry.tasks)) {
      const set = registry.tasks[key];
      for (const state of ['open', 'pending', 'failed', 'completed'] as const) {
        set[state] = set[state].filter((e) => e.taskId !== taskId);
      }
      set.active = set.active.filter((e) => e.taskId !== taskId);
    }
  });
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
    merged.active.push(...set.active);
    merged.failed.push(...set.failed);
    merged.completed.push(...set.completed);
  }
  return merged;
}

/**
 * Rebuild the registry from filesystem state. Scans dropbox, pendingitems,
 * and error-items directories, reading context pack binding from each task's
 * markdown.
 */
export async function repairTaskRegistry(repoRoot: string): Promise<TaskRegistry> {
  return withRegistryWrite(repoRoot, async (registry) => {
    const previousTaskGuids = collectTaskGuids(registry);
    registry.schema_version = SCHEMA_VERSION;
    registry.tasks = {};
    const dirs: { dir: string; state: TaskState }[] = [
      { dir: path.join(repoRoot, 'AgentWorkSpace', 'dropbox'), state: 'open' },
      { dir: path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), state: 'pending' },
      { dir: path.join(repoRoot, 'AgentWorkSpace', 'error-items'), state: 'failed' },
    ];

  // Check for active items via .active-items/ directory.
  const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
  let activeFileNames: string[] = [];
  try {
    const entries = await readdir(activeItemsDir);
    activeFileNames = entries.filter((f) => !f.endsWith('.completing'));
  } catch { /* absent */ }

  // Build a set of active taskIds without queue-file suffixes for quick lookup.
  const activeTaskIds = new Set(activeFileNames.map((f) => f.replace(/\.md$/, '')));

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
      const binding = extractBinding(content);
      const taskId = fileName.replace(/\.md$/, '');

      const effectiveState: TaskState =
        state === 'pending' && activeTaskIds.has(taskId) ? 'active' : state;

      const entry: TaskRegistryEntry = {
        taskId,
        taskGuid: previousTaskGuids.get(taskId) ?? randomUUID(),
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
        selectedFocusTargets: binding?.selectedFocusTargets,
        selectedTestTarget: binding?.selectedTestTarget,
        selectedSupportTargets: binding?.selectedSupportTargets,
        createdAt: null,
        completedAt: null,
        archivePath: null,
      };

      const key = contextPackKey(entry);
      const set = ensurePackSet(registry, key);
      if (effectiveState === 'active') {
        if (!set.active.some((e) => e.taskId === entry.taskId)) {
          set.active.push(entry);
        }
      } else {
        const list = stateList(set, effectiveState);
        if (list) list.push(entry);
      }
    }
  }

    return registry;
  });
}

function stateList(
  set: ContextPackTaskSet,
  state: TaskState,
): TaskRegistryEntry[] | null {
  switch (state) {
    case 'open': return set.open;
    case 'pending': return set.pending;
    case 'failed': return set.failed;
    case 'completed': return set.completed;
    case 'active': return null; // active is an array but managed separately
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
      const idx = set.active.findIndex((e) => e.taskId === taskId);
      if (idx >= 0) {
        return set.active.splice(idx, 1)[0] ?? null;
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
