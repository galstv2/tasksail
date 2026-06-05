import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeTextFileAtomicSync } from '../io.js';

// Behavioral coverage for the synchronous crash-atomic writer (the companion
// added so sync callers — e.g. queue/taskJson.ts — need not become async). It
// is crash-atomic (temp + rename), not fsync-durable. We assert the observable
// contract: complete content, parent-dir creation, clean replace, and no
// temp-file residue.
describe('writeTextFileAtomicSync', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'atomic-sync-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes content and creates parent directories', () => {
    const target = path.join(dir, 'nested', 'deep', 'a.json');
    writeTextFileAtomicSync(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
  });

  it('replaces existing content atomically and leaves no temp residue', () => {
    const target = path.join(dir, 'b.txt');
    writeTextFileAtomicSync(target, 'first');
    writeTextFileAtomicSync(target, 'second');
    expect(readFileSync(target, 'utf-8')).toBe('second');
    expect(readdirSync(dir).filter((e) => e.includes('.tmp-'))).toEqual([]);
  });
});
