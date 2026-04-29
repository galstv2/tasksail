import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function getReapedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  if (typeof pid !== 'number') {
    throw new Error('Failed to spawn child process for stale-pid test');
  }
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  // Brief delay so the OS reaps the zombie before we probe.
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  return pid;
}
import {
  acquireDirLock,
  acquireDirLockOrThrow,
  moveDropboxItemsOnce,
  queueNameForSource,
  activateNextPendingItemIfReady,
} from '../operations.js';
import { resetHandoffArtifacts } from '../lifecycle.js';
import {
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsTemplatePath,
  resolveQueuePaths,
} from '../paths.js';
import { extractContextPackBinding, formatContextPackBindingSection } from '../markdown.js';
import { listActivePipelines, stopPipeline } from '../../agent-runner/pipelineSupervisor.js';

async function stopPipelinesStartedByTest(): Promise<void> {
  await Promise.all(
    listActivePipelines().map(({ taskId }) => stopPipeline(taskId, 1000)),
  );
}

function seedDistributedContextPack(
  repoRoot: string,
  options: { repoId?: string; packName?: string } = {},
): { contextPackDir: string; repoDir: string; repoId: string } {
  const repoId = options.repoId ?? 'backend';
  const contextPackDir = path.join(repoRoot, 'contextpacks', options.packName ?? 'orders');
  const repoDir = path.join(repoRoot, 'external-repos', repoId);
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    path.join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      context_pack_id: options.packName ?? 'orders',
      estate_type: 'distributed-platform',
      repositories: [{
        repo_id: repoId,
        local_paths: [repoDir],
        repository_type: 'primary',
        default_focusable: true,
        activation_priority: 100,
      }],
      primary_working_repo_ids: [repoId],
      primary_focus_area_ids: [],
    }, null, 2) + '\n',
    'utf-8',
  );
  return { contextPackDir, repoDir, repoId };
}

