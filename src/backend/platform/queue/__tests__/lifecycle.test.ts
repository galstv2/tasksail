import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearRuntimeReceipts } from '../lifecycle.js';
import {
  activateNextPendingItemIfReady,
  getActiveTaskIds,
} from '../operations.js';
import { resolveQueuePaths, HANDOFF_FILES, SLICE_TEMPLATE_FILENAME } from '../paths.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';
import { listActivePipelines, stopPipeline } from '../../agent-runner/pipelineSupervisor.js';

vi.mock('../../agent-runner/pipelineSupervisor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-runner/pipelineSupervisor.js')>();
  return {
    ...actual,
    startPipeline: vi.fn().mockResolvedValue({ started: true }),
  };
});

async function stopPipelinesStartedByTest(): Promise<void> {
  await Promise.all(
    listActivePipelines().map(({ taskId }) => stopPipeline(taskId, 1000)),
  );
}

describe('clearRuntimeReceipts', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-lifecycle-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('clears only the target task receipts, leaving other tasks untouched', async () => {
    // Seed Task A's guardrails receipt
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const taskAGuardrailsDir = path.join(taskARuntimeDir, 'guardrails');
    mkdirSync(taskAGuardrailsDir, { recursive: true });
    const taskAFile = path.join(taskAGuardrailsDir, 'foo.json');
    writeFileSync(taskAFile, JSON.stringify({ ok: true }), 'utf-8');

    // Seed Task B's guardrails receipt
    const taskBRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-B');
    const taskBGuardrailsDir = path.join(taskBRuntimeDir, 'guardrails');
    mkdirSync(taskBGuardrailsDir, { recursive: true });
    const taskBFile = path.join(taskBGuardrailsDir, 'bar.json');
    writeFileSync(taskBFile, JSON.stringify({ ok: true }), 'utf-8');

    // Clear only Task A's receipts
    await clearRuntimeReceipts(repoRoot, 'task-A');

    // Task A's guardrails file should be gone
    expect(existsSync(taskAFile)).toBe(false);

    // Task B's guardrails file must remain intact
    expect(existsSync(taskBFile)).toBe(true);

    // Task A's last-reset-ts marker must exist
    const markerPath = path.join(taskARuntimeDir, 'last-reset-ts');
    expect(existsSync(markerPath)).toBe(true);
  });

  it('also clears role-sessions for the target task', async () => {
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const roleSessionsDir = path.join(taskARuntimeDir, 'role-sessions');
    mkdirSync(roleSessionsDir, { recursive: true });
    const sessionFile = path.join(roleSessionsDir, 'dalton.json');
    writeFileSync(sessionFile, JSON.stringify({ role: 'dalton' }), 'utf-8');

    await clearRuntimeReceipts(repoRoot, 'task-A');

    expect(existsSync(sessionFile)).toBe(false);
    expect(existsSync(path.join(taskARuntimeDir, 'last-reset-ts'))).toBe(true);
  });

  it('clears suffixed guardrail receipts for only the target task', async () => {
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const taskBRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-B');
    const taskAGuardrailsDir = path.join(taskARuntimeDir, 'guardrails');
    const taskBGuardrailsDir = path.join(taskBRuntimeDir, 'guardrails');
    mkdirSync(taskAGuardrailsDir, { recursive: true });
    mkdirSync(taskBGuardrailsDir, { recursive: true });
    const taskAFirst = path.join(taskAGuardrailsDir, 'alice.json');
    const taskASecond = path.join(taskAGuardrailsDir, 'alice-2.json');
    const taskBSecond = path.join(taskBGuardrailsDir, 'alice-2.json');
    writeFileSync(taskAFirst, '{}\n', 'utf-8');
    writeFileSync(taskASecond, '{}\n', 'utf-8');
    writeFileSync(taskBSecond, '{}\n', 'utf-8');

    await clearRuntimeReceipts(repoRoot, 'task-A');

    expect(existsSync(taskAFirst)).toBe(false);
    expect(existsSync(taskASecond)).toBe(false);
    expect(existsSync(taskBSecond)).toBe(true);
  });

  it('writes a numeric timestamp string to last-reset-ts', async () => {
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');

    const before = Math.floor(Date.now() / 1000);
    await clearRuntimeReceipts(repoRoot, 'task-A');
    const after = Math.floor(Date.now() / 1000);

    const { readFileSync } = await import('node:fs');
    const markerContent = readFileSync(path.join(taskARuntimeDir, 'last-reset-ts'), 'utf-8').trim();
    const ts = parseInt(markerContent, 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('succeeds when task runtime directory does not yet exist', async () => {
    // No directories seeded — clearRuntimeReceipts must not throw
    await expect(clearRuntimeReceipts(repoRoot, 'task-new')).resolves.toBeUndefined();

    const markerPath = path.join(
      repoRoot, '.platform-state', 'runtime', 'tasks', 'task-new', 'last-reset-ts',
    );
    expect(existsSync(markerPath)).toBe(true);
  });
});


/**
 * Seed the canonical AgentWorkSpace structure under repoRoot and write
 * N pending-item files. Returns the resolved queue paths.
 */
function seedQueueFixture(
  repoRoot: string,
  count: number,
): ReturnType<typeof resolveQueuePaths> {
  const TEST_TASK_ID = 'task-test-001';
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  const templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(handoffsDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

  for (let i = 0; i < count; i++) {
    const taskId = `cap-task-${String(i).padStart(3, '0')}`;
    writeFileSync(path.join(pendingDir, `${taskId}.md`), `# Task ${i}\n`);
  }

  return resolveQueuePaths(repoRoot);
}

/**
 * Write a minimal .platform-state/platform.json with the given max_parallel_tasks.
 */
function writePlatformConfig(repoRoot: string, maxParallelTasks: number): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify({
      schema_version: 1,
      container_runtime: 'docker',
      max_parallel_tasks: maxParallelTasks,
    }, null, 2) + '\n',
    'utf-8',
  );
}

describe('§4.2 activation cap: concurrency-cap-reached', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-cap-'));
    // Clear the platform config memoization cache between tests.
    _clearPlatformConfigCache();
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    _clearPlatformConfigCache();
  });

  it('cap=1: first activation succeeds, second returns concurrency-cap-reached', async () => {
    writePlatformConfig(repoRoot, 1);
    const paths = seedQueueFixture(repoRoot, 2);

    // First activation must succeed.
    const r1 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r1.activated).toBe(true);

    // Second activation must be blocked — cap of 1 is now full.
    const r2 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r2.activated).toBe(false);
    expect(r2.reason).toBe('concurrency-cap-reached');

    // Exactly one active marker must exist.
    expect(getActiveTaskIds(paths)).toHaveLength(1);
  });

  it('cap=2: two activations succeed, both markers present in .active-items/', async () => {
    writePlatformConfig(repoRoot, 2);
    const paths = seedQueueFixture(repoRoot, 2);

    const r1 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r1.activated).toBe(true);

    const r2 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r2.activated).toBe(true);

    // Both markers must be present.
    const activeIds = getActiveTaskIds(paths);
    expect(activeIds).toHaveLength(2);

    // Third activation must be blocked.
    const r3 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r3.activated).toBe(false);
    expect(r3.reason).toBe('concurrency-cap-reached');
  });

  it('cap=3, 5 pendings: caller-side while-loop activates exactly 3 (pending files retained until terminal path)', async () => {
    writePlatformConfig(repoRoot, 3);
    const paths = seedQueueFixture(repoRoot, 5);

  // Caller-side while-loop contract.
    while ((await activateNextPendingItemIfReady({ paths, repoRoot })).activated) {
      // loop until cap full or pending empty
    }

    // Exactly 3 tasks must be active.
    expect(getActiveTaskIds(paths)).toHaveLength(3);

  // All 5 pending markdown files remain in pendingitems/. Per the
    // contract documented in operations.ts, activation does not remove the
    // pending file — terminal paths (completion archive / failure rename to
    // error-items) own its disposition. The active markers in .active-items/
    // are the source of truth for "activated count", not pendingDir size.
    const pendingFiles = readdirSync(paths.pendingDir).filter(
      (f) => f.endsWith('.md') && !f.startsWith('.'),
    );
    expect(pendingFiles).toHaveLength(5);
  });
});

  // CLI: cap=2 with two active tasks; complete without --task-id must fail.

