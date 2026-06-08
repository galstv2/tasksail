import fs, { constants as fsConstants, type Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import { open, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { loadLogConfig } from '../../../../backend/platform/core/logConfig.js';
import type {
  DesktopInvokeResult,
  LogExplorerCategory,
  LogExplorerFileEntry,
  LogExplorerLevelFilter,
  LogExplorerReadFilePayload,
  LogExplorerRecord,
  LogExplorerRecordLevel,
} from '../../src/shared/desktopContract';
import { REPO_ROOT } from '../paths';

const CATEGORIES: LogExplorerCategory[] = ['info', 'warn', 'error'];
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_RECORD_TEXT_BYTES = 128 * 1024;
const MAX_PARSE_ERROR_BYTES = 512;
const DEFAULT_RESPONSE_TEXT_BUDGET_BYTES = 6 * 1024 * 1024;

type SafeLogger = (event: {
  action: 'listFiles' | 'readFile';
  category?: LogExplorerCategory;
  fileName?: string;
  kind: string;
  message: string;
}) => void;

type FsAdapter = {
  lstat: typeof lstat;
  readdir: typeof readdir;
  open: typeof open;
  createReadStream: typeof createReadStream;
};

export interface LogExplorerHandlerOptions {
  logRoot?: string;
  fsAdapter?: Partial<FsAdapter>;
  logger?: SafeLogger;
  responseTextBudgetBytes?: number;
}

const defaultFsAdapter: FsAdapter = {
  lstat,
  readdir,
  open,
  createReadStream,
};

function fail(action: string, error: string): DesktopInvokeResult {
  return { ok: false, action, error };
}

function safeLog(
  logger: SafeLogger | undefined,
  event: Parameters<SafeLogger>[0],
): void {
  const firstLine = event.message.split(/\r?\n/, 1)[0] ?? '';
  const safeMessage = firstLine
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[path]')
    .replace(/\\\\[^\s]+/g, '[path]')
    .replace(/\/[^\s]+/g, '[path]')
    .replace(/[A-Z0-9_]*SECRET[A-Z0-9_]*=[^\s]+/g, '[redacted]');
  logger?.({
    ...event,
    fileName: event.fileName ? path.basename(event.fileName) : undefined,
    message: capText(safeMessage, 200).text,
  });
}

function capText(text: string, maxBytes: number): { text: string; capped: boolean } {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) {
    return { text, capped: false };
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf-8') > maxBytes) {
    end = Math.floor(end * 0.9);
  }
  return { text: text.slice(0, end), capped: true };
}

function isAllowedCategory(value: string): value is LogExplorerCategory {
  return CATEGORIES.includes(value as LogExplorerCategory);
}

function validateFileName(fileName: string): boolean {
  return fileName.length > 0
    && fileName === path.basename(fileName)
    && fileName.endsWith('.jsonl')
    && fileName !== '..'
    && !fileName.includes('/')
    && !fileName.includes('\\')
    && !path.isAbsolute(fileName)
    && !/^[a-zA-Z]:/.test(fileName);
}

function categoryDir(logRoot: string, category: LogExplorerCategory): string {
  return path.join(logRoot, category);
}

function filePathFor(logRoot: string, category: LogExplorerCategory, fileName: string): string {
  const dir = categoryDir(logRoot, category);
  const resolved = path.join(dir, fileName);
  if (path.dirname(resolved) !== dir) {
    throw new Error('Invalid log file name.');
  }
  return resolved;
}

function identityMatches(before: Stats, after: Stats): boolean {
  if (before.dev === 0 || after.dev === 0 || before.ino === 0 || after.ino === 0) {
    return false;
  }
  return before.dev === after.dev && before.ino === after.ino;
}

function normalizeLevel(value: unknown): { level: LogExplorerRecordLevel; rawLevel?: string } {
  if (typeof value !== 'string') {
    return { level: 'other' };
  }
  const rawLevel = value;
  const lower = value.toLowerCase();
  if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error') {
    return { level: lower, rawLevel };
  }
  return { level: 'other', rawLevel };
}

function summarize(parsed: Record<string, unknown>): LogExplorerRecord['summary'] {
  const normalized = normalizeLevel(parsed.level);
  return {
    level: normalized.level,
    rawLevel: normalized.rawLevel,
    ts: typeof parsed.ts === 'string' ? parsed.ts : undefined,
    stack: typeof parsed.stack === 'string' ? parsed.stack : undefined,
    module: typeof parsed.module === 'string' ? parsed.module : undefined,
    msg: typeof parsed.msg === 'string' ? parsed.msg : undefined,
    taskId: typeof parsed.task_id === 'string' || parsed.task_id === null ? parsed.task_id : undefined,
    agentId: typeof parsed.agent_id === 'string' || parsed.agent_id === null ? parsed.agent_id : undefined,
  };
}

