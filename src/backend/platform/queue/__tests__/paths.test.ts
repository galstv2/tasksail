import { describe, it, expect } from 'vitest';
import path from 'node:path';
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

  it('handoffsDir is present and ends with AgentWorkSpace/handoffs', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.handoffsDir).toBeDefined();
    expect(qp.handoffsDir.endsWith(path.join('AgentWorkSpace', 'handoffs'))).toBe(true);
  });

  it('activeContextPackPath is present and ends with active-context-pack.json', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.activeContextPackPath).toBeDefined();
    expect(qp.activeContextPackPath.endsWith('active-context-pack.json')).toBe(true);
  });
});

describe('resolveQueuePaths — method accessor distinctness', () => {
  it('taskHandoffs("a") !== taskHandoffs("b")', () => {
    const qp = resolveQueuePaths(FAKE_ROOT);
    expect(qp.taskHandoffs('a')).not.toBe(qp.taskHandoffs('b'));
  });
});
