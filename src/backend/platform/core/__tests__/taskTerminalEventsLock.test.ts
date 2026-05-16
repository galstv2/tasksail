import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  taskTerminalEventsLockPath,
  withTaskTerminalEventsLock,
} from '../taskTerminalEventsLock.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'task-terminal-lock-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('withTaskTerminalEventsLock', () => {
  it('uses the task-local terminal-events.lock path and releases it', async () => {
    let lockExistedInside = false;

    await withTaskTerminalEventsLock(repoRoot, 'task-1', async () => {
      lockExistedInside = existsSync(taskTerminalEventsLockPath(repoRoot, 'task-1'));
    });

    expect(lockExistedInside).toBe(true);
    expect(existsSync(taskTerminalEventsLockPath(repoRoot, 'task-1'))).toBe(false);
  });

  it('serializes concurrent sections for the same task', async () => {
    let active = 0;
    let maxActive = 0;

    await Promise.all(Array.from({ length: 10 }, () => (
      withTaskTerminalEventsLock(repoRoot, 'task-1', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      })
    )));

    expect(maxActive).toBe(1);
  });
});