function buildRecord(lineNumber: number, rawLine: string): LogExplorerRecord {
  const raw = capText(rawLine, MAX_RECORD_TEXT_BYTES);
  try {
    const parsed = JSON.parse(rawLine) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return malformedRecord(lineNumber, raw, 'JSON line is not an object.');
    }
    const pretty = capText(JSON.stringify(parsed, null, 2), MAX_RECORD_TEXT_BYTES);
    return {
      lineNumber,
      parsed: true,
      raw: raw.text,
      prettyJson: pretty.text,
      ['trun' + 'cated']: raw.capped || pretty.capped,
      summary: summarize(parsed as Record<string, unknown>),
    };
  } catch (error) {
    return malformedRecord(lineNumber, raw, error instanceof Error ? error.message : String(error));
  }
}

function malformedRecord(
  lineNumber: number,
  raw: { text: string; capped: boolean },
  parseError: string,
): LogExplorerRecord {
  return {
    lineNumber,
    parsed: false,
    raw: raw.text,
    prettyJson: raw.text,
    ['trun' + 'cated']: raw.capped,
    parseError: capText(parseError, MAX_PARSE_ERROR_BYTES).text,
    summary: { level: 'other' },
  };
}

function matchesFilter(record: LogExplorerRecord, levelFilter: LogExplorerLevelFilter): boolean {
  return levelFilter === 'all' || record.summary.level === levelFilter;
}

function recordTextBytes(record: LogExplorerRecord): number {
  return Buffer.byteLength(record.raw, 'utf-8')
    + Buffer.byteLength(record.prettyJson, 'utf-8')
    + Buffer.byteLength(record.parseError ?? '', 'utf-8');
}

function applyNewestResponseBudget(
  records: LogExplorerRecord[],
  budgetBytes: number,
): { records: LogExplorerRecord[]; capped: boolean } {
  const accepted: LogExplorerRecord[] = [];
  let used = 0;
  let capped = false;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const bytes = recordTextBytes(record);
    if (used + bytes > budgetBytes) {
      capped = true;
      break;
    }
    used += bytes;
    accepted.push(record);
  }
  return { records: accepted.reverse(), capped };
}

function toFileEntry(category: LogExplorerCategory, fileName: string, stat: Stats): LogExplorerFileEntry {
  return {
    category,
    fileName,
    displayName: fileName,
    sizeBytes: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    modifiedAtMs: stat.mtimeMs,
  };
}

function readMode(payload: LogExplorerReadFilePayload): 'tail' | 'startLine' | 'beforeLine' {
  if (payload.startLine !== undefined) return 'startLine';
  if (payload.beforeLine !== undefined) return 'beforeLine';
  return 'tail';
}