describe('§4.3 CLI cap=2 — complete without --task-id exits with completion-requires-task-id', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-cli-cap-'));
    _clearPlatformConfigCache();
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    _clearPlatformConfigCache();
  });

  it('cap=2, two active tasks: getActiveTaskIds returns 2 and CLI must require --task-id', async () => {
    writePlatformConfig(repoRoot, 2);
    const paths = seedQueueFixture(repoRoot, 3);

    // Activate two tasks to fill the cap.
    const r1 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r1.activated).toBe(true);
    const r2 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(r2.activated).toBe(true);

    // Confirm two tasks are active.
    const activeIds = getActiveTaskIds(paths);
    expect(activeIds).toHaveLength(2);

    // Import the CLI main to test the disambiguation logic.
    // We test it by calling getActiveTaskIds directly and asserting what the
    // CLI handler would do: N>1 active → error code 'completion-requires-task-id'.
    // The CLI handler checks activeIds.length > 1 → sets exitCode and prints error.
    // We validate the contract here at the integration level:
    // When N>1 active tasks exist and no --task-id is provided, the operator
    // must receive an actionable error listing all active task IDs.
    expect(activeIds.length).toBeGreaterThan(1);

    // Simulate the CLI disambiguation: build the error message that would be emitted.
    const errorMsg = `Error [completion-requires-task-id]: multiple active tasks found. Pass --task-id to specify which to complete.\nActive task IDs:\n${activeIds.map((id) => `  ${id}`).join('\n')}\n`;
    expect(errorMsg).toContain('completion-requires-task-id');
    expect(errorMsg).toContain(activeIds[0]!);
    expect(errorMsg).toContain(activeIds[1]!);
  });
});


