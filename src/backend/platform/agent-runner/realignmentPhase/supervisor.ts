import path from 'node:path';

import {
  ensureDir,
  createLogger,
  getErrorMessage,
  writeTextFileAtomic,
} from '../../core/index.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';
import { runRealignmentAnalysis } from '../reinforcementWrite.js';
import type { RealignmentExecutionResult } from './driver.js';

const log = createLogger('platform/agent-runner/realignmentPhase/supervisor');

export interface RealignmentJobStartResult {
  jobId: string;
  realignmentId: string;
  status: 'started' | 'already-running' | 'failed';
  reason?: string;
}

type RealignmentJobReceipt = {
  jobId: string;
  realignmentId: string;
  status: 'running' | 'archived' | 'error' | 'skipped' | 'partial';
  startedAt: string;
  completedAt?: string;
  reason?: string;
  globalRealignmentVersion?: number;
};

const runningJobs = new Map<string, Promise<void>>();
let activeRealignmentId: string | null = null;

export function startRealignmentAnalysisJob(options: {
  repoRoot: string;
  contextPackDir: string;
  realignmentId: string;
  abortSignal?: AbortSignal;
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<RealignmentJobStartResult> {
  return startRealignmentAnalysisJobInternal(options);
}

async function startRealignmentAnalysisJobInternal(options: {
  repoRoot: string;
  contextPackDir: string;
  realignmentId: string;
  abortSignal?: AbortSignal;
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<RealignmentJobStartResult> {
  const existingJob = runningJobs.get(options.realignmentId);
  if (existingJob) {
    return {
      jobId: jobIdForRealignment(options.realignmentId),
      realignmentId: options.realignmentId,
      status: 'already-running',
      reason: 'realignment_job_already_running',
    };
  }
  if (activeRealignmentId) {
    return {
      jobId: jobIdForRealignment(options.realignmentId),
      realignmentId: options.realignmentId,
      status: 'already-running',
      reason: 'realignment_job_active',
    };
  }

  const jobId = jobIdForRealignment(options.realignmentId);
  const startedAt = new Date().toISOString();
  const runningReceipt: RealignmentJobReceipt = {
    jobId,
    realignmentId: options.realignmentId,
    status: 'running',
    startedAt,
  };

  try {
    await writeJobReceipt(options.repoRoot, options.realignmentId, runningReceipt);
  } catch (error) {
    return {
      jobId,
      realignmentId: options.realignmentId,
      status: 'failed',
      reason: `receipt_write_failed:${getErrorMessage(error)}`,
    };
  }

  activeRealignmentId = options.realignmentId;
  const jobPromise = runJob(options, jobId, startedAt)
    .catch((error) => {
      log.warn('realignment_job.failed', { realignmentId: options.realignmentId, error: getErrorMessage(error) });
    })
    .finally(() => {
      runningJobs.delete(options.realignmentId);
      if (activeRealignmentId === options.realignmentId) {
        activeRealignmentId = null;
      }
    });
  runningJobs.set(options.realignmentId, jobPromise);

  return {
    jobId,
    realignmentId: options.realignmentId,
    status: 'started',
  };
}

async function runJob(
  options: {
    repoRoot: string;
    contextPackDir: string;
    realignmentId: string;
    abortSignal?: AbortSignal;
    externalMcpRegistry?: ExternalMcpRegistry;
  },
  jobId: string,
  startedAt: string,
): Promise<void> {
  let result: RealignmentExecutionResult;
  try {
    result = await runRealignmentAnalysis({
      repoRoot: options.repoRoot,
      contextPackDir: options.contextPackDir,
      realignmentId: options.realignmentId,
      abortSignal: options.abortSignal,
      externalMcpRegistry: options.externalMcpRegistry,
    });
  } catch (error) {
    result = {
      passed: false,
      realignmentId: options.realignmentId,
      status: 'error',
      reason: getErrorMessage(error),
    };
  }

  const finalReceipt: RealignmentJobReceipt = {
    jobId,
    realignmentId: options.realignmentId,
    status: result.status,
    startedAt,
    completedAt: new Date().toISOString(),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.globalRealignmentVersion !== undefined
      ? { globalRealignmentVersion: result.globalRealignmentVersion }
      : {}),
  };

  try {
    await writeJobReceipt(options.repoRoot, options.realignmentId, finalReceipt);
  } catch (error) {
    log.warn('realignment_receipt.write_failed', { realignmentId: options.realignmentId, error: getErrorMessage(error) });
  }
}

async function writeJobReceipt(
  repoRoot: string,
  realignmentId: string,
  receipt: RealignmentJobReceipt,
): Promise<void> {
  const filePath = jobReceiptPath(repoRoot, realignmentId);
  await ensureDir(path.dirname(filePath));
  await writeTextFileAtomic(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function jobReceiptPath(repoRoot: string, realignmentId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'realignment',
    realignmentId,
    'job.json',
  );
}

function jobIdForRealignment(realignmentId: string): string {
  return `realignment:${realignmentId}`;
}
