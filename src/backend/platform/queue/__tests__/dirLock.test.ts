import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { acquireDirLock, acquireDirLockOrThrow, withDirLock } from '../dirLock.js';

describe('acquireDirLockOrThrow and withDirLock opts forwarding', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dir-lock-opts-'));
    lockDir = path.join(tmpDir, 'queue.lock');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquireDirLockOrThrow with maxRetries=1 and a pre-held lock throws after one attempt', async () => {
    // Hold the lock with a real acquire.
    const release = await acquireDirLock(lockDir, 1, 0);
    expect(release).toBeTypeOf('function');

    // Second acquire with maxRetries=1 must throw, not succeed.
    await expect(
      acquireDirLockOrThrow(lockDir, 'TestOpts', { maxRetries: 1, backoffMs: 0 }),
    ).rejects.toThrow(/TestOpts blocked/);

    await release!();
  });

  it('withDirLock with maxRetries=1 and a pre-held lock throws after one attempt', async () => {
    const release = await acquireDirLock(lockDir, 1, 0);
    expect(release).toBeTypeOf('function');

    await expect(
      withDirLock(lockDir, 'TestOptsWithDirLock', async () => {}, { maxRetries: 1, backoffMs: 0 }),
    ).rejects.toThrow(/TestOptsWithDirLock blocked/);

    await release!();
  });

  it('acquireDirLockOrThrow with omitted opts succeeds on a free lock (default behavior unchanged)', async () => {
    const release = await acquireDirLockOrThrow(lockDir, 'TestDefault');
    expect(release).toBeTypeOf('function');
    await release();
  });

  it('withDirLock with omitted opts executes fn and releases lock (default behavior unchanged)', async () => {
    let ran = false;
    await withDirLock(lockDir, 'TestDefaultWithDirLock', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    // Lock dir should be removed after withDirLock resolves.
    expect(existsSync(lockDir)).toBe(false);
  });
});

describe('acquireDirLock', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dir-lock-'));
    lockDir = path.join(tmpDir, 'queue.lock');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reclaims a stale missing-owner lock older than the TTL', async () => {
    mkdirSync(lockDir);
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockDir, oldTimestamp, oldTimestamp);

    const release = await acquireDirLock(lockDir, 2, 0);

    expect(release).toBeTypeOf('function');
    await release?.();
  });

  it('reclaims a stale lock left with only owner.json.tmp', async () => {
    mkdirSync(lockDir);
    writeFileSync(path.join(lockDir, 'owner.json.tmp'), `${JSON.stringify({ pid: process.pid })}\n`, 'utf-8');
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockDir, oldTimestamp, oldTimestamp);

    const release = await acquireDirLock(lockDir, 2, 0);

    expect(release).toBeTypeOf('function');
    expect(existsSync(path.join(lockDir, 'owner.json.tmp'))).toBe(false);
    await release?.();
  });

  it('returns null for a missing-owner lock within the TTL', async () => {
    mkdirSync(lockDir);
    const recentTimestamp = new Date(Date.now() - 60 * 1000);
    utimesSync(lockDir, recentTimestamp, recentTimestamp);

    const release = await acquireDirLock(lockDir, 1, 0);

    expect(release).toBeNull();
  });

  it('writes owner.json atomically without leaving owner.json.tmp', async () => {
    const release = await acquireDirLock(lockDir, 1, 0);

    expect(release).toBeTypeOf('function');
    expect(existsSync(path.join(lockDir, 'owner.json'))).toBe(true);
    expect(existsSync(path.join(lockDir, 'owner.json.tmp'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8'))).toEqual({
      pid: process.pid,
    });

    await release?.();
  });
});