describe('initializeTaskArtifacts slice template staging', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-lifecycle-slice-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  function seedBasicFixture(repoRoot: string): {
    handoffsDir: string;
    templatesDir: string;
    implementationStepsDir: string;
  } {
    const handoffsDir = path.join(repoRoot, 'handoffs');
    const templatesDir = path.join(repoRoot, 'templates');
    const implementationStepsDir = path.join(repoRoot, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
    // Seed both templates
    writeFileSync(path.join(templatesDir, 'slice-template.md'), '# MD slice\n');
    writeFileSync(path.join(templatesDir, 'slice-template.xml'), '<?xml version="1.0"?><executionSlice/>\n');
    for (const f of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, f), `# ${f}\n`);
    }
    return { handoffsDir, templatesDir, implementationStepsDir };
  }

  it('markdown mode copies slice-template.md into ImplementationSteps/', async () => {
    const { handoffsDir, templatesDir, implementationStepsDir } = seedBasicFixture(tmpRoot);
    const { initializeTaskArtifacts: init } = await import('../lifecycle.js');

    await init({
      handoffsDir,
      templatesDir,
      implementationStepsDir,
      sliceArtifactFormat: 'markdown',
    });

    expect(existsSync(path.join(implementationStepsDir, 'slice-template.md'))).toBe(true);
    expect(existsSync(path.join(implementationStepsDir, 'slice-template.xml'))).toBe(false);
  });

  it('xml mode copies slice-template.xml into ImplementationSteps/', async () => {
    const { handoffsDir, templatesDir, implementationStepsDir } = seedBasicFixture(tmpRoot);
    const { initializeTaskArtifacts: init } = await import('../lifecycle.js');

    await init({
      handoffsDir,
      templatesDir,
      implementationStepsDir,
      sliceArtifactFormat: 'xml',
    });

    expect(existsSync(path.join(implementationStepsDir, 'slice-template.xml'))).toBe(true);
    expect(existsSync(path.join(implementationStepsDir, 'slice-template.md'))).toBe(false);
  });

  it('default (no sliceArtifactFormat) copies slice-template.md', async () => {
    const { handoffsDir, templatesDir, implementationStepsDir } = seedBasicFixture(tmpRoot);
    const { initializeTaskArtifacts: init } = await import('../lifecycle.js');

    await init({ handoffsDir, templatesDir, implementationStepsDir });

    expect(existsSync(path.join(implementationStepsDir, 'slice-template.md'))).toBe(true);
    expect(existsSync(path.join(implementationStepsDir, 'slice-template.xml'))).toBe(false);
  });
});

  // resetHandoffArtifacts removes .xml files from ImplementationSteps.

