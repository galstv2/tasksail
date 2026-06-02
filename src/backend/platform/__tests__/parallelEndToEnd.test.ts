import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSharedMcpBootstrapEnv,
  getSharedMcpHealthUrl,
  getSharedMcpUrl,
  resolveContextPackContainerPath,
} from '../container/sharedMcp.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { _clearPlatformConfigCache } from '../platform-config/get.js';

const TASK_A = 'parallel-task-a';
const TASK_B = 'parallel-task-b';
const TASK_C = 'parallel-task-c';

function seedPlatformJson(repoRoot: string, cap: number): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify(
      {
        schema_version: 1,
        container_runtime: 'docker',
        max_parallel_tasks: cap,
        retain_failed_task_worktrees: false,
        max_retained_failed_task_worktrees: 5,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
  mkdirSync(path.join(dir, 'runtime'), { recursive: true });
}

describe('parallel end-to-end — shared MCP isolation contracts', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-e2e-'));
    seedPlatformJson(repoRoot, 3);
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it('all tasks share the configured MCP URL while context-pack scopes remain distinct', async () => {
    const urlA = await getSharedMcpUrl(repoRoot);
    const urlB = await getSharedMcpUrl(repoRoot);
    const healthUrl = await getSharedMcpHealthUrl(repoRoot);

    expect(urlA).toBe('http://127.0.0.1:8811/sse');
    expect(urlB).toBe(urlA);
    expect(healthUrl).toBe('http://127.0.0.1:8811/health');

    expect(
      resolveContextPackContainerPath(
        repoRoot,
        path.join(repoRoot, 'contextpacks', TASK_A),
        [],
      ),
    ).toBe(`/workspace/contextpacks/${TASK_A}`);
    expect(
      resolveContextPackContainerPath(
        repoRoot,
        path.join(repoRoot, 'contextpacks', TASK_B),
        [],
      ),
    ).toBe(`/workspace/contextpacks/${TASK_B}`);
  });

  it('shared bootstrap env scrubs task identity instead of deriving per-task containers', () => {
    const env = createSharedMcpBootstrapEnv(8811, {
      PATH: '/bin',
      TASKSAIL_TASK_ID: TASK_A,
      ACTIVE_CONTEXT_PACK_DIR: `/workspace/contextpacks/${TASK_A}`,
      COMPOSE_PROJECT_NAME: `tasksail-${TASK_A}`,
      REPO_CONTEXT_MCP_CONTAINER_NAME: `repo-context-mcp-${TASK_A}`,
      REPO_CONTEXT_MCP_PORT: '8819',
    });

    expect(env['PATH']).toBe('/bin');
    expect(env['REPO_CONTEXT_MCP_PORT']).toBe('8811');
    expect(env['REPO_CONTEXT_MCP_CONTAINER_PORT']).toBe('8811');
    expect(env).not.toHaveProperty('TASKSAIL_TASK_ID');
    expect(env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
    expect(env).not.toHaveProperty('COMPOSE_PROJECT_NAME');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_CONTAINER_NAME');
  });

  it('finalizing one task schedules only that task runtime for GC and preserves peers', async () => {
    const taskARuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TASK_A);
    const taskBRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TASK_B);
    mkdirSync(path.join(taskARuntime, 'guardrails'), { recursive: true });
    mkdirSync(path.join(taskBRuntime, 'guardrails'), { recursive: true });
    writeFileSync(path.join(taskARuntime, 'guardrails', 'a.json'), '{"a":true}', 'utf-8');
    writeFileSync(path.join(taskBRuntime, 'guardrails', 'b.json'), '{"b":true}', 'utf-8');

    await finalizeTaskWorktrees(TASK_A, 'completed', repoRoot);

    expect(existsSync(path.join(taskARuntime, '.gc-after-ts'))).toBe(true);
    expect(existsSync(path.join(taskBRuntime, 'guardrails', 'b.json'))).toBe(true);
    expect(readFileSync(path.join(taskBRuntime, 'guardrails', 'b.json'), 'utf-8')).toBe('{"b":true}');
  });

  it('concurrent task scope resolution is deterministic for repo and external mount roots', async () => {
    const externalRoot = path.join(repoRoot, '..', 'external-packs');
    const [scopeA, scopeB, scopeC] = await Promise.all([
      Promise.resolve(resolveContextPackContainerPath(repoRoot, path.join(repoRoot, 'packs', TASK_A), [externalRoot])),
      Promise.resolve(resolveContextPackContainerPath(repoRoot, path.join(externalRoot, TASK_B), [externalRoot])),
      Promise.resolve(resolveContextPackContainerPath(repoRoot, path.join(repoRoot, 'packs', TASK_C), [externalRoot])),
    ]);

    expect(scopeA).toBe(`/workspace/packs/${TASK_A}`);
    expect(scopeB).toBe(`/context-pack-roots/0/${TASK_B}`);
    expect(scopeC).toBe(`/workspace/packs/${TASK_C}`);
    expect(new Set([scopeA, scopeB, scopeC]).size).toBe(3);
  });
});
