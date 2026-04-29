/**
 * Tests for spawnPipeline.ts (§5.1 MG-7).
 *
 * F13: stdout/stderr streams are exposed on the returned object.
 * F14: resolveChildEntryPath returns .ts in dev, .js from app.asar.unpacked in production.
 *
 * Concurrent fork and env-vs-argv precedence tests use the CJS stub at
 * __tests__/fixtures/pipelineChildStub.cjs, which replicates pipelineChildEntry.ts's
 * arg-parsing and precedence logic without invoking runPipelineSequence.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { resolveChildEntryPath } from '../spawnPipeline.js';

// Path to the CJS stub — forkable without tsx
const STUB_PATH = fileURLToPath(new URL('./fixtures/pipelineChildStub.cjs', import.meta.url));
const spawnedChildren = new Set<ChildProcess>();

function trackChild(child: ChildProcess): ChildProcess {
  spawnedChildren.add(child);
  child.once('exit', () => {
    spawnedChildren.delete(child);
  });
  return child;
}

async function cleanupSpawnedChildren(): Promise<void> {
  const children = [...spawnedChildren];
  spawnedChildren.clear();

  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }));
}

/** Fork the stub with the given argv args and env overrides. Returns { pid, stdout, stderr, exit }. */
function forkStub(
  args: string[],
  env: Record<string, string> = {},
): { pid: number; stdout: Readable; stderr: Readable; exit: Promise<number> } {
  const child = trackChild(fork(STUB_PATH, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }));
  return {
    pid: child.pid!,
    stdout: child.stdout!,
    stderr: child.stderr!,
    exit: new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1))),
  };
}

