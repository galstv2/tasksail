import { describe, expect, it } from 'vitest';
import path from 'node:path';

import {
  createSharedMcpBootstrapEnv,
  resolveContextPackContainerPath,
} from '../container/sharedMcp.js';

const ITERATIONS = 30;
const TASK_POOL = ['chaos-t1', 'chaos-t2', 'chaos-t3', 'chaos-t4', 'chaos-t5', 'chaos-t6'] as const;

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

describe('parallel chaos — shared MCP invariants', () => {
  const seed = Number.parseInt(process.env['CHAOS_SEED'] ?? '20260418', 10);

  it(`keeps all task requests on one shared MCP endpoint while scopes stay task-specific (seed=${seed})`, () => {
    const rng = makeLcg(seed);
    const repoRoot = path.join(path.sep, 'repo');
    const externalRoot = path.join(path.sep, 'external-packs');
    const sharedEnv = createSharedMcpBootstrapEnv(8811, {
      PATH: '/bin',
      TASKSAIL_TASK_ID: 'old-task',
      ACTIVE_CONTEXT_PACK_DIR: '/workspace/old',
      COMPOSE_PROJECT_NAME: 'tasksail-old-task',
      REPO_CONTEXT_MCP_CONTAINER_NAME: 'repo-context-mcp-old-task',
      REPO_CONTEXT_MCP_PORT: '9999',
      REPO_CONTEXT_MCP_CONTAINER_PORT: '9998',
    });
    const observedContainerPaths = new Map<string, string>();
    const trace: string[] = [];

    for (let step = 0; step < ITERATIONS; step++) {
      const taskId = step < TASK_POOL.length
        ? TASK_POOL[step]!
        : TASK_POOL[rng() % TASK_POOL.length]!;
      const inRepoPack = (rng() & 1) === 0;
      const hostContextPackDir = inRepoPack
        ? path.join(repoRoot, 'contextpacks', taskId)
        : path.join(externalRoot, taskId, 'pack');

      const containerPath = resolveContextPackContainerPath(
        repoRoot,
        hostContextPackDir,
        [externalRoot],
      );
      observedContainerPaths.set(taskId, containerPath);
      trace.push(`${step}: ${taskId} -> ${containerPath}`);

      const ctx = `step=${step} seed=${seed} trace=[\n${trace.slice(-5).join('\n')}\n]`;

      expect(sharedEnv['REPO_CONTEXT_MCP_PORT'], ctx).toBe('8811');
      expect(sharedEnv['REPO_CONTEXT_MCP_CONTAINER_PORT'], ctx).toBe('8811');
      expect(sharedEnv, ctx).not.toHaveProperty('TASKSAIL_TASK_ID');
      expect(sharedEnv, ctx).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
      expect(sharedEnv, ctx).not.toHaveProperty('COMPOSE_PROJECT_NAME');
      expect(sharedEnv, ctx).not.toHaveProperty('REPO_CONTEXT_MCP_CONTAINER_NAME');

      if (inRepoPack) {
        expect(containerPath, ctx).toBe(`/workspace/contextpacks/${taskId}`);
      } else {
        expect(containerPath, ctx).toBe(`/context-pack-roots/0/${taskId}/pack`);
      }
    }

    expect(observedContainerPaths.size).toBe(TASK_POOL.length);
    expect(new Set(observedContainerPaths.values()).size).toBe(TASK_POOL.length);
  });
});
