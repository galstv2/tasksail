import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeTextFileAtomic } from '../io.js';

describe('writeTextFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes content and creates parent directories', async () => {
    const target = path.join(dir, 'nested', 'deep', 'a.json');
    await writeTextFileAtomic(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
  });

  it('rapid same-process writes to different files never cross-collide', async () => {
    const targets = Array.from({ length: 50 }, (_, i) => path.join(dir, `f${i}.txt`));
    await Promise.all(targets.map((t, i) => writeTextFileAtomic(t, `content-${i}`)));
    targets.forEach((t, i) => expect(readFileSync(t, 'utf-8')).toBe(`content-${i}`));
  });

  it('concurrent writes to the same file stay atomic and leave no temp files', async () => {
    // With a pid+millisecond temp name these rapid writers could collide on the
    // same temp path and tear the destination; the random suffix + `wx` flag
    // give each writer a private temp, so the destination is always one
    // writer's complete content.
    const target = path.join(dir, 'same.txt');
    const contents = Array.from({ length: 25 }, (_, i) => `payload-${i}-${'x'.repeat(2048)}`);
    await Promise.all(contents.map((c) => writeTextFileAtomic(target, c)));

    const final = readFileSync(target, 'utf-8');
    expect(contents).toContain(final);

    const leftovers = readdirSync(dir).filter((entry) => entry.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
