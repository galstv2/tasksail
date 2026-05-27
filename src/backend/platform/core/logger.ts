import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { exitCodeFor, serializeError } from './errors.js';
import { loadLogConfig, type LogConfig } from './logConfig.js';
import { logFileWithSuffix } from './paths.js';

export type ProgressEvent =
  | 'queue.dropbox.arrived'
  | 'queue.pending.promoted'
  | 'queue.active.activated'
  | 'queue.active.skipped'
  | 'queue.branch.created'
  | 'activation.readonly_context.materialized'
  | 'queue.error_items.moved'
  | 'archive.started'
  | 'archive.completed'
  | 'archive.failed'
  | 'queue.task.completed'
  | 'queue.task.failed'
  | 'activation.blocked.dirty-repos'
  | 'activation.returned-open.branch-conflict'
  | 'child_chain_failure_branch.rollback_preflight_failed'
  | 'child_chain_failure_branch.rollback_completed'
  | 'child_chain_failure_branch.rollback_failed'
  | 'child_chain_failure_branch.branch_delete_skipped'
  | 'startup_recovery.branch_delete.skipped_child_chain'
  | 'auto_merge.applied'
  | 'auto_merge.skipped'
  | 'auto_merge.skipped_child_chain'
  | 'auto_merge.disabled'
  | 'closeout.target_branch_update'
  | 'closeout.finalized'
  | 'closeout.stranded.resumed'
  | 'agent.launch.started'
  | 'agent.launch.terminal'
  | 'pipeline.phase'
  | 'dalton_verification.launching'
  | 'closeout_remediation.launching'
  | 'activation.started'
  | 'activation.validating'
  | 'activation.materializing_worktrees'
  | 'activation.initializing_task'
  | 'activation.failed'
  | 'activation.skipped'
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.deferred'
  | 'agent.artifact_check.started'
  | 'agent.artifact_check.completed'
  | 'agent.artifact_check.failed'
  | 'agent.cleanup.started'
  | 'agent.cleanup.completed'
  | 'agent.cleanup.failed'
  | 'agent.policy_check.started'
  | 'agent.policy_check.completed'
  | 'agent.policy_check.failed'
  | 'agent.policy_remediation.started'
  | 'agent.policy_remediation.completed'
  | 'agent.policy_remediation.failed'
  | 'agent.confinement_retry.started'
  | 'agent.confinement_retry.completed'
  | 'agent.confinement_retry.failed'
  | 'pipeline.agent_order.selected'
  | 'pipeline.dalton_mode.selected'
  | 'test_capture.started'
  | 'test_capture.completed'
  | 'test_capture.skipped'
  | 'qa_remediation.started'
  | 'qa_remediation.cycle_started'
  | 'qa_remediation.cycle_completed'
  | 'qa_remediation.exhausted'
  | 'qa_remediation.completed'
  | 'retrospective.started'
  | 'retrospective.skipped'
  | 'retrospective.completed'
  | 'retrospective.failed'
  | 'pipeline.failed'
  | 'pipeline.killed'
  | 'closeout.started'
  | 'closeout.snapshot_committing'
  | 'closeout.snapshot_committed'
  | 'closeout.branch_verification.started'
  | 'closeout.branch_verification.completed'
  | 'closeout.branch_verification.failed'
  | 'archive.terminal_events_snapshot_copied'
  | 'archive.terminal_events_snapshot_missing'
  | 'archive.terminal_events_snapshot_failed'
  | 'closeout.finalizing_worktrees'
  | 'closeout.child_chain_advancing'
  | 'closeout.child_chain_advanced'
  | 'kill.requested'
  | 'kill.cleanup.started'
  | 'kill.cleanup.completed'
  | 'kill.cleanup.failed'
  | 'failure.finalizing_worktrees'
  | 'failure.recovered_missing_pending'
  | 'mcp.checked'
  | 'mcp.degraded'
  | 'mcp.failed'
  | 'guardrail.receipt.allowed'
  | 'guardrail.receipt.artifact_incomplete'
  | 'guardrail.receipt.policy_blocked'
  | 'guardrail.receipt.denied'
  | 'guardrail.receipt.malformed';

export type ProgressLevel = 'info' | 'warn' | 'error';

export interface ProgressArgs<E extends ProgressEvent = ProgressEvent> {
  level: ProgressLevel;
  event: E;
  extra?: Record<string, unknown>;
  text: string;
}

export interface LogContext {
  taskId?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  spanId?: string | null;
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, errOrExtra?: unknown, extra?: Record<string, unknown>): void;
  progress<E extends ProgressEvent>(args: ProgressArgs<E>): void;
  child(ctx: Partial<LogContext>): Logger;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type WriteLevel = 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const RESERVED_KEYS = new Set([
  'ts',
  'level',
  'stack',
  'module',
  'msg',
  'pid',
  'task_id',
  'agent_id',
  'provider_id',
  'span_id',
  'err',
  'extra',
]);