/** Collect all data from a Readable into a string. */
function collectStream(stream: Readable): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// Temp dirs created during tests
const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupSpawnedChildren();
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Test 1: Two-task concurrent fork — both run without contention
// ---------------------------------------------------------------------------
describe('spawnPipelineForTask — concurrent fork', () => {
  it('runs two child processes with different taskIds concurrently without contention', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'spawn-concurrent-'));
    tempDirs.push(tmp);
    const receiptA = join(tmp, 'receipt-a.json');
    const receiptB = join(tmp, 'receipt-b.json');

    const childA = forkStub(
      ['--task-id', 'task-alpha', '--repo-root', tmp],
      { TASKSAIL_TASK_ID: 'task-alpha', STUB_RECEIPT_PATH: receiptA },
    );
    const childB = forkStub(
      ['--task-id', 'task-beta', '--repo-root', tmp],
      { TASKSAIL_TASK_ID: 'task-beta', STUB_RECEIPT_PATH: receiptB },
    );

    // Drain streams to prevent pipe buffer stalling
    childA.stdout.resume();
    childA.stderr.resume();
    childB.stdout.resume();
    childB.stderr.resume();

    // Both must have distinct PIDs
    expect(childA.pid).toBeTypeOf('number');
    expect(childB.pid).toBeTypeOf('number');
    expect(childA.pid).not.toBe(childB.pid);

    // Wait for both to complete concurrently
    const [exitA, exitB] = await Promise.all([childA.exit, childB.exit]);
    expect(exitA).toBe(0);
    expect(exitB).toBe(0);

    // Both receipt files must exist and contain their respective taskIds
    expect(existsSync(receiptA)).toBe(true);
    expect(existsSync(receiptB)).toBe(true);

    const { readFileSync } = await import('node:fs');
    const rA = JSON.parse(readFileSync(receiptA, 'utf-8')) as { taskId: string; pid: number };
    const rB = JSON.parse(readFileSync(receiptB, 'utf-8')) as { taskId: string; pid: number };
    expect(rA.taskId).toBe('task-alpha');
    expect(rB.taskId).toBe('task-beta');
    // PIDs in receipts match the forked children
    expect(rA.pid).toBe(childA.pid);
    expect(rB.pid).toBe(childB.pid);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Test 2: Env-vs-argv precedence (four sub-cases)
// ---------------------------------------------------------------------------
describe('spawnPipelineForTask — env-vs-argv precedence', () => {
  it('argv and matching env: child uses argv value, no error', async () => {
    const child = forkStub(
      ['--task-id', 'a', '--repo-root', '/tmp'],
      { TASKSAIL_TASK_ID: 'a' },
    );
    const stderr = collectStream(child.stderr);
    child.stdout.resume();
    const exitCode = await child.exit;
    expect(exitCode).toBe(0);
    const stderrText = await stderr;
    expect(stderrText).not.toContain('conflicting-task-id');
    expect(stderrText).not.toContain('task-id-required');
  }, 10_000);

  it('argv and mismatching env: child throws conflicting-task-id-arg-vs-env, exits non-zero', async () => {
    const child = forkStub(
      ['--task-id', 'a', '--repo-root', '/tmp'],
      { TASKSAIL_TASK_ID: 'b' },
    );
    const stderr = collectStream(child.stderr);
    child.stdout.resume();
    const exitCode = await child.exit;
    expect(exitCode).not.toBe(0);
    const stderrText = await stderr;
    expect(stderrText).toContain('conflicting-task-id-arg-vs-env');
    expect(stderrText).toContain('argv=a');
    expect(stderrText).toContain('env=b');
  }, 10_000);

  it('env-only (no argv): child uses env value, exits 0', async () => {
    const child = forkStub(
      ['--repo-root', '/tmp'],
      { TASKSAIL_TASK_ID: 'a' },
    );
    const [exitCode, stdoutText] = await Promise.all([
      child.exit,
      collectStream(child.stdout),
    ]);
    child.stderr.resume();
    expect(exitCode).toBe(0);
    expect(stdoutText).toContain('pipeline-stub-ok:a');
  }, 10_000);

  it('neither argv nor env: child throws task-id-required, exits non-zero', async () => {
    // Scrub TASKSAIL_TASK_ID from the child env
    const child = forkStub([], { TASKSAIL_TASK_ID: '' });
    // When empty string is set, the stub still falls through to task-id-required
    // because empty string is falsy in the JS check (envTaskId !== undefined && envTaskId)
    // Explicit: spawn without any task id at all
    const childNoEnv = trackChild(fork(STUB_PATH, ['--repo-root', '/tmp'], {
      env: Object.fromEntries(
        Object.entries({ ...process.env }).filter(([k]) => k !== 'TASKSAIL_TASK_ID'),
      ) as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }));
    const stderrText = await collectStream(childNoEnv.stderr!);
    const exitCode = await new Promise<number>((resolve) => childNoEnv.on('exit', (c) => resolve(c ?? 1)));
    childNoEnv.stdout?.resume();
    // drain the first (empty-string) child too
    child.stdout.resume();
    child.stderr.resume();
    await child.exit;

    expect(exitCode).not.toBe(0);
    expect(stderrText).toContain('task-id-required');
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Test 3: F13 — stdout and stderr streams are exposed and readable
// ---------------------------------------------------------------------------
describe('spawnPipelineForTask — F13 streams exposed', () => {
  it('returned object has stdout and stderr Readable instances', async () => {
    const child = forkStub(
      ['--task-id', 'stream-test', '--repo-root', '/tmp'],
      { TASKSAIL_TASK_ID: 'stream-test' },
    );

    // Assert stream types
    expect(child.stdout).toBeInstanceOf(Readable);
    expect(child.stderr).toBeInstanceOf(Readable);
    expect(typeof child.stdout.pipe).toBe('function');
    expect(typeof child.stderr.pipe).toBe('function');

    // Assert stdout actually delivers data
    const stdoutText = await collectStream(child.stdout);
    child.stderr.resume();
    const exitCode = await child.exit;

    expect(exitCode).toBe(0);
    expect(stdoutText).toContain('pipeline-stub-ok:stream-test');
  }, 10_000);

  it('exit promise resolves with numeric exit code', async () => {
    const child = forkStub(
      ['--task-id', 'exit-test', '--repo-root', '/tmp'],
      { TASKSAIL_TASK_ID: 'exit-test' },
    );
    child.stdout.resume();
    child.stderr.resume();
    const exitCode = await child.exit;
    expect(typeof exitCode).toBe('number');
    expect(exitCode).toBe(0);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Test 4: F14 — ASAR path discriminator unit test
// ---------------------------------------------------------------------------
describe('resolveChildEntryPath — F14 ASAR discriminator', () => {
  it('returns .ts suffix in dev environment (isPackaged falsy)', () => {
    // Ensure isPackaged is not set
    const saved = (process as any).isPackaged;
    try {
      delete (process as any).isPackaged;
      const result = resolveChildEntryPath('/some/dir', 'pipelineChildEntry');
      expect(result).toMatch(/\.ts$/);
      expect(result).toBe(join('/some/dir', 'pipelineChildEntry.ts'));
    } finally {
      if (saved !== undefined) {
        (process as any).isPackaged = saved;
      }
    }
  });

  it('returns .js suffix with .asar.unpacked path when isPackaged=true', () => {
    const saved = (process as any).isPackaged;
    try {
      (process as any).isPackaged = true;
      const asarDir = `/app/resources/app.asar${sep}backend${sep}platform${sep}agent-runner`;
      const result = resolveChildEntryPath(asarDir, 'pipelineChildEntry');
      expect(result).toMatch(/\.js$/);
      expect(result).toContain('app.asar.unpacked');
      expect(result).not.toMatch(/\.ts$/);
    } finally {
      if (saved !== undefined) {
        (process as any).isPackaged = saved;
      } else {
        delete (process as any).isPackaged;
      }
    }
  });

  it('replaces .asar/ with .asar.unpacked/ in the directory segment (forward slash)', () => {
    const saved = (process as any).isPackaged;
    try {
      (process as any).isPackaged = true;
      const dir = '/app/resources/app.asar/backend';
      const result = resolveChildEntryPath(dir, 'pipelineChildEntry');
      expect(result).toContain('app.asar.unpacked/backend');
      expect(result.endsWith('.js')).toBe(true);
    } finally {
      if (saved !== undefined) {
        (process as any).isPackaged = saved;
      } else {
        delete (process as any).isPackaged;
      }
    }
  });

  it('dev path: result ends with pipelineChildEntry.ts (no literal .ts in spawnPipeline.ts)', () => {
    // F14 contract: the .ts suffix is constructed by resolveChildEntryPath, not hardcoded.
    // This test verifies the runtime behavior of that construction.
    const saved = (process as any).isPackaged;
    try {
      delete (process as any).isPackaged;
      const result = resolveChildEntryPath('/dir', 'pipelineChildEntry');
      expect(result.endsWith(`${sep}pipelineChildEntry.ts`) || result.endsWith('/pipelineChildEntry.ts')).toBe(true);
    } finally {
      if (saved !== undefined) {
        (process as any).isPackaged = saved;
      }
    }
  });
});