describe('acquireDirLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('B6 writes an owner marker when acquiring a lock and removes it on release', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLock(lockDir, 3, 10);

    expect(release).not.toBeNull();
    expect(existsSync(lockDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid,
    });

    await release!();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('fails to acquire when lock is already held', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    mkdirSync(lockDir);

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).toBeNull();

    // Clean up
    rmSync(lockDir, { recursive: true });
  });

  it('re-exports the throwing lock helper from operations', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLockOrThrow(lockDir, 'test operation');

    expect(existsSync(lockDir)).toBe(true);

    await release();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('reclaims an orphaned lock when the recorded holder PID is dead', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const deadPid = await getReapedPid();
    mkdirSync(lockDir);
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: deadPid })}\n`, 'utf-8');

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).not.toBeNull();
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid,
    });

    await release!();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('does not reclaim a lock whose holder PID is still alive', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    mkdirSync(lockDir);
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`, 'utf-8');

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).toBeNull();

    rmSync(lockDir, { recursive: true });
  });

  it('release does not delete the lock when ownership has been reclaimed by another acquirer', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLock(lockDir, 3, 10);
    expect(release).not.toBeNull();

    // Simulate another acquirer reclaiming this lock as stale and writing
    // their own owner record. The original release must not delete the new
    // acquirer's lock.
    writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid + 1 })}\n`, 'utf-8');

    await release!();
    expect(existsSync(lockDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid + 1,
    });

    rmSync(lockDir, { recursive: true });
  });
});

describe('moveDropboxItemsOnce', () => {
  let tmpDir: string;
  let dropboxDir: string;
  let pendingDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-move-'));
    dropboxDir = path.join(tmpDir, 'dropbox');
    pendingDir = path.join(tmpDir, 'pending');
    mkdirSync(dropboxDir);
    mkdirSync(pendingDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('moves .md files from dropbox to pending', async () => {
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A');
    writeFileSync(path.join(dropboxDir, 'task-b.md'), '# Task B');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(2);

    const pendingFiles = readdirSync(pendingDir);
    expect(pendingFiles.length).toBe(2);
    expect(pendingFiles.every((f) => f.endsWith('.md'))).toBe(true);

    // Source files should be gone
    expect(readdirSync(dropboxDir).length).toBe(0);
  });

  it('ignores non-markdown files', async () => {
    writeFileSync(path.join(dropboxDir, 'task.md'), '# Task');
    writeFileSync(path.join(dropboxDir, 'image.png'), 'binary');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(1);
    // The .png file should still be in dropbox
    expect(existsSync(path.join(dropboxDir, 'image.png'))).toBe(true);
  });

  it('returns 0 when dropbox is empty', async () => {
    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);
    expect(count).toBe(0);
  });
});

describe('queueNameForSource', () => {
  it('generates a timestamped name with the original filename', () => {
    const name = queueNameForSource('/some/path/my-task.md');
    expect(name).toMatch(/^\d{8}t\d{6}z_my-task\.md$/);
  });

  it('preserves the basename of the source file', () => {
    const name = queueNameForSource('/deep/nested/path/special-file.md');
    expect(name).toContain('special-file.md');
  });

  it('strips a legacy hyphenated canonical prefix before re-queueing', () => {
    const name = queueNameForSource('/some/path/20260307T183000Z-my-task.md');
    expect(name).toMatch(/^\d{8}t\d{6}z_my-task\.md$/);
  });

  it('strips an underscore canonical prefix before re-queueing', () => {
    const name = queueNameForSource('/some/path/20260307T183000Z_my-task.md');
    expect(name).toMatch(/^\d{8}t\d{6}z_my-task\.md$/);
  });

  it('normalizes unsafe ingress names into valid task-id shape', () => {
    const name = queueNameForSource('/some/path/CAP.Parent Task!.md');
    expect(name).toMatch(/^\d{8}t\d{6}z_cap-parent-task\.md$/);
  });
});

describe('activateNextPendingItemIfReady', () => {
  let repoRoot: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    // Use canonical AgentWorkSpace structure so resolveQueuePaths works correctly.
    // Per-task handoffs live under AgentWorkSpace/tasks/<taskId>/handoffs/ (created by activation).
    const TEST_TASK_ID = 'task-test-001';
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-activate-lock-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('activates a pending item when no failure lock is present (lock system removed)', async () => {
    writeFileSync(path.join(pendingDir, 'task-003.md'), '# Task');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, 'slice-template.md'), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-items', 'task-003'))).toBe(true);
  });

  it('seeds handoffs and ImplementationSteps templates when activating a pending item', async () => {
    writeFileSync(path.join(pendingDir, 'task-004.md'), '# Add search\n');
    for (const filename of HANDOFF_FILES) {
      const template = filename === 'retrospective-input.md'
        ? '# retrospective-input.md\n\n## Task Metadata\n\n- Task ID:\n- Retrospective Required:\n'
        : filename === 'professional-task.md'
          ? '# Professional Task\n\n## Task Metadata\n\n- Task ID:\n- Task Title:\n- Initialized At (UTC):\n- Active Branch:\n- Intake Source:\n\n## Raw Request\n'
          : `# ${filename}\n\n- Task ID:\n`;
      writeFileSync(path.join(templatesDir, filename), template);
    }
    writeFileSync(
      path.join(templatesDir, SLICE_TEMPLATE_FILENAME),
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-items', 'task-004'))).toBe(true);
    // §4.2: activation writes per-task handoffs to AgentWorkSpace/tasks/<taskId>/handoffs/
    const taskHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-004', 'handoffs');
    expect(existsSync(path.join(taskHandoffsDir, 'professional-task.md'))).toBe(true);
    const copiedSliceTemplatePath = implementationStepsTemplatePath(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-004', 'ImplementationSteps'),
    );
    expect(existsSync(copiedSliceTemplatePath)).toBe(true);
    expect(readFileSync(copiedSliceTemplatePath, 'utf-8')).toBe(
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );
    const retrospective = readdirSync(taskHandoffsDir).includes('retrospective-input.md')
      ? readFileSync(path.join(taskHandoffsDir, 'retrospective-input.md'), 'utf-8')
      : '';
    expect(retrospective).toContain('- Retrospective Required: false');
    const professionalTask = readFileSync(
      path.join(taskHandoffsDir, 'professional-task.md'),
      'utf-8',
    );
    expect(professionalTask).toContain('- Task ID: task-004');
    expect(professionalTask).toContain('- Task Title: Add search');
    expect(professionalTask).toContain('- Intake Source: AgentWorkSpace/pendingitems/task-004.md');
    expect(professionalTask).not.toContain('## Raw Request\n\n# Add search');

    // Activation must stage the pending markdown into the per-task handoffs dir
    // as `intake.md` so artifact-author agents (Alice) can read intake from
    // their own task workspace without being granted access to the shared
    // pendingitems/ directory, which holds other tasks' files in parallel mode.
    const stagedIntakePath = path.join(taskHandoffsDir, 'intake.md');
    expect(existsSync(stagedIntakePath)).toBe(true);
    expect(readFileSync(stagedIntakePath, 'utf-8')).toBe('# Add search\n');
  });

  it('clears prior runtime receipts only after the next task activates successfully', async () => {
    const taskRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-005');
    const roleSessionsDir = path.join(taskRuntimeDir, 'role-sessions');
    const guardrailsDir = path.join(taskRuntimeDir, 'guardrails');
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(guardrailsDir, { recursive: true });

    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');
    writeFileSync(path.join(guardrailsDir, 'dalton.json'), '{"status":"failed"}\n');

    writeFileSync(path.join(pendingDir, 'task-005.md'), '# Add audit trail\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(readdirSync(roleSessionsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(readdirSync(guardrailsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(existsSync(path.join(taskRuntimeDir, 'last-reset-ts'))).toBe(true);
  });

  it('persists repo-root Deep Focus fields to the active-task sidecar during activation', async () => {
    const activeContextPackPath = path.join(repoRoot, '.platform-state', 'queue', 'active-context-pack.json');
    const { contextPackDir } = seedDistributedContextPack(repoRoot);

    const binding = formatContextPackBindingSection({
      contextPackDir,
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
    });
    writeFileSync(path.join(pendingDir, 'task-006.md'), `# Repo root task

${binding}

## Request Summary

    Body
`);
    expect(extractContextPackBinding(readFileSync(path.join(pendingDir, 'task-006.md'), 'utf-8'))).toEqual(
      expect.objectContaining({ contextPackDir }),
    );
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);
    expect(JSON.parse(readFileSync(activeContextPackPath, 'utf-8'))).toEqual(expect.objectContaining({
      contextPackDir,
      contextPackId: 'orders',
      deepFocusEnabled: true,
      selectedFocusPath: '',
    }));
    expect(JSON.parse(readFileSync(activeContextPackPath, 'utf-8'))).not.toHaveProperty('selectedFocusTargetKind');
  });

  it('refuses to activate an unbound task as a platform worktree while a context pack is active', async () => {
    const activePackDir = path.join(repoRoot, 'contextpacks', 'orders');
    mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
      JSON.stringify({
        version: 1,
        active_context_pack_dir: activePackDir,
        active_context_pack_id: 'orders',
        selected_repo_ids: ['backend'],
        selected_focus_ids: [],
        managed_folders: [path.join(repoRoot, 'external-repos', 'backend')],
        status: 'success',
      }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(pendingDir, 'task-unbound.md'), '# Unbound task\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    await expect(activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    })).rejects.toThrow(/Refusing to activate unbound task "task-unbound"/);
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-unbound'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-unbound', '.task.json'))).toBe(false);
  });
});

