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

type WriteSpy = ReturnType<typeof vi.spyOn>;

let tmpRoot: string;
let logDir: string;
let stderrWrite: WriteSpy;
let stdoutWrite: WriteSpy;
let ttyDescriptor: PropertyDescriptor | undefined;
let realLogSnapshot: string[];

beforeEach(() => {
  vi.resetModules();
  unmockLifecycleModules();
  realLogSnapshot = snapshotRealLogs();
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'queue-lifecycle-progress-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'queue-lifecycle-progress-logs-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');
  vi.stubEnv('CI', '');
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  const { flushLoggers } = await import('../../core/logger.js');
  flushLoggers();
  restoreStderrTty();
  stderrWrite.mockRestore();
  stdoutWrite.mockRestore();
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  rmSync(logDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  unmockLifecycleModules();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('queue lifecycle progress narrative', () => {
  it('emits the dropbox to active to closeout progress narrative in order', async () => {
    stubStderrTty(true);
    mockLifecycleBoundaries();

    const { taskId, repoSlug } = await runLifecycleScenario();

    const progressLines = stderrChunks().filter(isHumanProgressLine);
    const worktreeLine = `[pipeline] writable task branch worktree ${repoSlug} on task/${taskId}\n`;
    expect(progressLines).toContain(`[queue] promoted to pending ${taskId}\n`);
    expect(progressLines).toContain(worktreeLine);
    expect(progressLines).toContain(`[queue] activated ${taskId}  repos=1\n`);
    expect(progressLines).toContain(`[pipeline] completed ${taskId} [ok]\n`);
    expect(progressLines.indexOf(`[queue] promoted to pending ${taskId}\n`))
      .toBeLessThan(progressLines.indexOf(worktreeLine));
    expect(progressLines.indexOf(worktreeLine))
      .toBeLessThan(progressLines.indexOf(`[queue] activated ${taskId}  repos=1\n`));
    expect(progressLines.indexOf(`[queue] activated ${taskId}  repos=1\n`))
      .toBeLessThan(progressLines.indexOf(`[pipeline] completed ${taskId} [ok]\n`));
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('emits stranded closeout recovery warn JSON before human progress', async () => {
    stubStderrTty(true);
    vi.doMock('../resumeCloseout.js', () => ({
      resumeCloseoutFromSentinel: vi.fn().mockResolvedValue({ status: 'completed', drove: 'archive' }),
    }));
    const { resolveQueuePaths } = await import('../paths.js');
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
      extra: { drove: 'archive' },
    });
    expect(lines[1]).toBe('[pipeline] resumed stranded closeout for task-stranded\n');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('keeps human progress off by default when stderr is not a TTY but preserves structured chronology', async () => {
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', '');
    stubStderrTty(false);
    mockLifecycleBoundaries();

    const { taskId } = await runLifecycleScenario();

    expect(stderrChunks().filter(isHumanProgressLine)).toEqual([]);
    const lifecycleMessages = readLevel('info')
      .filter((record) => record.task_id === taskId)
      .map((record) => record.msg);
    expectOrderedSubsequence(lifecycleMessages, [
      'queue.pending.promoted',
      'queue.branch.created',
      'queue.active.activated',
      'closeout.finalized',
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

async function runLifecycleScenario(): Promise<{ taskId: string; repoSlug: string }> {
  const { createDropboxTask } = await import('../createDropboxTask.js');
  const { publishPendingItem } = await import('../publishPendingItem.js');
  const { completePendingItem } = await import('../completePendingItem.js');
  const { getActiveTaskIds } = await import('../operations.js');
  const { resolveQueuePaths } = await import('../paths.js');

  const paths = await seedLifecycleFixture(tmpRoot);
  const outputPath = path.join(paths.dropboxDir, 'task-lifecycle.md');

  const result = await publishPendingItem({
    repoRoot: tmpRoot,
    contextPackDir: paths.contextPackDir,
    lockOperationName: 'test.lifecycle.publish',
    publish: () => createDropboxTask({
      title: 'Lifecycle Progress',
      outputPath,
      force: true,
      repoRoot: tmpRoot,
      contextPackDir: paths.contextPackDir,
      contextPackId: 'orders',
      scopeMode: 'repo-selection',
      primaryRepoId: 'backend',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
    }),
  });
  expect(result.activation.activated).toBe(true);
  const activeTaskIds = getActiveTaskIds(resolveQueuePaths(tmpRoot));
  expect(activeTaskIds).toHaveLength(1);
  const taskId = activeTaskIds[0]!;

  await completePendingItem({
    taskId,
    repoRoot: tmpRoot,
    skipValidation: true,
    skipArchive: true,
  });

  return { taskId, repoSlug: path.basename(paths.repoDir) };
}

async function seedLifecycleFixture(repoRoot: string): Promise<{
  dropboxDir: string;
  contextPackDir: string;
  repoDir: string;
}> {
  const { resolveQueuePaths, HANDOFF_FILES, SLICE_TEMPLATE_FILENAME } = await import('../paths.js');
  const queuePaths = resolveQueuePaths(repoRoot);
  mkdirSync(queuePaths.dropboxDir, { recursive: true });
  mkdirSync(queuePaths.pendingDir, { recursive: true });
  mkdirSync(queuePaths.templatesDir, { recursive: true });
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(queuePaths.templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(queuePaths.templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
  writePlatformConfig(repoRoot);

  const contextPackDir = path.join(repoRoot, 'contextpacks', 'orders');
  const repoDir = path.join(repoRoot, 'external-repos', 'backend');
  initGitRepo(repoDir);
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  writeFileSync(
    path.join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      context_pack_id: 'orders',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/orders',
      repositories: [{
        repo_id: 'backend',
        local_paths: [repoDir],
        repository_type: 'primary',
        default_focusable: true,
        activation_priority: 100,
      }],
      primary_working_repo_ids: ['backend'],
      primary_focus_area_ids: [],
    }, null, 2) + '\n',
  );

  return { dropboxDir: queuePaths.dropboxDir, contextPackDir, repoDir };
}

function mockLifecycleBoundaries(): void {
  vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
    startPipeline: vi.fn().mockResolvedValue({ status: 'started', pid: 4242 }),
    listActivePipelines: vi.fn(() => []),
    stopPipeline: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../../container/runtime.js', () => ({
    createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: false }),
  }));
  vi.doMock('../../container/sharedMcp.js', () => ({
    ensureSharedMcpRunning: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../../platform-config/seed.js', () => ({
    seedPlatformConfig: vi.fn().mockResolvedValue({ action: 'unchanged' }),
  }));
  vi.doMock('../errorItems.js', async () => {
    const actual = await vi.importActual<typeof import('../errorItems.js')>('../errorItems.js');
    return {
      ...actual,
      commitTaskSnapshot: vi.fn().mockResolvedValue(undefined),
    };
  });
  vi.doMock('../branchVerification.js', () => ({
    verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
  }));
  vi.doMock('../../core/worktreeFinalize.js', () => ({
    finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../../platform-config/get.js', () => ({
    getPlatformConfig: vi.fn().mockResolvedValue({
      max_parallel_tasks: 1,
      auto_merge: false,
    }),
  }));
  vi.doMock('../autoMerge.js', () => ({
    stageAutoMergeCloseout: vi.fn().mockResolvedValue({ enabled: false, applied: false, results: [] }),
  }));
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
    auto_merge: false,
  }), 'utf-8');
}

function initGitRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'README.md'), '# backend\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });
}

function expectOrderedSubsequence(values: unknown[], expected: unknown[]): void {
  let cursor = -1;
  for (const value of expected) {
    const next = values.findIndex((candidate, index) => index > cursor && candidate === value);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function isHumanProgressLine(line: string): boolean {
  return line.startsWith('[queue]') || line.startsWith('[pipeline]');
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

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) {
    return [];
  }
  return raw.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function snapshotRealLogs(): string[] {
  const root = path.resolve(process.cwd(), '.platform-state/logs');
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

function unmockLifecycleModules(): void {
  vi.doUnmock('../../agent-runner/pipelineSupervisor.js');
  vi.doUnmock('../../container/runtime.js');
  vi.doUnmock('../../container/sharedMcp.js');
  vi.doUnmock('../../platform-config/seed.js');
  vi.doUnmock('../errorItems.js');
  vi.doUnmock('../branchVerification.js');
  vi.doUnmock('../../core/worktreeFinalize.js');
  vi.doUnmock('../../platform-config/get.js');
  vi.doUnmock('../autoMerge.js');
  vi.doUnmock('../resumeCloseout.js');
}