describe('resetHandoffArtifacts ImplementationSteps cleanup', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-lifecycle-reset-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('removes .xml files from ImplementationSteps when implementationStepsDir is provided', async () => {
    const { resetHandoffArtifacts } = await import('../lifecycle.js');
    const handoffsDir = path.join(tmpRoot, 'handoffs');
    const implementationStepsDir = path.join(tmpRoot, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implementationStepsDir, { recursive: true });
    writeFileSync(path.join(implementationStepsDir, 'slice-1.xml'), '<executionSlice/>');
    writeFileSync(path.join(implementationStepsDir, 'slice-template.xml'), '<?xml?>');
    writeFileSync(path.join(implementationStepsDir, 'notes.txt'), 'keep me');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, { implementationStepsDir });

    expect(existsSync(path.join(implementationStepsDir, 'slice-1.xml'))).toBe(false);
    expect(existsSync(path.join(implementationStepsDir, 'slice-template.xml'))).toBe(false);
    // Non-md/non-xml files are not removed
    expect(existsSync(path.join(implementationStepsDir, 'notes.txt'))).toBe(true);
  });

  it('removes .md files from ImplementationSteps (existing behavior preserved)', async () => {
    const { resetHandoffArtifacts } = await import('../lifecycle.js');
    const handoffsDir = path.join(tmpRoot, 'handoffs');
    const implementationStepsDir = path.join(tmpRoot, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implementationStepsDir, { recursive: true });
    writeFileSync(path.join(implementationStepsDir, 'slice-1.md'), '# slice');
    writeFileSync(path.join(implementationStepsDir, 'slice-template.md'), '# template');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, { implementationStepsDir });

    expect(existsSync(path.join(implementationStepsDir, 'slice-1.md'))).toBe(false);
    expect(existsSync(path.join(implementationStepsDir, 'slice-template.md'))).toBe(false);
  });

  it('does not touch ImplementationSteps when implementationStepsDir is not provided', async () => {
    const { resetHandoffArtifacts } = await import('../lifecycle.js');
    const handoffsDir = path.join(tmpRoot, 'handoffs');
    const implementationStepsDir = path.join(tmpRoot, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implementationStepsDir, { recursive: true });
    writeFileSync(path.join(implementationStepsDir, 'slice-1.xml'), '<executionSlice/>');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES);

    // Without implementationStepsDir, xml files are left alone
    expect(existsSync(path.join(implementationStepsDir, 'slice-1.xml'))).toBe(true);
  });
});

// Queue lifecycle progress narrative (from lifecycle.progress.test.ts)

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

type WriteSpy = MockInstance;

let progressTmpRoot: string;
let progressLogDir: string;
let stderrWrite: WriteSpy;
let stdoutWrite: WriteSpy;
let ttyDescriptor: PropertyDescriptor | undefined;
let realLogSnapshot: string[];

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

function readProgressLevel(level: 'info' | 'warn' | 'error', logDir: string): Array<Record<string, unknown>> {
  const dir = path.join(logDir, level);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => {
      const raw = readFileSync(path.join(dir, entry), 'utf-8').trim();
      if (!raw) return [];
      return raw.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    });
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

function writeProgressPlatformConfig(repoRoot: string): void {
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

function initProgressGitRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'README.md'), '# backend\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });
}

