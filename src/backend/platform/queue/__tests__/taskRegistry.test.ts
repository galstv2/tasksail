import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  repairTaskRegistry,
  loadTaskRegistry,
  saveTaskRegistry,
  registerTask,
  transitionTask,
  getAllTasks,
  type TaskRegistryEntry,
  type TaskRegistry,
} from '../taskRegistry.js';

describe('taskRegistry Deep Focus persistence', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-registry-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('captures Deep Focus binding fields while rebuilding the registry', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'task.md'),
      `# Queue Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: focused
- Selected Repo IDs: backend
- Selected Focus IDs: api
- Deep Focus Enabled: true
- Selected Focus Path: src/orders
- Selected Focus Target Kind: directory
- Selected Test Target: {"path":"tests/orders","kind":"directory"}
- Selected Support Targets: [{"path":"docs/orders.md","kind":"file"}]

## Request Summary

Body
`,
      'utf-8',
    );

    const registry = await repairTaskRegistry(repoRoot);
    const entry = registry.tasks.orders?.open[0];

    expect(entry).toMatchObject({
      contextPackId: 'orders',
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });
  });
});

// ── §4.5 new tests ──────────────────────────────────────────────────────────

function makeEntry(taskId: string, state: TaskRegistryEntry['state']): TaskRegistryEntry {
  return {
    taskId,
    fileName: `${taskId}.md`,
    title: taskId,
    state,
    contextPackId: 'pack1',
    contextPackDir: '/packs/pack1',
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: null,
    completedAt: null,
    archivePath: null,
  };
}

describe('taskRegistry §4.5 — array active shape', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-reg45-'));
    mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('getAllTasks returns active as array', async () => {
    const registry = await loadTaskRegistry(repoRoot);
    // Register two active tasks
    await registerTask(repoRoot, makeEntry('task1', 'active'));
    await registerTask(repoRoot, makeEntry('task2', 'active'));

    const fresh = await loadTaskRegistry(repoRoot);
    const all = getAllTasks(fresh);
    expect(Array.isArray(all.active)).toBe(true);
    expect(all.active.length).toBe(2);
    expect(all.active.map((e) => e.taskId).sort()).toEqual(['task1', 'task2']);
  });

  it('concurrent transitionTask calls — both updates persisted, no lost writes', async () => {
    // Seed two pending entries
    await registerTask(repoRoot, makeEntry('task-a', 'pending'));
    await registerTask(repoRoot, makeEntry('task-b', 'pending'));

    // Fire two concurrent transitions
    await Promise.all([
      transitionTask(repoRoot, 'task-a', 'pending', 'active'),
      transitionTask(repoRoot, 'task-b', 'pending', 'active'),
    ]);

    const fresh = await loadTaskRegistry(repoRoot);
    const all = getAllTasks(fresh);
    expect(all.active.length).toBe(2);
    expect(all.pending.length).toBe(0);
  });

  it('v1 fixture with non-null active migrates to array of length 1', async () => {
    const registryPath = path.join(repoRoot, '.platform-state', 'task-registry.json');
    const v1: Record<string, unknown> = {
      // no schema_version (v1)
      tasks: {
        pack1: {
          open: [],
          pending: [],
          active: { taskId: 'T1', fileName: 'T1.md', title: 'T1', state: 'active',
            contextPackId: 'pack1', contextPackDir: null, scopeMode: null,
            selectedRepoIds: [], selectedFocusIds: [], createdAt: null,
            completedAt: null, archivePath: null },
          failed: [],
          completed: [],
        },
      },
    };
    writeFileSync(registryPath, JSON.stringify(v1, null, 2), 'utf-8');

    const loaded = await loadTaskRegistry(repoRoot);
    const set = loaded.tasks.pack1!;
    expect(Array.isArray(set.active)).toBe(true);
    expect(set.active.length).toBe(1);
    expect(set.active[0]!.taskId).toBe('T1');
  });

  it('v1 fixture with null active migrates to empty array', async () => {
    const registryPath = path.join(repoRoot, '.platform-state', 'task-registry.json');
    const v1: Record<string, unknown> = {
      tasks: {
        pack1: {
          open: [],
          pending: [],
          active: null,
          failed: [],
          completed: [],
        },
      },
    };
    writeFileSync(registryPath, JSON.stringify(v1, null, 2), 'utf-8');

    const loaded = await loadTaskRegistry(repoRoot);
    const set = loaded.tasks.pack1!;
    expect(Array.isArray(set.active)).toBe(true);
    expect(set.active.length).toBe(0);
  });

  it('saveTaskRegistry writes schema_version: 2', async () => {
    const registry = await loadTaskRegistry(repoRoot);
    await saveTaskRegistry(repoRoot, registry);

    const raw = JSON.parse(readFileSync(
      path.join(repoRoot, '.platform-state', 'task-registry.json'),
      'utf-8',
    ));
    expect(raw.schema_version).toBe(2);
  });

  it('downgrade guard: schema_version: 3 throws task-registry-stale-schema', async () => {
    const registryPath = path.join(repoRoot, '.platform-state', 'task-registry.json');
    writeFileSync(registryPath, JSON.stringify({ schema_version: 3, tasks: {} }), 'utf-8');

    await expect(loadTaskRegistry(repoRoot)).rejects.toMatchObject({
      code: 'task-registry-stale-schema',
    });
  });

  it('v1 fixture with schema_version: 1 migrates active to array', async () => {
    const registryPath = path.join(repoRoot, '.platform-state', 'task-registry.json');
    const v1: Record<string, unknown> = {
      schema_version: 1,
      tasks: {
        pack1: {
          open: [],
          pending: [],
          active: { taskId: 'OLD', fileName: 'OLD.md', title: 'OLD', state: 'active',
            contextPackId: 'pack1', contextPackDir: null, scopeMode: null,
            selectedRepoIds: [], selectedFocusIds: [], createdAt: null,
            completedAt: null, archivePath: null },
          failed: [],
          completed: [],
        },
      },
    };
    writeFileSync(registryPath, JSON.stringify(v1, null, 2), 'utf-8');

    const loaded = await loadTaskRegistry(repoRoot);
    const set = loaded.tasks.pack1!;
    expect(Array.isArray(set.active)).toBe(true);
    expect(set.active[0]!.taskId).toBe('OLD');
  });
});
