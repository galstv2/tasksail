/**
 * Focused tests for the provider-PID sentinel written by runAgentSession.
 *
 * Deterministic: launchAgent and waitForAgentDetailed are mocked; no real
 * child processes are spawned. The sentinel is written with a real node:fs
 * writeFileSync to a temp launchDir, then read back to assert behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  launchAgent: vi.fn(),
  waitForAgentDetailed: vi.fn(),
  writeSessionStartReceipt: vi.fn(),
  writeSessionTerminalReceipt: vi.fn(),
  writeSessionMonitorHeartbeat: vi.fn(),
  getActiveProvider: vi.fn(),
  emitTaskProgressEvent: vi.fn(),
}));

vi.mock('../processLifecycle.js', () => ({
  launchAgent: mocks.launchAgent,
  waitForAgentDetailed: mocks.waitForAgentDetailed,
}));

vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return {
    ...actual,
    emitTaskProgressEvent: mocks.emitTaskProgressEvent,
  };
});

vi.mock('../sessionReceipts.js', () => ({
  writeSessionStartReceipt: mocks.writeSessionStartReceipt,
  writeSessionTerminalReceipt: mocks.writeSessionTerminalReceipt,
  writeSessionMonitorHeartbeat: mocks.writeSessionMonitorHeartbeat,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: mocks.getActiveProvider,
}));

const { runAgentSession } = await import('../agentSession.js');

/** A minimal resolved run summary. */
function makeRunSummary() {
  return {
    exitCode: 0,
    terminationReason: 'exited' as const,
    stdout: '',
    stderr: '',
  };
}

/** A fake ChildProcess-like object. */
function makeFakeChild(pid: number | undefined) {
  return {
    pid,
    killed: false,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    stdout: null,
    stderr: null,
    stdin: null,
  };
}

describe('runAgentSession — provider-PID sentinel', () => {
  let tmpRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tasksail-provider-pid-'));
    mocks.writeSessionStartReceipt.mockResolvedValue(null);
    mocks.writeSessionTerminalReceipt.mockResolvedValue(undefined);
    mocks.writeSessionMonitorHeartbeat.mockResolvedValue(undefined);
    mocks.emitTaskProgressEvent.mockResolvedValue(undefined);
    mocks.waitForAgentDetailed.mockResolvedValue(makeRunSummary());
    mocks.getActiveProvider.mockReturnValue({ id: 'copilot' });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes .provider-pid sentinel when launchDir is provided and child has a numeric pid', async () => {
    mocks.launchAgent.mockReturnValue(makeFakeChild(4242));

    await runAgentSession({
      repoRoot: '/repo',
      cliArgs: ['--foo'],
      cwd: '/repo',
      env: {},
      launchDir: tmpRoot,
    });

    const sentinel = path.join(tmpRoot, '.provider-pid');
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, 'utf-8')).toBe('4242');
  });

  it('does NOT write sentinel when launchDir is omitted', async () => {
    mocks.launchAgent.mockReturnValue(makeFakeChild(5555));

    await expect(
      runAgentSession({ repoRoot: '/repo', cliArgs: ['--foo'], cwd: '/repo', env: {} }),
    ).resolves.not.toThrow();

    expect(existsSync(path.join(tmpRoot, '.provider-pid'))).toBe(false);
  });

  it('does NOT write sentinel when launchDir is undefined', async () => {
    mocks.launchAgent.mockReturnValue(makeFakeChild(6666));

    await expect(
      runAgentSession({ repoRoot: '/repo', cliArgs: ['--foo'], cwd: '/repo', env: {}, launchDir: undefined }),
    ).resolves.not.toThrow();

    expect(existsSync(path.join(tmpRoot, '.provider-pid'))).toBe(false);
  });

  it('does NOT write sentinel when child.pid is undefined, and does not crash', async () => {
    mocks.launchAgent.mockReturnValue(makeFakeChild(undefined));

    await expect(
      runAgentSession({
        repoRoot: '/repo',
        cliArgs: ['--foo'],
        cwd: '/repo',
        env: {},
        launchDir: tmpRoot,
      }),
    ).resolves.not.toThrow();

    expect(existsSync(path.join(tmpRoot, '.provider-pid'))).toBe(false);
  });
});