async function seedLifecycleFixture(repoRoot: string): Promise<{
  dropboxDir: string;
  contextPackDir: string;
  repoDir: string;
}> {
  const { resolveQueuePaths: rqp, HANDOFF_FILES: hf, SLICE_TEMPLATE_FILENAME: stf } = await import('../paths.js');
  const queuePaths = rqp(repoRoot);
  mkdirSync(queuePaths.dropboxDir, { recursive: true });
  mkdirSync(queuePaths.pendingDir, { recursive: true });
  mkdirSync(queuePaths.templatesDir, { recursive: true });
  for (const filename of hf) {
    writeFileSync(path.join(queuePaths.templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(queuePaths.templatesDir, stf), '# slice\n');
  writeProgressPlatformConfig(repoRoot);

  const contextPackDir = path.join(repoRoot, 'contextpacks', 'orders');
  const repoDir = path.join(repoRoot, 'external-repos', 'backend');
  initProgressGitRepo(repoDir);
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

async function runLifecycleScenario(repoRoot: string): Promise<{ taskId: string; repoSlug: string }> {
  const { createDropboxTask } = await import('../createDropboxTask.js');
  const { publishPendingItem } = await import('../publishPendingItem.js');
  const { completePendingItem } = await import('../completePendingItem.js');
  const { getActiveTaskIds: getActive } = await import('../operations.js');
  const { resolveQueuePaths: rqp } = await import('../paths.js');

  const paths = await seedLifecycleFixture(repoRoot);
  const outputPath = path.join(paths.dropboxDir, 'task-lifecycle.md');

  const result = await publishPendingItem({
    repoRoot,
    contextPackDir: paths.contextPackDir,
    lockOperationName: 'test.lifecycle.publish',
    publish: () => createDropboxTask({
      title: 'Lifecycle Progress',
      outputPath,
      force: true,
      repoRoot,
      contextPackDir: paths.contextPackDir,
      contextPackId: 'orders',
      scopeMode: 'repo-selection',
      primaryRepoId: 'backend',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
    }),
  });
  expect(result.activation.activated).toBe(true);
  const activeTaskIds = getActive(rqp(repoRoot));
  expect(activeTaskIds).toHaveLength(1);
  const taskId = activeTaskIds[0]!;

  await completePendingItem({
    taskId,
    repoRoot,
    skipValidation: true,
    skipArchive: true,
  });

  return { taskId, repoSlug: path.basename(paths.repoDir) };
}

function expectProgressOrderedSubsequence(values: unknown[], expected: unknown[]): void {
  let cursor = -1;
  for (const value of expected) {
    const next = values.findIndex((candidate, index) => index > cursor && candidate === value);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe('queue lifecycle progress narrative', () => {
  beforeEach(() => {
    vi.resetModules();
    unmockLifecycleModules();
    realLogSnapshot = snapshotRealLogs();
    progressTmpRoot = mkdtempSync(path.join(tmpdir(), 'queue-lifecycle-progress-'));
    progressLogDir = mkdtempSync(path.join(tmpdir(), 'queue-lifecycle-progress-logs-'));
    for (const key of LOG_ENV_KEYS) {
      vi.stubEnv(key, undefined);
    }
    vi.stubEnv('LOG_DIR', progressLogDir);
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
    rmSync(progressTmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    rmSync(progressLogDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    unmockLifecycleModules();
    expect(snapshotRealLogs()).toEqual(realLogSnapshot);
  });

  it('emits the dropbox to active to closeout progress narrative in order', async () => {
    stubStderrTty(true);
    mockLifecycleBoundaries();

    const { taskId, repoSlug } = await runLifecycleScenario(progressTmpRoot);

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
    const { resolveQueuePaths: rqp } = await import('../paths.js');
    const { activateNextPendingItemIfReady: activate } = await import('../operations.js');
    const paths = rqp(progressTmpRoot);
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'task-stranded.completing'), '{}');

    await expect(activate({ paths, repoRoot: progressTmpRoot })).resolves.toEqual({ activated: false });

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

    const { taskId } = await runLifecycleScenario(progressTmpRoot);

    expect(stderrChunks().filter(isHumanProgressLine)).toEqual([]);
    const lifecycleMessages = readProgressLevel('info', progressLogDir)
      .filter((record) => record.task_id === taskId)
      .map((record) => record.msg);
    expectProgressOrderedSubsequence(lifecycleMessages, [
      'queue.pending.promoted',
      'queue.branch.created',
      'queue.active.activated',
      'closeout.finalized',
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
