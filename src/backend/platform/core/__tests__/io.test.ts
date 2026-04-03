import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureDir,
  readTextFile,
  writeTextFile,
  moveFile,
  createTempDir,
  safeJsonParse,
} from '../io.js';

describe('ensureDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'io-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates nested directories', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    await ensureDir(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('does not error on existing directory', async () => {
    await ensureDir(tmpDir);
    expect(existsSync(tmpDir)).toBe(true);
  });
});

describe('readTextFile / writeTextFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'io-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips file content', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeTextFile(filePath, 'hello world');
    const content = await readTextFile(filePath);
    expect(content).toBe('hello world');
  });

  it('returns undefined for missing file', async () => {
    const content = await readTextFile(path.join(tmpDir, 'missing.txt'));
    expect(content).toBeUndefined();
  });

  it('creates parent directories when writing', async () => {
    const filePath = path.join(tmpDir, 'nested', 'dir', 'file.txt');
    await writeTextFile(filePath, 'content');
    expect(readFileSync(filePath, 'utf-8')).toBe('content');
  });
});

describe('moveFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'io-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves a file to a new location', async () => {
    const src = path.join(tmpDir, 'source.txt');
    const dest = path.join(tmpDir, 'subdir', 'dest.txt');
    await writeTextFile(src, 'content');
    await moveFile(src, dest);
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(dest, 'utf-8')).toBe('content');
  });
});

describe('createTempDir', () => {
  it('creates a temp directory with prefix', () => {
    const dir = createTempDir('test-');
    expect(existsSync(dir)).toBe(true);
    expect(path.basename(dir)).toMatch(/^test-/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse<{ a: number }>('{"a":1}', 'test');
    expect(result).toEqual({ a: 1 });
  });

  it('throws with context on invalid JSON', () => {
    expect(() => safeJsonParse('not json', 'test-context')).toThrow(
      /Invalid JSON in test-context/,
    );
  });
});
