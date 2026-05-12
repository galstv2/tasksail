import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('../../container/sharedMcp.js', () => ({
  ensureSharedMcpRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../container/runtime.js', () => ({
  createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: false }),
}));

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn().mockResolvedValue({ status: 'started', pid: 12345 }),
}));

import { activateNextPendingItemIfReady } from '../operations.js';
import { resolveQueuePaths } from '../paths.js';

describe('activateNextPendingItemIfReady TOCTOU guard', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-activate-'));
    await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
    await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
    await mkdir(path.join(repoRoot, 'config'), { recursive: true });
    await writeFile(path.join(repoRoot, 'config', 'platform.default.json'), JSON.stringify({
      schema_version: 1,
      cli_provider: 'copilot',
      container_runtime: 'direct',
      container_engine_host: 'auto',
      container_engine_wsl_distro: null,
      max_parallel_tasks: 1,
      retain_failed_task_worktrees: true,
      max_retained_failed_task_worktrees: 10,
      max_retry_generations_per_slug: 5,
      completed_task_runtime_retention_ms: 3600000,
      mcp_port: 8811,
      repo_context_mcp_external_mount_roots: [],
    }, null, 2));
    for (const name of ['professional-task.md', 'implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md', 'parallel-ok.md']) {
      await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'templates', name), `# ${name}\n`);
    }
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'templates', 'slice-template.md'), '# Slice\n');
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'task-a.md'), '# Task A\n');
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'task-b.md'), '# Task B\n');
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('two parallel activate calls with cap=1 activate exactly one task', async () => {
    const paths = resolveQueuePaths(repoRoot);

    const results = await Promise.all([
      activateNextPendingItemIfReady({ paths, repoRoot }),
      activateNextPendingItemIfReady({ paths, repoRoot }),
    ]);

    expect(results.filter((result) => result.activated)).toHaveLength(1);
    expect(results.filter((result) => !result.activated).map((result) => result.reason)).toEqual([
      'concurrency-cap-reached',
    ]);
    expect(readdirSync(paths.activeItemsDir).filter((entry) => !entry.endsWith('.completing'))).toHaveLength(1);
  });
});