let retainedDirs = new Set<string>();
let rotationCache = new Map<string, string>();
let warnedReservedKeys = new Set<string>();
let retentionPruned = false;
let installedHandlers:
  | {
      module: string;
      uncaught: (err: Error) => void;
      rejection: (reason: unknown) => void;
    }
  | undefined;

export function createLogger(module: string, ctx: LogContext = {}): Logger {
  const context = { ...ctx };

  return {
    debug: (msg, extra) => emit(module, context, 'debug', msg, undefined, extra),
    info: (msg, extra) => emit(module, context, 'info', msg, undefined, extra),
    warn: (msg, extra) => emit(module, context, 'warn', msg, undefined, extra),
    error: (msg, errOrExtra, extra) => {
      if (isPlainExtra(errOrExtra)) {
        emit(module, context, 'error', msg, undefined, errOrExtra);
        return;
      }
      emit(module, context, 'error', msg, errOrExtra, extra);
    },
    progress: ({ level, event, extra, text }) => {
      if (!shouldWriteProgressLevel(level)) {
        return;
      }
      emit(module, context, level, event, undefined, extra);
      if (shouldEmitProgressLine()) {
        writeProgressLine(text, shouldUseColor(), event);
      }
    },
    child: (ctx) => createLogger(module, { ...context, ...ctx }),
  };
}

export function installProcessHandlers(module = 'platform/process'): () => void {
  if (installedHandlers) {
    return uninstallProcessHandlers;
  }

  const logger = createLogger(module);
  const uncaught = (err: Error): void => {
    logger.error('process.uncaught_exception', err);
    process.exit(exitCodeFor(err));
  };
  const rejection = (reason: unknown): void => {
    logger.error('process.unhandled_rejection', reason);
    process.exit(exitCodeFor(reason));
  };

  process.on('uncaughtException', uncaught);
  process.on('unhandledRejection', rejection);
  installedHandlers = { module, uncaught, rejection };
  return uninstallProcessHandlers;
}

export function newSpanId(): string {
  return randomUUID();
}

export function flushLoggers(): void {
  retainedDirs = new Set();
  rotationCache = new Map();
  warnedReservedKeys = new Set();
  retentionPruned = false;
}

function uninstallProcessHandlers(): void {
  if (!installedHandlers) {
    return;
  }

  process.off('uncaughtException', installedHandlers.uncaught);
  process.off('unhandledRejection', installedHandlers.rejection);
  installedHandlers = undefined;
}

function emit(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  const config = loadLogConfig();
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.level]) {
    return;
  }

  pruneRetention(config);
  const date = new Date();
  const line = buildLine(module, ctx, level, msg, date, err, extra);
  const raw = `${JSON.stringify(line)}\n`;
  writeLine(raw, date, level, line.task_id, line.agent_id, config);

  if (level === 'warn' || level === 'error') {
    process.stderr.write(raw);
  }
}

function shouldWriteProgressLevel(level: ProgressLevel): boolean {
  const config = loadLogConfig();
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[config.level];
}

function shouldEmitProgressLine(): boolean {
  const mode = (process.env.TASKSAIL_LOG_PROGRESS ?? '').toLowerCase();
  const force = process.env.TASKSAIL_LOG_PROGRESS_FORCE === '1';
  const ci = (process.env.CI ?? '') !== '';
  const isTty = process.stderr.isTTY === true;

  if (mode === 'off') return false;
  if (mode === 'plain') return true;
  if (mode === 'color') return !ci || force;
  return isTty && !ci;
}

function shouldUseColor(): boolean {
  const mode = (process.env.TASKSAIL_LOG_PROGRESS ?? '').toLowerCase();
  const noColor = (process.env.NO_COLOR ?? '') !== '';
  if (noColor) return false;
  if (mode === 'plain') return false;
  if (mode === 'color') return true;
  const ci = (process.env.CI ?? '') !== '';
  return process.stderr.isTTY === true && !ci;
}

const PROGRESS_PREFIX_COLORS: Record<'queue' | 'agent' | 'pipeline', string> = {
  queue: '\x1b[36m',
  agent: '\x1b[35m',
  pipeline: '\x1b[32m',
};
const PROGRESS_STATUS_COLORS: Record<'[ok]' | '[fail]' | '[skip]', string> = {
  '[ok]': '\x1b[1;32m',
  '[fail]': '\x1b[1;31m',
  '[skip]': '\x1b[33m',
};
const ANSI_RESET = '\x1b[0m';

