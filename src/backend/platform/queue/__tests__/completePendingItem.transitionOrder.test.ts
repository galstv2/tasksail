import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn().mockResolvedValue({
    passed: true,
    stdout: '{}',
    stderr: '',
    exitCode: 0,
    data: { record_md_path: 'archive.md' },
  }),
}));

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../errorItems.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../errorItems.js')>()),
  commitTaskSnapshot: vi.fn().mockResolvedValue(true),
}));

vi.mock('../branchVerification.js', () => ({
  verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn().mockResolvedValue({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'direct',
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: 10,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    auto_merge: false,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }),
}));

vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(null),
  ADVISORY_FINDING_HEADING: '## QA Advisory Finding',
}));

vi.mock('../../container/sharedMcp.js', () => ({
  ensureSharedMcpRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn().mockResolvedValue({ status: 'started', pid: 12345 }),
}));

const { transitionTaskMock } = vi.hoisted(() => ({
  transitionTaskMock: vi.fn(),
}));
vi.mock('../taskRegistry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../taskRegistry.js')>()),
  transitionTask: transitionTaskMock,
}));

import { completePendingItem } from '../completePendingItem.js';

describe('completePendingItem transition ordering', () => {
  let repoRoot: string;

  beforeEach(async () => {
    transitionTaskMock.mockReset();
    repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-transition-order-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('transitions active to completed only after the active marker is unlinked', async () => {
    const taskId = 'transition-order-task';
    await seedActiveTask(repoRoot, taskId);
    transitionTaskMock.mockImplementation(async () => {
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', taskId))).toBe(false);
    });

    await completePendingItem({
      repoRoot,
      taskId,
      skipValidation: true,
      contextPackDir: path.join(repoRoot, 'context-pack'),
    });

    expect(transitionTaskMock).toHaveBeenCalledWith(
      repoRoot,
      taskId,
      'active',
      'completed',
      expect.objectContaining({ archivePath: 'archive.md' }),
    );
  });
});

async function seedActiveTask(repoRoot: string, taskId: string): Promise<void> {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
  await mkdir(activeDir, { recursive: true });
  await mkdir(handoffsDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'context-pack'), { recursive: true });
  await writeFile(path.join(pendingDir, `${taskId}.md`), `# ${taskId}\n`);
  await writeFile(path.join(activeDir, taskId), `${taskId}.md`);
  await writeFile(path.join(handoffsDir, 'professional-task.md'), '# Task\n');
  await writeFile(path.join(handoffsDir, 'implementation-spec.md'), '# Spec\n');
  await writeFile(path.join(handoffsDir, 'retrospective-input.md'), '# Retro\n\n- Retrospective Required: false\n');
  await writeFile(path.join(handoffsDir, 'final-summary.md'), '# Final\n');
  await writeFile(path.join(handoffsDir, 'issues.md'), '# Issues\n');
}
