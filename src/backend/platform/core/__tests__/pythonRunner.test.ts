import { describe, it, expect } from 'vitest';
import { runPython, detectPythonBin } from '../pythonRunner.js';
import { PythonRunError } from '../types.js';

describe('detectPythonBin', () => {
  it('returns a python binary path', () => {
    const bin = detectPythonBin();
    expect(bin).toBeTruthy();
    expect(typeof bin).toBe('string');
  });
});

describe('runPython', () => {
  it('runs a trivial Python script and captures stdout', async () => {
    const result = await runPython('-c', ['print("hello from python")']);
    expect(result.stdout.trim()).toBe('hello from python');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr', async () => {
    const result = await runPython('-c', [
      'import sys; print("err", file=sys.stderr); print("out")',
    ]);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
  });

  it('rejects on non-zero exit code', async () => {
    await expect(
      runPython('-c', ['import sys; sys.exit(42)']),
    ).rejects.toThrow('exited with code 42');
  });

  it('rejects with PythonRunError containing typed properties', async () => {
    try {
      await runPython('-c', ['import sys; print("out"); print("err", file=sys.stderr); sys.exit(7)']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PythonRunError);
      const pyErr = err as PythonRunError;
      expect(pyErr.exitCode).toBe(7);
      expect(pyErr.stdout).toContain('out');
      expect(pyErr.stderr).toContain('err');
      expect(pyErr.name).toBe('PythonRunError');
    }
  });

  it('rejects when python binary is not found', async () => {
    const originalEnv = process.env['PYTHON_BIN'];
    process.env['PYTHON_BIN'] = '/nonexistent/python999';
    try {
      await expect(
        runPython('-c', ['print("test")']),
      ).rejects.toThrow();
    } finally {
      if (originalEnv === undefined) {
        delete process.env['PYTHON_BIN'];
      } else {
        process.env['PYTHON_BIN'] = originalEnv;
      }
    }
  });
});
