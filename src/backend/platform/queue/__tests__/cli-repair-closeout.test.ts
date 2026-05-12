import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../resumeCloseout.js', () => ({
  resumeCloseoutFromSentinel: vi.fn(),
}));

import { resumeCloseoutFromSentinel } from '../resumeCloseout.js';
import { main } from '../cli-repair-closeout.js';

const mockResume = vi.mocked(resumeCloseoutFromSentinel);

describe('cli-repair-closeout', () => {
  let repoRoot: string;
  let stdout: string;
  let stderr: string;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-repair-cli-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
    stdout = '';
    stderr = '';
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
  });

  it('prints usage and sets exit code 1 when neither --task-id nor --scan is given', async () => {
    await main(['--repo-root', repoRoot]);
    expect(stderr).toContain('Usage: repair-stuck-closeout');
    expect(process.exitCode).toBe(1);
    expect(mockResume).not.toHaveBeenCalled();
  });

  it('--dry-run reports what would be repaired without calling resume', async () => {
    await main(['--task-id', 'task-abc', '--dry-run', '--repo-root', repoRoot]);
    expect(mockResume).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout);
    expect(payload.wouldRepair).toEqual(['task-abc']);
    expect(payload.repoRoot).toBe(path.resolve(repoRoot));
  });

  it('--task-id drives a single resume call and prints its ResumeCloseoutResult', async () => {
    mockResume.mockResolvedValueOnce({
      status: 'completed',
      drove: ['finalize-worktrees', 'unlink-marker', 'unlink-sentinel'],
    });
    await main(['--task-id', 'task-xyz', '--repo-root', repoRoot]);
    expect(mockResume).toHaveBeenCalledWith('task-xyz', repoRoot);
    const payload = JSON.parse(stdout);
    expect(payload).toHaveLength(1);
    expect(payload[0].taskId).toBe('task-xyz');
    expect(payload[0].drove).toContain('finalize-worktrees');
  });

  it('--scan discovers all .completing sentinels and resumes each', async () => {
    const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    writeFileSync(path.join(activeItemsDir, 'task-1.completing'), '{}');
    writeFileSync(path.join(activeItemsDir, 'task-2.completing'), '{}');
    mockResume.mockResolvedValue({ status: 'completed', drove: [] });

    await main(['--scan', '--repo-root', repoRoot]);

    expect(mockResume).toHaveBeenCalledTimes(2);
    const calledIds = mockResume.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(['task-1', 'task-2']);
  });

  it('refuses to repair on no-archive-record and recommends requeue-error-item', async () => {
    mockResume.mockResolvedValueOnce({ status: 'no-archive-record', drove: [] });
    await main(['--task-id', 'task-broken', '--repo-root', repoRoot]);
    expect(stderr).toContain('Refusing to repair task-broken');
    expect(stderr).toContain('pnpm run requeue-error-item -- --task-id task-broken');
    // Result is still emitted to stdout so the operator sees the structured outcome.
    const payload = JSON.parse(stdout);
    expect(payload[0].status).toBe('no-archive-record');
  });
});
