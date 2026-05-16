import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { flushLoggers } from '../../core/index.js';
import { resolveQueuePaths } from '../paths.js';

type WriteSpy = ReturnType<typeof vi.spyOn>;

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'TASKSAIL_LOG_PROGRESS',
  'TASKSAIL_LOG_PROGRESS_FORCE',
  'NO_COLOR',
  'CI',
  'TASKSAIL_DISABLE_PIPELINE_AUTOSTART',
] as const;

let tmpRoot: string;
let logDir: string;
let stderrWrite: WriteSpy;
let stdoutWrite: WriteSpy;
let ttyDescriptor: PropertyDescriptor | undefined;
let realLogSnapshot: string[];

beforeEach(() => {
  vi.resetModules();
  unmockQueueProgressModules();
  realLogSnapshot = snapshotRealLogs();
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'queue-progress-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'queue-progress-logs-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');
  flushLoggers();
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
});

afterEach(() => {
  restoreStderrTty();
  stderrWrite.mockRestore();
  stdoutWrite.mockRestore();
  flushLoggers();
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  rmSync(logDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  unmockQueueProgressModules();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('queue progress events', () => {
  it('P1 emits queue.dropbox.arrived from the create-task CLI branch without changing stdout', async () => {
    const destinationPath = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'task-cli.md');
    vi.doMock('../publishPendingItem.js', () => ({
      publishPendingItem: vi.fn().mockResolvedValue({
        destinationPath,
        activation: { activated: false },
      }),
    }));
    const { main } = await import('../cli.js');

    await main(['create-task', '--repo-root', tmpRoot, '--title', 'CLI task']);

    expect(stdoutChunks()).toEqual([`Created dropbox task: ${destinationPath}\n`]);
    expect(stderrChunks()).toEqual(['[queue] dropbox arrived task-cli\n']);
    expect(readLevel('info')).toMatchObject([
      {
        msg: 'queue.dropbox.arrived',
        task_id: 'task-cli',
        extra: { path: destinationPath, via: 'create-task' },
      },
    ]);
  });

  it('P1 default-off still writes structured queue.dropbox.arrived without human stderr', async () => {
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', '');
    stubStderrTty(false);
    const destinationPath = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'task-cli-off.md');
    vi.doMock('../publishPendingItem.js', () => ({
      publishPendingItem: vi.fn().mockResolvedValue({
        destinationPath,
        activation: { activated: false },
      }),
    }));
    const { main } = await import('../cli.js');

    await main(['create-task', '--repo-root', tmpRoot, '--title', 'CLI task']);

    expect(stdoutChunks()).toEqual([`Created dropbox task: ${destinationPath}\n`]);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(readLevel('info')).toMatchObject([
      { msg: 'queue.dropbox.arrived', task_id: 'task-cli-off' },
    ]);
  });

  it('P2 emits one queue.pending.promoted event per moved dropbox item', async () => {
    const { moveDropboxItemsOnce } = await import('../operations.js');
    const dropboxDir = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox');
    const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
    mkdirSync(dropboxDir, { recursive: true });
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A\n');
    writeFileSync(path.join(dropboxDir, 'task-b.md'), '# Task B\n');

    await expect(moveDropboxItemsOnce(dropboxDir, pendingDir)).resolves.toBe(2);

    const promoted = stderrChunks().filter((line) => line.startsWith('[queue] promoted to pending '));
    expect(promoted).toHaveLength(2);
    const records = readLevel('info').filter((record) => record.msg === 'queue.pending.promoted');
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.task_id)).size).toBe(2);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P3 and P5 emit worktree-created events before activation on the real worktree path', async () => {
    vi.stubEnv('TASKSAIL_DISABLE_PIPELINE_AUTOSTART', 'true');
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = seedQueue(tmpRoot, 'task-git');
    initGitRepo(tmpRoot);

    await expect(activateNextPendingItemIfReady({ paths, repoRoot: tmpRoot })).resolves.toEqual({ activated: true });

    const lines = stderrChunks();
    const branchIndex = lines.findIndex((line) => line.includes('[pipeline] worktree '));
    const activatedIndex = lines.indexOf('[queue] activated task-git  repos=1\n');
    expect(branchIndex).toBeGreaterThanOrEqual(0);
    expect(activatedIndex).toBeGreaterThan(branchIndex);
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({ msg: 'queue.branch.created', task_id: 'task-git' }),
      expect.objectContaining({
        msg: 'queue.active.activated',
        task_id: 'task-git',
        extra: expect.objectContaining({ repo_count: 1 }),
      }),
    ]));
    expect(existsSync(
      path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'task-git', 'branch-events.json'),
    )).toBe(false);
    expect(readRuntimeTerminalEvents('task-git')).toEqual([
      expect.objectContaining({
        eventId: `queue.branch.created:${path.basename(tmpRoot)}:task/task-git:${path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'task-git', 'worktrees', path.basename(tmpRoot))}`,
        source: 'runtime.branch',
        role: 'pipeline',
        severity: 'info',
        message: `Created worktree for ${path.basename(tmpRoot)} on branch task/task-git.`,
        extra: {
          repo: path.basename(tmpRoot),
          branch: 'task/task-git',
          worktreeRoot: path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'task-git', 'worktrees', path.basename(tmpRoot)),
          materializationStrategy: expect.any(String),
        },
      }),
      expect.objectContaining({
        eventId: 'queue.task.activated',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        message: 'Moved pending item to active.',
      }),
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P4 emits only for the concurrency-cap skip branch, not normal idle states', async () => {
    vi.doMock('../dirLock.js', async () => {
      const actual = await vi.importActual<typeof import('../dirLock.js')>('../dirLock.js');
      return {
        ...actual,
        acquireDirLockOrThrow: vi.fn().mockResolvedValue(async () => undefined),
      };
    });
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = seedQueue(tmpRoot, 'task-blocked');
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'already-active'), 'already-active.md');

    await expect(activateNextPendingItemIfReady({ paths, repoRoot: tmpRoot })).resolves.toEqual({
      activated: false,
      reason: 'concurrency-cap-reached',
    });

    expect(stderrChunks()).toEqual(['[queue] activation skipped - concurrency-cap-reached\n']);
    expect(readLevel('info')).toMatchObject([
      {
        msg: 'queue.active.skipped',
        extra: { reason: 'concurrency-cap-reached' },
      },
    ]);

    const idleRoot = mkdtempSync(path.join(tmpdir(), 'queue-progress-idle-'));
    try {
      mkdirSync(resolveQueuePaths(idleRoot).pendingDir, { recursive: true });
      stderrWrite.mockClear();
      await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(idleRoot), repoRoot: idleRoot })).resolves.toEqual({
        activated: false,
      });
      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      rmSync(idleRoot, { recursive: true, force: true });
    }
  });

  it('P4 emits activation-error from publishPendingItem catch-all with a compact reason', async () => {
    vi.doMock('../operations.js', () => ({
      moveDropboxItemsOnce: vi.fn().mockResolvedValue(1),
      activateNextPendingItemIfReady: vi.fn().mockRejectedValue(new Error('first line\nsecond line')),
    }));
    const { publishPendingItem } = await import('../publishPendingItem.js');
    const destinationPath = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'task-catch.md');
    mkdirSync(path.dirname(destinationPath), { recursive: true });

    const result = await publishPendingItem({
      repoRoot: tmpRoot,
      lockOperationName: 'test.publish',
      publish: async () => destinationPath,
    });

    expect(result.activation).toEqual({
      activated: false,
      reason: 'activation-error: first line second line',
    });
    expect(stderrChunks()).toEqual(['[queue] activation skipped - activation-error:first line second line\n']);
    expect(readLevel('info')).toMatchObject([
      {
        msg: 'queue.active.skipped',
        task_id: 'task-catch',
        extra: { reason: 'activation-error:first line second line' },
      },
    ]);
  });

  it('P4 emits shared-mcp-bootstrap-failed after rollback when shared MCP bootstrap fails', async () => {
    const ensureSharedMcpRunning = vi.fn().mockRejectedValue(new Error('shared bootstrap failed'));
    vi.doMock('../../container/sharedMcp.js', () => ({ ensureSharedMcpRunning }));
    vi.doMock('../../container/runtime.js', () => ({
      createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: true }),
    }));
    vi.doMock('../../platform-config/seed.js', () => ({
      seedPlatformConfig: vi.fn().mockResolvedValue({ action: 'unchanged' }),
    }));
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = seedQueue(tmpRoot, 'task-shared-mcp');
    initGitRepo(tmpRoot);
    mkdirSync(path.join(tmpRoot, 'runtime', 'docker', 'compose'), { recursive: true });
    writeFileSync(path.join(tmpRoot, 'runtime', 'docker', 'compose', 'docker-compose.yml'), 'services: {}\n');

    await expect(activateNextPendingItemIfReady({ paths, repoRoot: tmpRoot })).resolves.toEqual({
      activated: false,
      reason: 'shared-mcp-bootstrap-failed',
    });

    expect(ensureSharedMcpRunning).toHaveBeenCalledWith(tmpRoot);
    expect(existsSync(path.join(paths.activeItemsDir, 'task-shared-mcp'))).toBe(false);
    expect(stderrChunks()).toContain('[queue] activation skipped - shared-mcp-bootstrap-failed\n');
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'queue.active.skipped',
        task_id: 'task-shared-mcp',
        extra: { reason: 'shared-mcp-bootstrap-failed' },
      }),
    ]));
  });

  it('P4 emits pipeline-spawn-failed after rollback when pipeline startup throws', async () => {
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      startPipeline: vi.fn().mockRejectedValue(new Error('spawn failed')),
    }));
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = seedQueue(tmpRoot, 'task-pipeline-fails');
    initGitRepo(tmpRoot);

    await expect(activateNextPendingItemIfReady({ paths, repoRoot: tmpRoot })).resolves.toEqual({
      activated: false,
      reason: 'pipeline-spawn-failed',
    });

    expect(existsSync(path.join(paths.activeItemsDir, 'task-pipeline-fails'))).toBe(false);
    expect(stderrChunks()).toContain('[queue] activated task-pipeline-fails  repos=1\n');
    expect(stderrChunks()).toContain('[queue] activation skipped - pipeline-spawn-failed\n');
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'queue.active.activated',
        task_id: 'task-pipeline-fails',
      }),
      expect.objectContaining({
        msg: 'queue.active.skipped',
        task_id: 'task-pipeline-fails',
        extra: { reason: 'pipeline-spawn-failed' },
      }),
    ]));
  });

  it('P6 emits queue.error_items.moved before follow-on activation progress', async () => {
    vi.doMock('../operations.js', async () => {
      const actual = await vi.importActual<typeof import('../operations.js')>('../operations.js');
      return {
        ...actual,
        activateNextPendingItemIfReady: vi.fn().mockImplementation(async () => {
          return { activated: false };
        }),
      };
    });
    vi.doMock('../../core/worktreeFinalize.js', () => ({
      finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
      discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../branchVerification.js', () => ({
      verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
    }));
    const { moveFailedItemToErrorItems } = await import('../errorItems.js');
    const paths = resolveQueuePaths(tmpRoot);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.pendingDir, 'task-failed.md'), '# Failed\n');
    writeFileSync(path.join(paths.activeItemsDir, 'task-failed'), 'task-failed.md');

    const result = await moveFailedItemToErrorItems({ repoRoot: tmpRoot, taskId: 'task-failed' });

    expect(result.errorItemPath).toBe(path.join(paths.errorItemsDir, 'task-failed.md'));
    expect(stderrChunks()).toEqual(['[queue] moved to error-items task-failed - task-failed\n']);
    expect(readLevel('info')).toMatchObject([
      {
        msg: 'queue.error_items.moved',
        task_id: 'task-failed',
        extra: { error_path: result.errorItemPath, reason: 'task-failed' },
      },
    ]);
    expect(readRuntimeTerminalEvents('task-failed')).toEqual([
      expect.objectContaining({
        eventId: 'queue.task.failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
        message: 'Moved pending item to failed.',
      }),
      expect.objectContaining({
        eventId: 'queue.error_items.moved',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
        message: 'Moved to error-items: task-failed.',
      }),
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P7 emits auto-merge applied, skipped, and disabled through progress records', async () => {
    for (const scenario of [
      { taskId: 'task-auto-applied', result: { enabled: true, applied: true, results: [{ repoLabel: 'repo', sourceBranch: 'task/a', targetBranch: 'main' }] }, line: '[pipeline] auto-merge applied repo:task/a->main\n', msg: 'auto_merge.applied' },
      { taskId: 'task-auto-skipped', result: { enabled: true, applied: false, results: [{ status: 'blocked', detail: 'needs review' }] }, line: '[pipeline] auto-merge skipped - blocked: needs review [skip]\n', msg: 'auto_merge.skipped' },
      { taskId: 'task-auto-disabled', result: { enabled: false, applied: false, results: [] }, line: '[pipeline] auto-merge disabled\n', msg: 'auto_merge.disabled' },
    ] as const) {
      await runCompleteWithAutoMerge(scenario.taskId, scenario.result);
      expect(stderrChunks()).toContain(scenario.line);
      expect(readLevel('info').some((record) => record.msg === scenario.msg && record.task_id === scenario.taskId)).toBe(true);
      expect(readRuntimeTerminalEvents(scenario.taskId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventId: scenario.msg, role: 'pipeline' }),
      ]));
    }
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P8 emits closeout.finalized after sentinel removal and before auto-advance', async () => {
    const taskId = 'task-closeout';
    const activateNextPendingItemIfReady = vi.fn().mockResolvedValue({ activated: false });
    await runCompleteWithAutoMerge(taskId, { enabled: false, applied: false, results: [] }, activateNextPendingItemIfReady);
    const paths = resolveQueuePaths(tmpRoot);

    expect(existsSync(path.join(paths.activeItemsDir, `${taskId}.completing`))).toBe(false);
    expect(activateNextPendingItemIfReady).toHaveBeenCalledOnce();
    expect(stderrChunks()).toContain('[pipeline] completed task-closeout [ok]\n');
    expect(readLevel('info').some((record) => record.msg === 'closeout.finalized' && record.task_id === taskId)).toBe(true);
    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'closeout.finalized',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'success',
        message: 'Closeout finalized.',
      }),
      expect.objectContaining({
        eventId: 'queue.task.completed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'success',
        message: 'Moved pending item to completed.',
      }),
    ]));
  });

  it('writes archive terminal events around archive execution', async () => {
    const taskId = 'task-archive-phase';
    const phaseFile = path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', taskId, 'pipeline-phase.json');
    const fileTaskArchive = vi.fn().mockImplementation(async () => {
      expect(existsSync(phaseFile)).toBe(false);
      expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventId: 'archive.started',
          source: 'runtime.pipeline',
          role: 'pipeline',
          severity: 'info',
          message: 'Archiving task.',
        }),
      ]));
      return {
        passed: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        data: { record_md_path: path.join(tmpRoot, 'archive.md') },
      };
    });

    await runCompleteWithAutoMerge(
      taskId,
      { enabled: false, applied: false, results: [] },
      undefined,
      fileTaskArchive,
    );

    expect(existsSync(phaseFile)).toBe(false);
    expect(readRuntimeTerminalEvents(taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'archive.started',
        message: 'Archiving task.',
      }),
      expect.objectContaining({
        eventId: 'archive.completed',
        severity: 'success',
        message: 'Task archived.',
      }),
    ]));

    const failedTaskId = 'task-archive-failed';
    const failedPhaseFile = path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', failedTaskId, 'pipeline-phase.json');
    await expect(runCompleteWithAutoMerge(
      failedTaskId,
      { enabled: false, applied: false, results: [] },
      undefined,
      vi.fn().mockResolvedValue({
        passed: false,
        stdout: '',
        stderr: 'archive failed',
        exitCode: 1,
        data: null,
      }),
    )).rejects.toThrow('Completion blocked: task archival failed');
    expect(existsSync(failedPhaseFile)).toBe(false);
    expect(readRuntimeTerminalEvents(failedTaskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'archive.started',
        message: 'Archiving task.',
      }),
      expect.objectContaining({
        eventId: 'archive.failed',
        severity: 'error',
        message: 'Task archival failed.',
      }),
    ]));
  });

  it('P9 stranded resume writes warn JSON before the human progress line', async () => {
    vi.doMock('../resumeCloseout.js', () => ({
      resumeCloseoutFromSentinel: vi.fn().mockResolvedValue({
        status: 'completed',
        drove: ['finalize-worktrees', 'unlink-marker'],
      }),
    }));
    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const paths = resolveQueuePaths(tmpRoot);
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'task-stranded.completing'), '{}');

    await expect(activateNextPendingItemIfReady({ paths, repoRoot: tmpRoot })).resolves.toEqual({ activated: false });

    const lines = stderrChunks();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'warn',
      msg: 'closeout.stranded.resumed',
      task_id: 'task-stranded',
      extra: { drove: ['finalize-worktrees', 'unlink-marker'] },
    });
    expect(lines[1]).toBe('[pipeline] resumed stranded closeout for task-stranded\n');
    expect(readLevel('warn')).toMatchObject([
      {
        msg: 'closeout.stranded.resumed',
        task_id: 'task-stranded',
        extra: { drove: ['finalize-worktrees', 'unlink-marker'] },
      },
    ]);
    expect(readRuntimeTerminalEvents('task-stranded')).toEqual([
      expect.objectContaining({
        eventId: 'closeout.stranded.resumed',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'warning',
        message: 'Resumed stranded closeout.',
      }),
    ]);
  });
});

