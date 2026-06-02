import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { withFileLock } from '../fileLock.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withFileLock', () => {
  it('serializes critical sections for the same key without interleaving', async () => {
    const events: string[] = [];
    const key = path.join('/tmp', 'fl-serialize');
    const section = (id: string) =>
      withFileLock(key, async () => {
        events.push(`start-${id}`);
        await tick(10);
        events.push(`end-${id}`);
      });

    await Promise.all([section('1'), section('2'), section('3')]);

    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it('runs different keys concurrently', async () => {
    const order: string[] = [];
    const slow = withFileLock(path.join('/tmp', 'fl-a'), async () => {
      await tick(30);
      order.push('a');
    });
    const fast = withFileLock(path.join('/tmp', 'fl-b'), async () => {
      order.push('b');
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(['b', 'a']);
  });

  it('treats equivalent path spellings as the same lock key', async () => {
    const events: string[] = [];
    const a = withFileLock('/tmp/fl-eq/x', async () => {
      events.push('a-start');
      await tick(10);
      events.push('a-end');
    });
    const b = withFileLock('/tmp/fl-eq/./x', async () => {
      events.push('b-start');
    });
    await Promise.all([a, b]);
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('returns the critical-section result and does not deadlock after a failure', async () => {
    const key = path.join('/tmp', 'fl-err');
    await expect(
      withFileLock(key, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(withFileLock(key, async () => 'recovered')).resolves.toBe('recovered');
  });

  it('preserves FIFO acquisition order', async () => {
    const key = path.join('/tmp', 'fl-fifo');
    const seen: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        withFileLock(key, async () => {
          seen.push(n);
          await tick(1);
        }),
      ),
    );
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
