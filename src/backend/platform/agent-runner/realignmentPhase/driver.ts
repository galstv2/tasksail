import path from 'node:path';

import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';
import { ensureDir, readTextFile, runPython, safeJsonParse, slugify, PythonRunError } from '../../core/index.js';
import { acquireDirLock } from '../../queue/dirLock.js';
import { runStandaloneRoleAgent } from '../standaloneRoleAgent.js';
import { resolveReinforcementStoreFileForRead } from '../reinforcementPaths.js';
import { buildRealignmentContextBundle } from './bundle.js';
import { buildRealignmentPrompt } from './prompt.js';
import { parseRealignmentAnalysis } from './parser.js';

export interface RealignmentExecutionResult {
  passed: boolean;
  realignmentId: string;
  status: 'archived' | 'error' | 'skipped' | 'partial';
  reason?: string;
  globalRealignmentVersion?: number;
}

interface RealignmentSessionRecord {
  realignment_id?: unknown;
  trigger_task_id?: unknown;
  trigger_feedback_id?: unknown;
  status?: unknown;
}

interface IngestResponse {
  status?: unknown;
  reason?: unknown;
  global_realignment_version?: unknown;
}

export async function executeRealignmentSession(options: {
  repoRoot: string;
  contextPackDir: string;
  realignmentId: string;
  abortSignal?: AbortSignal;
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<RealignmentExecutionResult> {
  const session = await loadRealignmentSession(options.repoRoot, options.realignmentId);
  if (!session) {
    return {
      passed: false,
      realignmentId: options.realignmentId,
      status: 'error',
      reason: 'session_not_found',
    };
  }
  if (!isRunnable(session)) {
    return {
      passed: false,
      realignmentId: options.realignmentId,
      status: 'skipped',
      reason: 'session_not_analyzable',
    };
  }

  const lockDir = path.join(
    options.repoRoot,
    '.platform-state',
    'runtime',
    'realignment',
    slugify(path.basename(options.contextPackDir), 'context-pack'),
    'realignment.lock',
  );
  await ensureDir(path.dirname(lockDir));
  const release = await acquireDirLock(lockDir, 1);
  if (!release) {
    return {
      passed: false,
      realignmentId: options.realignmentId,
      status: 'skipped',
      reason: 'realignment_in_progress',
    };
  }

  try {
    const runtimeDir = path.join(
      options.repoRoot,
      '.platform-state',
      'runtime',
      'realignment',
      options.realignmentId,
    );
    await ensureDir(runtimeDir);
    const stagingPath = path.join(runtimeDir, 'analysis.md');

    if (session.status === 'reviewed') {
      return await recoverReviewedArchive(options);
    }

    const bundle = await buildRealignmentContextBundle({
      repoRoot: options.repoRoot,
      contextPackDir: options.contextPackDir,
      realignmentId: options.realignmentId,
      triggerTaskId: asString(session.trigger_task_id),
      triggerFeedbackId: asString(session.trigger_feedback_id),
    });
    const promptOverride = await buildRealignmentPrompt({
      repoRoot: options.repoRoot,
      bundle,
      externalMcpRegistry: options.externalMcpRegistry,
    });

    try {
      await runStandaloneRoleAgent({
        agentId: 'ron',
        repoRoot: options.repoRoot,
        contextPackDir: options.contextPackDir,
        runtimeDir,
        launchPhase: 'Realignment',
        promptOverride,
        extraAllowedDirs: [runtimeDir],
        extraEnv: {
          TASKSAIL_REALIGNMENT_STAGING_PATH: stagingPath,
        },
        abortSignal: options.abortSignal,
      });
      const stagingMarkdown = await readTextFile(stagingPath);
      if (!stagingMarkdown?.trim()) {
        throw new Error('realignment_analysis_missing');
      }
      const parsed = parseRealignmentAnalysis(stagingMarkdown);
      return await ingestParsedAnalysis(options, parsed);
    } catch (error) {
      const partial = partialResultFromError(options.realignmentId, error);
      if (partial) return partial;
      const reason = normalizeReason(error);
      await markError(options, reason);
      return {
        passed: false,
        realignmentId: options.realignmentId,
        status: 'error',
        reason,
      };
    }
  } finally {
    await release();
  }
}

async function ingestParsedAnalysis(
  options: {
    repoRoot: string;
    contextPackDir: string;
    realignmentId: string;
    abortSignal?: AbortSignal;
  },
  parsed: ReturnType<typeof parseRealignmentAnalysis>,
): Promise<RealignmentExecutionResult> {
  const scriptPath = path.join(options.repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py');
  try {
    const result = await runPython(
      scriptPath,
      [
        '--repo-root', options.repoRoot,
        '--context-pack-dir', options.contextPackDir,
        '--realignment-id', options.realignmentId,
        '--stdin',
      ],
      {
        cwd: options.repoRoot,
        stdin: `${JSON.stringify({
          failure_analysis: parsed.failureAnalysis,
          root_cause: parsed.rootCause,
          corrective_actions: parsed.correctiveActions,
          validation_notes: parsed.validationNotes,
          meeting_notes: parsed.meetingNotes,
        })}\n`,
        abortSignal: options.abortSignal,
      },
    );
    const response = parseIngestResponse(result.stdout);
    return {
      passed: response.status === 'archived',
      realignmentId: options.realignmentId,
      status: response.status === 'archived' ? 'archived' : 'error',
      reason: asString(response.reason) || undefined,
      globalRealignmentVersion: numberOrUndefined(response.global_realignment_version),
    };
  } catch (error) {
    const partial = partialResultFromError(options.realignmentId, error);
    if (partial) return partial;
    throw error;
  }
}

async function recoverReviewedArchive(options: {
  repoRoot: string;
  contextPackDir: string;
  realignmentId: string;
  abortSignal?: AbortSignal;
}): Promise<RealignmentExecutionResult> {
  const scriptPath = path.join(options.repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py');
  try {
    const result = await runPython(
      scriptPath,
      [
        '--repo-root', options.repoRoot,
        '--context-pack-dir', options.contextPackDir,
        '--realignment-id', options.realignmentId,
        '--archive-reviewed',
      ],
      {
        cwd: options.repoRoot,
        abortSignal: options.abortSignal,
      },
    );
    const response = parseIngestResponse(result.stdout);
    return {
      passed: response.status === 'archived',
      realignmentId: options.realignmentId,
      status: response.status === 'archived' ? 'archived' : 'partial',
      reason: asString(response.reason) || undefined,
      globalRealignmentVersion: numberOrUndefined(response.global_realignment_version),
    };
  } catch (error) {
    const partial = partialResultFromError(options.realignmentId, error);
    if (partial) return partial;
    throw error;
  }
}

async function markError(
  options: {
    repoRoot: string;
    contextPackDir: string;
    realignmentId: string;
    abortSignal?: AbortSignal;
  },
  reason: string,
): Promise<void> {
  const scriptPath = path.join(options.repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py');
  await runPython(
    scriptPath,
    [
      '--repo-root', options.repoRoot,
      '--context-pack-dir', options.contextPackDir,
      '--realignment-id', options.realignmentId,
      '--mark-error',
      '--reason', reason,
    ],
    {
      cwd: options.repoRoot,
      abortSignal: options.abortSignal,
    },
  );
}

async function loadRealignmentSession(
  repoRoot: string,
  realignmentId: string,
): Promise<RealignmentSessionRecord | null> {
  const sessionsPath = await resolveReinforcementStoreFileForRead(
    repoRoot,
    'realignment',
    'sessions.json',
  );
  const raw = await readTextFile(sessionsPath);
  if (!raw) return null;
  const payload = safeJsonParse<{ entries?: unknown }>(raw, sessionsPath);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return entries.find((entry): entry is RealignmentSessionRecord => (
    typeof entry === 'object'
    && entry !== null
    && (entry as RealignmentSessionRecord).realignment_id === realignmentId
  )) ?? null;
}

function isRunnable(session: RealignmentSessionRecord): boolean {
  return session.status === 'open' || session.status === 'error' || session.status === 'reviewed';
}

function partialResultFromError(
  realignmentId: string,
  error: unknown,
): RealignmentExecutionResult | null {
  if (!(error instanceof PythonRunError)) return null;
  const response = tryParseIngestResponse(error.stdout);
  if (response?.status !== 'partial') return null;
  return {
    passed: false,
    realignmentId,
    status: 'partial',
    reason: asString(response.reason) || 'promotion_committed_failure',
    globalRealignmentVersion: numberOrUndefined(response.global_realignment_version),
  };
}

function parseIngestResponse(stdout: string): IngestResponse {
  return safeJsonParse<IngestResponse>(stdout, 'realignment-ingest stdout');
}

function tryParseIngestResponse(stdout: string): IngestResponse | null {
  try {
    return parseIngestResponse(stdout);
  } catch {
    return null;
  }
}

function normalizeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'realignment_execution_failed';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