function seedQueue(repoRoot: string, taskId: string): ReturnType<typeof resolveQueuePaths> {
  const paths = resolveQueuePaths(repoRoot);
  writePlatformConfig(repoRoot);
  mkdirSync(paths.pendingDir, { recursive: true });
  mkdirSync(paths.templatesDir, { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), `# ${taskId}\n`);
  for (const filename of [
    'professional-task.md',
    'implementation-spec.md',
    'retrospective-input.md',
    'final-summary.md',
    'issues.md',
    'parallel-ok.md',
    'slice-template.md',
  ]) {
    writeFileSync(path.join(paths.templatesDir, filename), `# ${filename}\n`);
  }
  return paths;
}

function writePlatformConfig(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
  writeFileSync(path.join(repoRoot, '.platform-state', 'platform.json'), JSON.stringify({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'podman',
    max_parallel_tasks: 1,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }), 'utf-8');
}

function initGitRepo(repoRoot: string): void {
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
  writeFileSync(path.join(repoRoot, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' });
}

async function runCompleteWithAutoMerge(
  taskId: string,
  autoMergeResult: unknown,
  activateNextPendingItemIfReady = vi.fn().mockResolvedValue({ activated: false }),
  fileTaskArchive = vi.fn().mockResolvedValue({
    passed: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    data: { record_md_path: path.join(tmpRoot, 'archive.md') },
  }),
): Promise<void> {
  vi.resetModules();
  flushLoggers();
  vi.doMock('../operations.js', async () => {
    const actual = await vi.importActual<typeof import('../operations.js')>('../operations.js');
    return {
      ...actual,
      completeActiveItem: vi.fn().mockImplementation(async () => {
        const paths = resolveQueuePaths(tmpRoot);
        try {
          rmSync(path.join(paths.pendingDir, `${taskId}.md`), { force: true });
        } catch {
          // best-effort test cleanup
        }
        return { status: 'completed' };
      }),
      acquireDirLockOrThrow: vi.fn().mockResolvedValue(async () => undefined),
      activateNextPendingItemIfReady,
    };
  });
  vi.doMock('../policyValidation.js', () => ({ assertPolicyPasses: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock('../archive.js', () => ({
    fileTaskArchive,
  }));
  vi.doMock('../../context-pack/index.js', () => ({
    requireAuthorizedActiveContextPack: vi.fn().mockResolvedValue(path.join(tmpRoot, 'context-pack')),
  }));
  vi.doMock('../retrospectiveFlag.js', async () => {
    const actual = await vi.importActual<typeof import('../retrospectiveFlag.js')>('../retrospectiveFlag.js');
    return {
      ...actual,
      syncRetrospectiveRequiredMetadata: vi.fn().mockResolvedValue(undefined),
    };
  });
  vi.doMock('../../agent-runner/pipeline/remediation.js', () => ({
    buildAdvisoryFindingSection: vi.fn().mockResolvedValue(''),
    ADVISORY_FINDING_HEADING: '## Advisory Finding',
  }));
  vi.doMock('../errorItems.js', () => ({ commitTaskSnapshot: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock('../taskRegistry.js', () => ({ transitionTask: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock('../../core/worktreeFinalize.js', () => ({ finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock('../branchVerification.js', () => ({ verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }) }));
  vi.doMock('../taskJson.js', () => ({
    resolveTaskJsonPath: vi.fn().mockReturnValue(path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json')),
    readTaskJson: vi.fn().mockReturnValue({ contextPackBinding: { repoBindings: [] } }),
  }));
  vi.doMock('../../platform-config/get.js', () => ({ getPlatformConfig: vi.fn().mockResolvedValue({ auto_merge: true }) }));
  vi.doMock('../autoMerge.js', () => ({ stageAutoMergeCloseout: vi.fn().mockResolvedValue(autoMergeResult) }));
  vi.doMock('../../agent-runner/guardrails.js', () => ({ evictPolicyResultCache: vi.fn() }));

  const paths = resolveQueuePaths(tmpRoot);
  mkdirSync(paths.pendingDir, { recursive: true });
  mkdirSync(paths.activeItemsDir, { recursive: true });
  mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId), { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
  writeFileSync(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
  writeFileSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'), '{}');

  const { completePendingItem } = await import('../completePendingItem.js');
  await completePendingItem({ taskId, skipValidation: true, repoRoot: tmpRoot });
}

function stdoutChunks(): string[] {
  return stdoutWrite.mock.calls.map((call) => String(call[0]));
}

function stderrChunks(): string[] {
  return stderrWrite.mock.calls.map((call) => String(call[0]));
}

function stubStderrTty(value: boolean): void {
  Object.defineProperty(process.stderr, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreStderrTty(): void {
  if (ttyDescriptor) {
    Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
  } else {
    delete (process.stderr as Partial<typeof process.stderr>).isTTY;
  }
  ttyDescriptor = undefined;
}

function readLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  const dir = path.join(logDir, level);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => readJsonLines(path.join(dir, entry)));
}

function readRuntimeTerminalEvents(taskId: string): Array<Record<string, unknown>> {
  const filePath = path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  if (!existsSync(filePath)) {
    return [];
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')).events;
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function snapshotRealLogs(): string[] {
  const root = path.join(process.cwd(), '.platform-state', 'logs');
  if (!existsSync(root)) {
    return [];
  }
  const entries: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const filePath = path.join(dir, entry);
      const relative = path.relative(root, filePath);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        entries.push(`${relative}/`);
        visit(filePath);
      } else {
        entries.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  visit(root);
  return entries;
}

function unmockQueueProgressModules(): void {
  vi.doUnmock('../publishPendingItem.js');
  vi.doUnmock('../operations.js');
  vi.doUnmock('../dirLock.js');
  vi.doUnmock('../resumeCloseout.js');
  vi.doUnmock('../../agent-runner/pipelineSupervisor.js');
  vi.doUnmock('../../container/sharedMcp.js');
  vi.doUnmock('../../container/runtime.js');
  vi.doUnmock('../../platform-config/seed.js');
  vi.doUnmock('../policyValidation.js');
  vi.doUnmock('../archive.js');
  vi.doUnmock('../../context-pack/index.js');
  vi.doUnmock('../retrospectiveFlag.js');
  vi.doUnmock('../../agent-runner/pipeline/remediation.js');
  vi.doUnmock('../errorItems.js');
  vi.doUnmock('../taskRegistry.js');
  vi.doUnmock('../../core/worktreeFinalize.js');
  vi.doUnmock('../branchVerification.js');
  vi.doUnmock('../taskJson.js');
  vi.doUnmock('../../platform-config/get.js');
  vi.doUnmock('../autoMerge.js');
  vi.doUnmock('../../agent-runner/guardrails.js');
}