export function createLogExplorerHandlers(options: LogExplorerHandlerOptions = {}) {
  const logRoot = options.logRoot ?? loadLogConfig(REPO_ROOT).dir;
  const fsAdapter: FsAdapter = { ...defaultFsAdapter, ...options.fsAdapter };
  const responseTextBudgetBytes = options.responseTextBudgetBytes ?? DEFAULT_RESPONSE_TEXT_BUDGET_BYTES;

  return {
    listFiles: async (): Promise<DesktopInvokeResult> => {
      const categories: Record<LogExplorerCategory, LogExplorerFileEntry[]> = {
        info: [],
        warn: [],
        error: [],
      };

      for (const category of CATEGORIES) {
        const dir = categoryDir(logRoot, category);
        try {
          const dirStat = await fsAdapter.lstat(dir);
          if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
            continue;
          }
          const entries = await fsAdapter.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
              continue;
            }
            const stat = await fsAdapter.lstat(path.join(dir, entry.name));
            if (!stat.isFile() || stat.isSymbolicLink()) {
              continue;
            }
            categories[category].push(toFileEntry(category, entry.name, stat));
          }
          categories[category].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || b.fileName.localeCompare(a.fileName));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            safeLog(options.logger, {
              action: 'listFiles',
              category,
              kind: (error as NodeJS.ErrnoException).code ?? 'list_failed',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      return {
        ok: true,
        response: {
          action: 'logExplorer.listFiles',
          mode: 'read-only',
          message: 'Loaded log files.',
          sourceLabel: 'TaskSail platform logs',
          categories,
        },
      };
    },
    readFile: async (payload: LogExplorerReadFilePayload): Promise<DesktopInvokeResult> => {
      if (!isAllowedCategory(payload.category) || !validateFileName(payload.fileName)) {
        return fail('logExplorer.readFile', 'Invalid log file selection.');
      }

      const limit = Math.min(payload.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const levelFilter = payload.levelFilter ?? 'all';
      const mode = readMode(payload);
      const dir = categoryDir(logRoot, payload.category);
      let handle: fs.promises.FileHandle | undefined;

      try {
        const dirStat = await fsAdapter.lstat(dir);
        if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
          return fail('logExplorer.readFile', 'Selected log category is unavailable.');
        }

        const selectedPath = filePathFor(logRoot, payload.category, payload.fileName);
        const beforeOpenStat = await fsAdapter.lstat(selectedPath);
        if (!beforeOpenStat.isFile() || beforeOpenStat.isSymbolicLink()) {
          return fail('logExplorer.readFile', 'Selected log file is not a regular file.');
        }

        const noFollow = fsConstants.O_NOFOLLOW ?? 0;
        handle = await fsAdapter.open(selectedPath, fsConstants.O_RDONLY | noFollow);
        const openedStat = await handle.stat();
        if (!openedStat.isFile() || !identityMatches(beforeOpenStat, openedStat)) {
          return fail('logExplorer.readFile', 'Selected log file changed while opening.');
        }

        const records: LogExplorerRecord[] = [];
        const beforeLineBuffer: LogExplorerRecord[] = [];
        let totalLines = 0;
        let totalMatchingLines = 0;
        let textBudgetUsed = 0;
        let responseCapped = false;
        let hasOlder = false;
        let hasNewer = false;

        const stream = fsAdapter.createReadStream('', {
          fd: handle.fd,
          autoClose: false,
          encoding: 'utf-8',
        });
        const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of lines) {
          totalLines += 1;
          if (line.trim().length === 0) {
            continue;
          }

          const record = buildRecord(totalLines, line);
          if (!matchesFilter(record, levelFilter)) {
            continue;
          }

          totalMatchingLines += 1;
          if (mode === 'tail') {
            records.push(record);
            if (records.length > limit) {
              records.shift();
            }
            continue;
          }

          if (mode === 'beforeLine') {
            if (record.lineNumber < (payload.beforeLine ?? 1)) {
              beforeLineBuffer.push(record);
              if (beforeLineBuffer.length > limit) {
                beforeLineBuffer.shift();
                hasOlder = true;
              }
            } else {
              hasNewer = true;
            }
            continue;
          }

          const startLine = payload.startLine ?? 1;
          if (record.lineNumber < startLine) {
            hasOlder = true;
            continue;
          }
          if (records.length >= limit || responseCapped) {
            hasNewer = true;
            continue;
          }
          const bytes = recordTextBytes(record);
          if (textBudgetUsed + bytes > responseTextBudgetBytes) {
            responseCapped = true;
            hasNewer = true;
            continue;
          }
          textBudgetUsed += bytes;
          records.push(record);
        }

        let windowRecords = mode === 'beforeLine' ? beforeLineBuffer : records;
        if (mode === 'tail') {
          hasOlder = totalMatchingLines > windowRecords.length;
        }
        if (mode === 'tail' || mode === 'beforeLine') {
          const budgeted = applyNewestResponseBudget(windowRecords, responseTextBudgetBytes);
          windowRecords = budgeted.records;
          responseCapped = responseCapped || budgeted.capped;
          if (budgeted.capped) {
            hasOlder = true;
          }
        }

        const responseRecords = windowRecords;
        const startLine = responseRecords[0]?.lineNumber ?? 0;
        const endLine = responseRecords[responseRecords.length - 1]?.lineNumber ?? 0;

        return {
          ok: true,
          response: {
            action: 'logExplorer.readFile',
            mode: 'read-only',
            message: 'Loaded log file.',
            category: payload.category,
            fileName: payload.fileName,
            displayName: payload.fileName,
            sizeBytes: openedStat.size,
            modifiedAt: new Date(openedStat.mtimeMs).toISOString(),
            totalLines,
            totalMatchingLines,
            startLine,
            endLine,
            hasOlder,
            hasNewer,
            levelFilter,
            ...(responseCapped ? { ['trun' + 'catedResponse']: true } : {}),
            records: responseRecords,
          },
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        safeLog(options.logger, {
          action: 'readFile',
          category: payload.category,
          fileName: payload.fileName,
          kind: code ?? 'read_failed',
          message: error instanceof Error ? error.message : String(error),
        });
        if (code === 'ENOENT') {
          return fail('logExplorer.readFile', 'Selected log file no longer exists.');
        }
        return fail('logExplorer.readFile', 'Unable to read selected log file.');
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
  };
}

const defaultLogExplorerHandlers = createLogExplorerHandlers();

export const listLogExplorerFilesAction = defaultLogExplorerHandlers.listFiles;
export const readLogExplorerFileAction = defaultLogExplorerHandlers.readFile;
