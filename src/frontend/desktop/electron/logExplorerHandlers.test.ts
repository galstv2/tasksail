// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogExplorerHandlers } from './logExplorerHandlers';
import type {
  LogExplorerReadFilePayload,
  LogExplorerReadFileResponse,
} from '../src/shared/desktopContract';

let tmpDir: string;
let logRoot: string;

function writeLog(category: 'info' | 'warn' | 'error', fileName: string, lines: string[]): string {
  const filePath = path.join(logRoot, category, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

function setMtime(filePath: string, mtimeMs: number): void {
  const date = new Date(mtimeMs);
  fs.utimesSync(filePath, date, date);
}

function fakeRegularStats(overrides: Partial<fs.Stats> = {}): fs.Stats {
  return {
    dev: 0,
    ino: 0,
    size: 64,
    mtimeMs: 1_000,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    ...overrides,
  } as fs.Stats;
}

function readPayload(
  payload: Partial<LogExplorerReadFilePayload> = {},
): LogExplorerReadFilePayload {
  return {
    category: 'info',
    fileName: 'app.jsonl',
    ...payload,
  };
}

async function readOk(payload: Partial<LogExplorerReadFilePayload> = {}): Promise<LogExplorerReadFileResponse> {
  const result = await createLogExplorerHandlers({ logRoot }).readFile(readPayload(payload));
  expect(result.ok).toBe(true);
  if (!result.ok || result.response.action !== 'logExplorer.readFile') {
    throw new Error('expected successful logExplorer.readFile response');
  }
  return result.response;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-explorer-handler-'));
  logRoot = path.join(tmpDir, 'logs');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('logExplorerHandlers', () => {
  it('lists only direct regular info/warn/error jsonl files sorted by mtime then filename', async () => {
    const newerA = writeLog('info', 'a.jsonl', ['{"level":"info"}']);
    const newerB = writeLog('info', 'b.jsonl', ['{"level":"info"}']);
    const older = writeLog('warn', 'old.jsonl', ['{"level":"warn"}']);
    writeLog('error', 'skip.txt', ['nope']);
    fs.mkdirSync(path.join(logRoot, 'error', 'nested.jsonl'), { recursive: true });
    fs.mkdirSync(path.join(logRoot, 'agent', 'task', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, 'agent', 'task', 'agent', 'shard.jsonl'), '{}\n');
    fs.symlinkSync(newerA, path.join(logRoot, 'info', 'link.jsonl'));
    setMtime(newerA, 2_000);
    setMtime(newerB, 2_000);
    setMtime(older, 1_000);

    const result = await createLogExplorerHandlers({ logRoot }).listFiles();

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'logExplorer.listFiles') {
      expect(result.response.sourceLabel).toBe('TaskSail platform logs');
      expect(result.response.categories.info.map((entry) => entry.fileName)).toEqual(['b.jsonl', 'a.jsonl']);
      expect(result.response.categories.warn.map((entry) => entry.fileName)).toEqual(['old.jsonl']);
      expect(result.response.categories.error).toEqual([]);
      expect(JSON.stringify(result.response)).not.toContain(logRoot);
    }
  });

  it('rejects unsafe selections, symlinks, symlinked category dirs, non-files, wrong categories, and missing files', async () => {
    const target = writeLog('info', 'app.jsonl', ['{"level":"info"}']);
    fs.symlinkSync(target, path.join(logRoot, 'info', 'link.jsonl'));
    fs.mkdirSync(path.join(logRoot, 'info', 'dir.jsonl'));
    fs.rmSync(path.join(logRoot, 'warn'), { recursive: true, force: true });
    fs.symlinkSync(path.join(logRoot, 'info'), path.join(logRoot, 'warn'));
    const handlers = createLogExplorerHandlers({ logRoot });

    for (const payload of [
      readPayload({ fileName: '../app.jsonl' }),
      readPayload({ fileName: 'nested/app.jsonl' }),
      readPayload({ fileName: path.join(logRoot, 'info', 'app.jsonl') }),
      readPayload({ fileName: 'C:\\logs\\app.jsonl' }),
      readPayload({ fileName: 'link.jsonl' }),
      readPayload({ fileName: 'dir.jsonl' }),
      readPayload({ fileName: 'missing.jsonl' }),
      readPayload({ category: 'debug' as never }),
      readPayload({ category: 'warn', fileName: 'app.jsonl' }),
    ]) {
      const result = await handlers.readFile(payload);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a late file swap when opened handle identity does not match lstat', async () => {
    writeLog('info', 'app.jsonl', ['{"level":"info","msg":"original"}']);
    const swappedPath = writeLog('info', 'swapped.jsonl', ['{"level":"info","msg":"swapped"}']);
    const handlers = createLogExplorerHandlers({
      logRoot,
      fsAdapter: {
        open: async () => open(swappedPath, 'r'),
      },
    });

    const result = await handlers.readFile(readPayload());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('changed while opening');
    }
  });

  it('fails closed when stable opened-handle identity fields are unavailable', async () => {
    const selectedPath = writeLog('info', 'app.jsonl', ['{"level":"info","msg":"original"}']);
    const matchingMetadataStat = fakeRegularStats({ size: 128, mtimeMs: 2_000 });
    const handlers = createLogExplorerHandlers({
      logRoot,
      fsAdapter: {
        lstat: async (targetPath) => (
          targetPath === selectedPath
            ? matchingMetadataStat
            : fs.promises.lstat(targetPath)
        ),
        open: async () => ({
          fd: 987654,
          stat: async () => matchingMetadataStat,
          close: async () => undefined,
        } as never),
      },
    });

    const result = await handlers.readFile(readPayload());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('changed while opening');
    }
  });

  it('parses, prettifies, summarizes, and filters physical info records by parsed level', async () => {
    writeLog('info', 'app.jsonl', [
      JSON.stringify({ ts: '2026-06-03T00:00:00.000Z', level: 'debug', module: 'runner', msg: 'debug row', task_id: 'task-1', agent_id: 'agent-1', stack: 'stack' }),
      JSON.stringify({ ts: '2026-06-03T00:00:01.000Z', level: 'info', module: 'runner', msg: 'info row', task_id: null, agent_id: null }),
    ]);

    const all = await readOk({ levelFilter: 'all', limit: 10 });
    expect(all.records.map((record) => record.summary.level)).toEqual(['debug', 'info']);
    expect(all.records[0].summary).toMatchObject({
      ts: '2026-06-03T00:00:00.000Z',
      rawLevel: 'debug',
      module: 'runner',
      msg: 'debug row',
      taskId: 'task-1',
      agentId: 'agent-1',
      stack: 'stack',
    });
    expect(all.records[0].prettyJson).toBe(JSON.stringify(JSON.parse(all.records[0].raw), null, 2));

    const debug = await readOk({ levelFilter: 'debug' });
    const info = await readOk({ levelFilter: 'info' });
    expect(debug.records.map((record) => record.summary.msg)).toEqual(['debug row']);
    expect(info.records.map((record) => record.summary.msg)).toEqual(['info row']);
  });

  it('honors anomalous parsed levels in physical warning and error categories', async () => {
    writeLog('warn', 'writer.jsonl', [JSON.stringify({ level: 'warn', msg: 'normal warn' })]);
    writeLog('error', 'writer.jsonl', [JSON.stringify({ level: 'error', msg: 'normal error' })]);
    writeLog('warn', 'anomaly.jsonl', [JSON.stringify({ level: 'info', msg: 'odd info' })]);
    writeLog('error', 'anomaly.jsonl', [JSON.stringify({ level: 'debug', msg: 'odd debug' })]);

    expect((await readOk({ category: 'warn', fileName: 'writer.jsonl', levelFilter: 'info' })).records).toEqual([]);
    expect((await readOk({ category: 'error', fileName: 'writer.jsonl', levelFilter: 'debug' })).records).toEqual([]);
    expect((await readOk({ category: 'warn', fileName: 'anomaly.jsonl', levelFilter: 'info' })).records[0].summary.msg).toBe('odd info');
    expect((await readOk({ category: 'error', fileName: 'anomaly.jsonl', levelFilter: 'debug' })).records[0].summary.msg).toBe('odd debug');
  });

  it('returns bounded malformed records and counts blank physical lines without matching them', async () => {
    writeLog('info', 'app.jsonl', [
      JSON.stringify({ level: 'info', msg: 'one' }),
      '',
      '   ',
      '{"level":',
      JSON.stringify({ msg: 'missing level' }),
    ]);

    const response = await readOk({ levelFilter: 'other', limit: 10 });

    expect(response.totalLines).toBe(5);
    expect(response.totalMatchingLines).toBe(2);
    expect(response.records.map((record) => record.lineNumber)).toEqual([4, 5]);
    expect(response.records[0]).toMatchObject({
      parsed: false,
      summary: { level: 'other' },
      raw: '{"level":',
    });
    expect(response.records[0].parseError?.length).toBeGreaterThan(0);
    expect(response.records[1]).toMatchObject({ parsed: true, summary: { level: 'other' } });
  });

  it('pages matching records by physical line numbers in tail, beforeLine, and startLine modes', async () => {
    writeLog('info', 'app.jsonl', [
      JSON.stringify({ level: 'debug', msg: 'd1' }),
      JSON.stringify({ level: 'info', msg: 'i1' }),
      JSON.stringify({ level: 'debug', msg: 'd2' }),
      '',
      JSON.stringify({ level: 'debug', msg: 'd3' }),
      JSON.stringify({ level: 'info', msg: 'i2' }),
      JSON.stringify({ level: 'debug', msg: 'd4' }),
      JSON.stringify({ level: 'debug', msg: 'd5' }),
      JSON.stringify({ level: 'debug', msg: 'd6' }),
    ]);

    const tail = await readOk({ levelFilter: 'debug', limit: 2, tail: true });
    expect(tail.records.map((record) => record.summary.msg)).toEqual(['d5', 'd6']);
    expect(tail.records.map((record) => record.lineNumber)).toEqual([8, 9]);
    expect(tail.hasOlder).toBe(true);
    expect(tail.hasNewer).toBe(false);

    const older1 = await readOk({ levelFilter: 'debug', limit: 2, beforeLine: tail.startLine });
    expect(older1.records.map((record) => record.summary.msg)).toEqual(['d3', 'd4']);
    expect(older1.hasOlder).toBe(true);
    expect(older1.hasNewer).toBe(true);

    const older2 = await readOk({ levelFilter: 'debug', limit: 2, beforeLine: older1.startLine });
    expect(older2.records.map((record) => record.summary.msg)).toEqual(['d1', 'd2']);
    expect(older2.hasOlder).toBe(false);
    expect(older2.hasNewer).toBe(true);

    const newer = await readOk({ levelFilter: 'debug', limit: 2, startLine: older2.endLine + 1 });
    expect(newer.records.map((record) => record.summary.msg)).toEqual(['d3', 'd4']);
    expect(newer.hasOlder).toBe(true);
    expect(newer.hasNewer).toBe(true);
  });

  it('truncates huge records and stops collection when the response text budget is exhausted', async () => {
    const huge = 'x'.repeat(150 * 1024);
    writeLog('info', 'app.jsonl', [
      JSON.stringify({ level: 'info', msg: huge }),
      JSON.stringify({ level: 'info', msg: 'small-1' }),
      JSON.stringify({ level: 'info', msg: 'small-2' }),
    ]);

    const hugeResponse = await readOk({ startLine: 1, limit: 1 });
    expect(hugeResponse.records[0].truncated).toBe(true);
    expect(hugeResponse.records[0].raw.length).toBeLessThan(150 * 1024);

    const budgeted = await createLogExplorerHandlers({ logRoot, responseTextBudgetBytes: 250 }).readFile(readPayload({ startLine: 1, limit: 3 }));
    expect(budgeted.ok).toBe(true);
    if (budgeted.ok && budgeted.response.action === 'logExplorer.readFile') {
      expect(budgeted.response.records.length).toBeLessThan(3);
      expect(budgeted.response.truncatedResponse).toBe(true);
      expect(budgeted.response.totalMatchingLines).toBe(3);
    }
  });

  it('keeps pager state truthful when tail response budgeting omits older records', async () => {
    writeLog('info', 'app.jsonl', [
      JSON.stringify({ level: 'info', msg: 'one' }),
      JSON.stringify({ level: 'info', msg: 'two' }),
      JSON.stringify({ level: 'info', msg: 'three' }),
    ]);

    const result = await createLogExplorerHandlers({ logRoot, responseTextBudgetBytes: 90 }).readFile(
      readPayload({ tail: true, limit: 3 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'logExplorer.readFile') {
      expect(result.response.truncatedResponse).toBe(true);
      expect(result.response.hasOlder).toBe(true);
      expect(result.response.hasNewer).toBe(false);
      expect(result.response.records.at(-1)?.summary.msg).toBe('three');
    }
  });

  it('keeps failure logs bounded and omits roots, contents, stacks, and secret-shaped text', async () => {
    const filePath = writeLog('info', 'app.jsonl', ['raw-file-content SECRET_TOKEN=abc123']);
    const windowsPath = 'C:\\Users\\operator\\TaskSail\\logs\\info\\app.jsonl';
    const events: unknown[] = [];
    const handlers = createLogExplorerHandlers({
      logRoot,
      logger: (event) => events.push(event),
      fsAdapter: {
        open: async () => {
          throw new Error(`cannot open ${filePath} or ${windowsPath}\nSTACK\nSECRET_TOKEN=abc123\nraw-file-content`);
        },
      },
    });

    const result = await handlers.readFile(readPayload());

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(logRoot);
    expect(JSON.stringify(result)).not.toContain('raw-file-content');
    expect(events).toHaveLength(1);
    const serializedEvent = JSON.stringify(events[0]);
    expect(serializedEvent).toContain('"fileName":"app.jsonl"');
    expect(serializedEvent).not.toContain(logRoot);
    expect(serializedEvent).not.toContain('C:\\');
    expect(serializedEvent).not.toContain('raw-file-content');
    expect(serializedEvent).not.toContain('SECRET_TOKEN');
    expect(serializedEvent).not.toContain('STACK');
  });
});