function writeProgressLine(text: string, color: boolean, event: ProgressEvent): void {
  if (!color) {
    process.stderr.write(`${text}\n`);
    return;
  }
  const domain = event.startsWith('queue.') || event.startsWith('closeout.') || event.startsWith('auto_merge.')
    ? 'queue'
    : event.startsWith('agent.')
      ? 'agent'
      : 'pipeline';
  const open = PROGRESS_PREFIX_COLORS[domain];
  const withPrefix = text.replace(/^(\[[a-z]+\])/, `${open}$1${ANSI_RESET}`);
  const colored = withPrefix.replace(/(\[(?:ok|fail|skip)\])$/, (tag) => {
    return `${PROGRESS_STATUS_COLORS[tag as keyof typeof PROGRESS_STATUS_COLORS]}${tag}${ANSI_RESET}`;
  });
  process.stderr.write(`${colored}\n`);
}

function buildLine(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  date: Date,
  err: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> & { task_id: string | null; agent_id: string | null } {
  const line: Record<string, unknown> & {
    task_id: string | null;
    agent_id: string | null;
  } = {
    ts: date.toISOString(),
    level,
    stack: 'ts',
    module,
    msg,
    pid: process.pid,
    task_id: ctx.taskId ?? null,
    agent_id: ctx.agentId ?? null,
    provider_id: ctx.providerId ?? null,
    span_id: ctx.spanId ?? null,
  };

  if (err !== undefined) {
    line.err = serializeError(err);
  }

  const cleanExtra = sanitizeExtra(extra);
  if (cleanExtra) {
    line.extra = cleanExtra;
  }

  return line;
}

function sanitizeExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) {
    return undefined;
  }

  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (RESERVED_KEYS.has(key)) {
      dropped.push(key);
      continue;
    }
    clean[key] = value;
  }

  warnDroppedKeys(dropped);
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function warnDroppedKeys(keys: string[]): void {
  const newKeys = keys.filter((key) => !warnedReservedKeys.has(key));
  if (newKeys.length === 0) {
    return;
  }

  for (const key of newKeys) {
    warnedReservedKeys.add(key);
  }
  process.stderr.write(`[logger] dropped reserved extra key(s): ${newKeys.join(',')}\n`);
}

function writeLine(
  raw: string,
  date: Date,
  level: LogLevel,
  taskId: string | null,
  agentId: string | null,
  config: LogConfig,
): void {
  const writeLevel: WriteLevel = level === 'debug' ? 'info' : level;
  const basePath = logFileInDir(config.dir, writeLevel, date);
  appendSafely(resolveRotatedPath(basePath, config.maxBytes), raw);

  if (taskId && agentId) {
    appendSafely(taskAgentLogFileInDir(config.dir, taskId, agentId), raw);
  }
}

function logFileInDir(dir: string, level: WriteLevel, date: Date): string {
  const dateStamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  return path.join(dir, level, `backend-ts-${dateStamp}.jsonl`);
}

function taskAgentLogFileInDir(
  dir: string,
  taskId: string,
  agentId: string,
): string {
  return path.join(dir, 'agent', taskId, `${agentId}.jsonl`);
}

function resolveRotatedPath(basePath: string, maxBytes: number): string {
  const cached = rotationCache.get(basePath);
  if (cached && !isOverLimit(cached, maxBytes)) {
    return cached;
  }

  if (!isOverLimit(basePath, maxBytes)) {
    rotationCache.set(basePath, basePath);
    return basePath;
  }

  for (let suffix = 1; ; suffix += 1) {
    const candidate = logFileWithSuffix(basePath, suffix);
    if (!existsSync(candidate) || !isOverLimit(candidate, maxBytes)) {
      rotationCache.set(basePath, candidate);
      return candidate;
    }
  }
}

function isOverLimit(filePath: string, maxBytes: number): boolean {
  try {
    return statSync(filePath).size > maxBytes;
  } catch {
    return false;
  }
}

function appendSafely(filePath: string, raw: string): void {
  try {
    ensureParent(filePath);
    appendFileSync(filePath, raw, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[logger] write-failed path=${filePath}: ${message}\n`);
  }
}

function ensureParent(filePath: string): void {
  const dir = path.dirname(filePath);
  if (retainedDirs.has(dir)) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  retainedDirs.add(dir);
}

function pruneRetention(config: LogConfig): void {
  if (retentionPruned) {
    return;
  }
  retentionPruned = true;

  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  pruneDir(config.dir, cutoff);
}

function pruneDir(dir: string, cutoff: number): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pruneDir(fullPath, cutoff);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          rmSync(fullPath, { force: true });
        }
      }
    }
  } catch {
    return;
  }
}

function isPlainExtra(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Error);
}
