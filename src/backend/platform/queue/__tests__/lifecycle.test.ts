import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearRuntimeReceipts } from '../lifecycle.js';

describe('clearRuntimeReceipts', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-lifecycle-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('clears only the target task receipts, leaving other tasks untouched', async () => {
    // Seed Task A's guardrails receipt
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const taskAGuardrailsDir = path.join(taskARuntimeDir, 'guardrails');
    mkdirSync(taskAGuardrailsDir, { recursive: true });
    const taskAFile = path.join(taskAGuardrailsDir, 'foo.json');
    writeFileSync(taskAFile, JSON.stringify({ ok: true }), 'utf-8');

    // Seed Task B's guardrails receipt
    const taskBRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-B');
    const taskBGuardrailsDir = path.join(taskBRuntimeDir, 'guardrails');
    mkdirSync(taskBGuardrailsDir, { recursive: true });
    const taskBFile = path.join(taskBGuardrailsDir, 'bar.json');
    writeFileSync(taskBFile, JSON.stringify({ ok: true }), 'utf-8');

    // Clear only Task A's receipts
    await clearRuntimeReceipts(repoRoot, 'task-A');

    // Task A's guardrails file should be gone
    expect(existsSync(taskAFile)).toBe(false);

    // Task B's guardrails file must remain intact
    expect(existsSync(taskBFile)).toBe(true);

    // Task A's last-reset-ts marker must exist
    const markerPath = path.join(taskARuntimeDir, 'last-reset-ts');
    expect(existsSync(markerPath)).toBe(true);
  });

  it('also clears role-sessions for the target task', async () => {
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const roleSessionsDir = path.join(taskARuntimeDir, 'role-sessions');
    mkdirSync(roleSessionsDir, { recursive: true });
    const sessionFile = path.join(roleSessionsDir, 'dalton.json');
    writeFileSync(sessionFile, JSON.stringify({ role: 'dalton' }), 'utf-8');

    await clearRuntimeReceipts(repoRoot, 'task-A');

    expect(existsSync(sessionFile)).toBe(false);
    expect(existsSync(path.join(taskARuntimeDir, 'last-reset-ts'))).toBe(true);
  });

  it('writes a numeric timestamp string to last-reset-ts', async () => {
    const taskARuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');

    const before = Math.floor(Date.now() / 1000);
    await clearRuntimeReceipts(repoRoot, 'task-A');
    const after = Math.floor(Date.now() / 1000);

    const { readFileSync } = await import('node:fs');
    const markerContent = readFileSync(path.join(taskARuntimeDir, 'last-reset-ts'), 'utf-8').trim();
    const ts = parseInt(markerContent, 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('succeeds when task runtime directory does not yet exist', async () => {
    // No directories seeded — clearRuntimeReceipts must not throw
    await expect(clearRuntimeReceipts(repoRoot, 'task-new')).resolves.toBeUndefined();

    const markerPath = path.join(
      repoRoot, '.platform-state', 'runtime', 'tasks', 'task-new', 'last-reset-ts',
    );
    expect(existsSync(markerPath)).toBe(true);
  });
});
