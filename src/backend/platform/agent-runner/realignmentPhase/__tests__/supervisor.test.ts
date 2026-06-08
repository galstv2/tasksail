import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  runRealignmentAnalysis: vi.fn(),
}));

vi.mock('../../reinforcementWrite.js', () => ({
  runRealignmentAnalysis: mocks.runRealignmentAnalysis,
}));

const { startRealignmentAnalysisJob } = await import('../supervisor.js');

describe('startRealignmentAnalysisJob', () => {
  const repoRoot = path.join(process.cwd(), '.platform-state', 'test-realignment-supervisor');
  const contextPackDir = path.join(repoRoot, 'contextpacks', 'pack-a');
  const realignmentId = 'RA-1';
  const originalLogDir = process.env.LOG_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(repoRoot, { recursive: true, force: true });
    mkdirSync(contextPackDir, { recursive: true });
    process.env.LOG_DIR = path.join(repoRoot, 'logs');
  });

  afterEach(() => {
    if (originalLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = originalLogDir;
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes a running receipt and returns before analysis finishes', async () => {
    let resolveAnalysis!: (value: unknown) => void;
    mocks.runRealignmentAnalysis.mockReturnValue(new Promise((resolve) => {
      resolveAnalysis = resolve;
    }));

    const startResult = await startRealignmentAnalysisJob({
      repoRoot,
      contextPackDir,
      realignmentId,
    });

    expect(startResult).toEqual({
      jobId: 'realignment:RA-1',
      realignmentId,
      status: 'started',
    });
    expect(readReceipt()).toEqual(expect.objectContaining({
      jobId: 'realignment:RA-1',
      realignmentId,
      status: 'running',
      startedAt: expect.any(String),
    }));
    expect(mocks.runRealignmentAnalysis).toHaveBeenCalledWith({
      repoRoot,
      contextPackDir,
      realignmentId,
      abortSignal: undefined,
      externalMcpRegistry: undefined,
    });

    resolveAnalysis({
      passed: true,
      realignmentId,
      status: 'archived',
      globalRealignmentVersion: 7,
    });
    await vi.waitFor(() => {
      expect(readReceipt()).toEqual(expect.objectContaining({
        status: 'archived',
        completedAt: expect.any(String),
        globalRealignmentVersion: 7,
      }));
    });
  });

  it.each([
    ['duplicate ID', realignmentId, 'realignment:RA-1', realignmentId, 'realignment_job_already_running'] as const,
    ['different ID', 'RA-2', 'realignment:RA-2', 'RA-2', 'realignment_job_active'] as const,
  ])('returns already-running for %s while a job is active', async (_label, secondId, secondJobId, secondRaId, reason) => {
    let resolveAnalysis!: (value: unknown) => void;
    mocks.runRealignmentAnalysis.mockReturnValueOnce(new Promise((resolve) => {
      resolveAnalysis = resolve;
    }));

    await expect(startRealignmentAnalysisJob({
      repoRoot,
      contextPackDir,
      realignmentId,
    })).resolves.toMatchObject({ status: 'started' });

    await expect(startRealignmentAnalysisJob({
      repoRoot,
      contextPackDir,
      realignmentId: secondId,
    })).resolves.toEqual({
      jobId: secondJobId,
      realignmentId: secondRaId,
      status: 'already-running',
      reason,
    });

    resolveAnalysis({ passed: false, realignmentId, status: 'skipped', reason: 'done' });
    await vi.waitFor(() => {
      expect(readReceipt()).toEqual(expect.objectContaining({ status: 'skipped' }));
    });

    // After settlement, the same ID can be relaunched (duplicate-ID case only)
    if (secondId === realignmentId) {
      mocks.runRealignmentAnalysis.mockResolvedValueOnce({
        passed: false,
        realignmentId,
        status: 'error',
        reason: 'second',
      });
      await expect(startRealignmentAnalysisJob({
        repoRoot,
        contextPackDir,
        realignmentId,
      })).resolves.toMatchObject({ status: 'started' });
      await vi.waitFor(() => {
        expect(readReceipt()).toEqual(expect.objectContaining({ status: 'error', reason: 'second' }));
      });
    }
  });

  it('returns failed and does not start analysis when the initial receipt cannot be written', async () => {
    rmSync(repoRoot, { recursive: true, force: true });
    writeFileSync(repoRoot, 'not a directory', 'utf-8');

    const result = await startRealignmentAnalysisJob({
      repoRoot,
      contextPackDir,
      realignmentId,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('receipt_write_failed:');
    expect(mocks.runRealignmentAnalysis).not.toHaveBeenCalled();
  });

  it('contains background failures and records an error receipt', async () => {
    mocks.runRealignmentAnalysis.mockRejectedValueOnce(new Error('Ron crashed'));

    await expect(startRealignmentAnalysisJob({
      repoRoot,
      contextPackDir,
      realignmentId,
    })).resolves.toMatchObject({ status: 'started' });

    await vi.waitFor(() => {
      expect(readReceipt()).toEqual(expect.objectContaining({
        status: 'error',
        reason: 'Ron crashed',
      }));
    });
  });

  function readReceipt(): Record<string, unknown> {
    const receiptPath = path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'realignment',
      realignmentId,
      'job.json',
    );
    return JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
  }
});
