import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

const { assertPythonOnPath } = await import('../setup.js');

describe('direct runtime python probe', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it('passes when the interpreter reports Python 3.12+', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '3.12', stderr: '' });

    await expect(assertPythonOnPath()).resolves.toBeUndefined();
  });

  it('exits with an actionable message when the interpreter is missing', async () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: '', error: new Error('ENOENT') });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as typeof process.exit);

    await expect(assertPythonOnPath()).rejects.toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Python 3.12+'));

    stderr.mockRestore();
    exit.mockRestore();
  });

  it('rejects an interpreter below the Python 3.12 floor', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '3.11', stderr: '' });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as typeof process.exit);

    await expect(assertPythonOnPath()).rejects.toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('3.11'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('3.12'));

    stderr.mockRestore();
    exit.mockRestore();
  });

  it('probes the resolved interpreter rather than a hardcoded python3', async () => {
    const prev = process.env['TASKSAIL_PYTHON_312_BIN'];
    process.env['TASKSAIL_PYTHON_312_BIN'] = '/custom/py312';
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '3.12', stderr: '' });

    await assertPythonOnPath();

    expect(spawnSyncMock).toHaveBeenCalledWith('/custom/py312', ['-c', expect.any(String)], expect.anything());

    if (prev === undefined) {
      delete process.env['TASKSAIL_PYTHON_312_BIN'];
    } else {
      process.env['TASKSAIL_PYTHON_312_BIN'] = prev;
    }
  });
});
