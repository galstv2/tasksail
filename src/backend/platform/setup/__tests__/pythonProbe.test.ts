import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

const { assertPythonOnPath } = await import('../setup.js');

describe('direct runtime python probe', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('passes when python3 exits 0', async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValue(child);
    const promise = assertPythonOnPath();
    child.emit('exit', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('exits with an actionable message when python3 is missing', async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValue(child);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as typeof process.exit);

    const promise = assertPythonOnPath();
    child.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('python3'));

    stderr.mockRestore();
    exit.mockRestore();
  });
});