describe('activateNextPendingItemIfReady shared MCP bootstrap', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-shared-mcp-'));
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    vi.doUnmock('../../container/sharedMcp.js');
    vi.resetModules();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('rolls back activation and returns shared-mcp-bootstrap-failed when shared MCP ensure fails', async () => {
    const ensureSharedMcpRunning = vi.fn().mockRejectedValue(new Error('shared bootstrap failed'));
    vi.resetModules();
    vi.doMock('../../container/sharedMcp.js', () => ({ ensureSharedMcpRunning }));
    const { activateNextPendingItemIfReady: activateWithMock } = await import('../operations.js');

    const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    const templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(path.join(repoRoot, 'docker', 'compose'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'docker', 'compose', 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(
      path.join(repoRoot, 'config', 'platform.default.json'),
      JSON.stringify({
        schema_version: 1,
        cli_provider: 'copilot',
        container_runtime: 'podman',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 10,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(pendingDir, 'task-shared-mcp.md'), '# Shared MCP\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateWithMock({ paths: queuePaths, repoRoot });

    expect(result).toEqual({ activated: false, reason: 'shared-mcp-bootstrap-failed' });
    expect(ensureSharedMcpRunning).toHaveBeenCalledTimes(1);
    expect(ensureSharedMcpRunning).toHaveBeenCalledWith(repoRoot);
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-shared-mcp'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-shared-mcp'))).toBe(false);
    expect(existsSync(path.join(pendingDir, 'task-shared-mcp.md'))).toBe(true);
  });
});

describe('resetHandoffArtifacts runtime receipt retention', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-reset-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('preserves runtime receipts until a new task activates', async () => {
    const TEST_TASK_ID = 'task-test-001';
    const handoffsDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    const runtimeDir = path.join(tmpDir, '.platform-state', 'runtime');
    const roleSessionsDir = path.join(runtimeDir, 'role-sessions');
    const implStepsDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });

    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# task\n');
    writeFileSync(path.join(handoffsDir, 'intake.md'), '# original intake\n');
    writeFileSync(path.join(implStepsDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, {
      implementationStepsDir: implStepsDir,
    });

    expect(existsSync(path.join(roleSessionsDir, 'dalton.json'))).toBe(true);
    // intake.md is the staged copy of the pending markdown (written at activation)
    // and must be cleared on reset so the next activation gets a clean slate.
    expect(existsSync(path.join(handoffsDir, 'intake.md'))).toBe(false);
  });
});
