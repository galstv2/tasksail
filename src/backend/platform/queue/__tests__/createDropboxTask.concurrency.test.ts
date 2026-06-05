/**
 * Deterministic concurrency tests for createDropboxTask.
 *
 * These tests verify that:
 * 1. Sequential same-title calls produce distinct filenames (suffix-collision logic).
 * 2. EEXIST on exclusive-create triggers a rescan and produces a new name rather
 *    than overwriting, and the first file's contents remain intact.
 * 3. A mocked EEXIST on the first attempt retries successfully with a distinct name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDropboxTask } from '../createDropboxTask.js';
import * as io from '../../core/io.js';

function makeRepo(): string {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-concurrent-'));
  mkdirSync(path.join(tmpRoot, '.git'));
  mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
  mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
  mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks'), { recursive: true });
  return tmpRoot;
}

describe('createDropboxTask concurrency', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeRepo();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T09:02:46.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('sequential same-title calls produce distinct filenames (second gets -2 suffix)', async () => {
    const first = await createDropboxTask({ title: 'Same Title', repoRoot: tmpRoot });
    const second = await createDropboxTask({ title: 'Same Title', repoRoot: tmpRoot });

    const firstName = path.basename(first);
    const secondName = path.basename(second);

    expect(firstName).not.toBe(secondName);
    expect(secondName).toBe(firstName.replace(/\.md$/, '-2.md'));

    // Both files must exist with distinct content
    const firstContent = readFileSync(first, 'utf-8');
    const secondContent = readFileSync(second, 'utf-8');
    expect(firstContent).toMatch(/^# Same Title$/m);
    expect(secondContent).toMatch(/^# Same Title$/m);
    expect(first).not.toBe(second);
  });

  it('EEXIST retry: when the exclusive create hits EEXIST the first file contents stay intact', async () => {
    // Create the first file normally.
    const first = await createDropboxTask({ title: 'Conflict Task', repoRoot: tmpRoot });
    const firstContent = readFileSync(first, 'utf-8');

    // Now create a second — at this point the dropbox already has the first file,
    // so buildReadableTaskFileName will pick a -2 suffix. But to simulate a
    // stale-scan race we spy on writeTextFileExclusive and throw EEXIST on the
    // very first call attempt, forcing the retry path.
    let callCount = 0;
    const original = io.writeTextFileExclusive.bind(io);
    vi.spyOn(io, 'writeTextFileExclusive').mockImplementation(async (filePath, content) => {
      callCount += 1;
      if (callCount === 1) {
        const err = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        throw err;
      }
      return original(filePath, content);
    });

    const second = await createDropboxTask({ title: 'Conflict Task', repoRoot: tmpRoot });

    // First file unchanged
    expect(readFileSync(first, 'utf-8')).toBe(firstContent);

    // Second call produced a distinct file
    expect(second).not.toBe(first);
    expect(path.basename(second)).not.toBe(path.basename(first));

    // The retry was triggered (two calls to writeTextFileExclusive)
    expect(callCount).toBe(2);
  });

  it('EEXIST is never silently swallowed: after exhausting retries an actionable error is thrown', async () => {
    // Force every exclusive-create attempt to throw EEXIST.
    vi.spyOn(io, 'writeTextFileExclusive').mockRejectedValue(
      Object.assign(new Error('EEXIST'), { code: 'EEXIST' }),
    );

    await expect(
      createDropboxTask({ title: 'Always Fails', repoRoot: tmpRoot }),
    ).rejects.toThrow('could not create a unique dropbox file');
  });
});
