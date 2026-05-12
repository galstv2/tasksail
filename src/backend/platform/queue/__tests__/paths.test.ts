import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveQueuePaths } from '../paths.js';

const FAKE_ROOT = '/fake/repo';

describe('resolveQueuePaths — per-task path extensions', () => {
  it('activeItemsDir ends with AgentWorkSpace/pendingitems/.active-items', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.activeItemsDir.endsWith(
      path.join('AgentWorkSpace', 'pendingitems', '.active-items'),
    )).toBe(true);
  });

  it('taskWorktree("t1") ends with AgentWorkSpace/tasks/t1', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskWorktree('t1').endsWith(
      path.join('AgentWorkSpace', 'tasks', 't1'),
    )).toBe(true);
  });

  it('taskHandoffs("t1") ends with AgentWorkSpace/tasks/t1/handoffs', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskHandoffs('t1').endsWith(
      path.join('AgentWorkSpace', 'tasks', 't1', 'handoffs'),
    )).toBe(true);
  });

  it('taskImplementationSteps("t1") ends with AgentWorkSpace/tasks/t1/ImplementationSteps', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskImplementationSteps('t1').endsWith(
      path.join('AgentWorkSpace', 'tasks', 't1', 'ImplementationSteps'),
    )).toBe(true);
  });

  it('taskContextPackSidecar("t1") ends with AgentWorkSpace/tasks/t1/.task.json', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskContextPackSidecar('t1').endsWith(
      path.join('AgentWorkSpace', 'tasks', 't1', '.task.json'),
    )).toBe(true);
  });
});

describe('resolveQueuePaths — back-compat existing fields', () => {
  it('pendingDir is present and ends with AgentWorkSpace/pendingitems', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.pendingDir).toBeDefined();
    expect(qp.pendingDir.endsWith(path.join('AgentWorkSpace', 'pendingitems'))).toBe(true);
  });

  it('taskHandoffs("task-test-001") ends with AgentWorkSpace/tasks/task-test-001/handoffs', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskHandoffs('task-test-001').endsWith(
      path.join('AgentWorkSpace', 'tasks', 'task-test-001', 'handoffs'),
    )).toBe(true);
  });

  it('does not expose removed queue singleton state paths', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(Object.keys(qp)).not.toContain(['active', 'Context', 'Pack', 'Path'].join(''));
  });
});

describe('resolveQueuePaths — method accessor distinctness', () => {
  it('taskHandoffs("a") !== taskHandoffs("b")', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskHandoffs('a')).not.toBe(qp.taskHandoffs('b'));
  });
});

// F37 — activeItemLink function behavior
describe('resolveQueuePaths — activeItemLink F37 sentinel filter', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-paths-f37-'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns undefined when .active-items/ is empty (zero non-sentinel)', () => {
    const qp = resolveQueuePaths(tmpRoot);
    expect(qp.activeItemLink()).toBeUndefined();
  });

  it('returns undefined when only a .completing sentinel file exists (F37 sentinel-only)', () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');
    const qp = resolveQueuePaths(tmpRoot);
    expect(qp.activeItemLink()).toBeUndefined();
  });

  it('returns the single marker path when exactly one non-sentinel file exists', () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a'), '');
    const qp = resolveQueuePaths(tmpRoot);
    expect(qp.activeItemLink()).toBe(path.join(activeItemsDir, 'task-a'));
  });

  it('returns undefined when two or more non-sentinel markers exist (F37 multi-active)', () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a'), '');
    writeFileSync(path.join(activeItemsDir, 'task-b'), '');
    const qp = resolveQueuePaths(tmpRoot);
    expect(qp.activeItemLink()).toBeUndefined();
  });

  it('excludes .completing sentinels from marker count (one real marker + one sentinel → returns marker)', () => {
    const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-a'), '');
    writeFileSync(path.join(activeItemsDir, 'task-a.completing'), '{}');
    const qp = resolveQueuePaths(tmpRoot);
    expect(qp.activeItemLink()).toBe(path.join(activeItemsDir, 'task-a'));
  });
});
